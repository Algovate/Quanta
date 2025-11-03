import { Exchange, TradingSignal, Order, Position, Account } from '../exchange/types.js';
import { calculatePositionPnl } from '../utils/symbol-utils.js';
import { RiskManager, PositionSizing } from './risk.js';
import { ensureUsdtSuffix } from '../utils/symbol-utils.js';
import { UnifiedLogger } from '../logging/index.js';
import { TradingManager } from '../web/trading-manager.js';
import type { OrderEvent } from '../web/types.js';
import { getConfig } from '../config/settings.js';

// Type guard to check if exchange is SimulatorExchange with metadata support
function isSimulatorExchange(exchange: Exchange): exchange is Exchange & {
  setOrderMetadata: (orderId: string, source: string, reason: string) => void;
} {
  return typeof (exchange as any).setOrderMetadata === 'function';
}

export interface OrderResult {
  success: boolean;
  order?: Order;
  error?: string;
  realizedPnl?: number;
  fees?: number;
}

export class OrderExecutor {
  private exchange: Exchange;
  private riskManager: RiskManager;
  private logger: UnifiedLogger;
  private readonly context = 'OrderExecutor';
  private forceMarketOrders: boolean;
  private priceSanityEnabled: boolean;
  private priceSanityMaxDeviation: number;

  constructor(
    exchange: Exchange,
    riskManager: RiskManager,
    options?: { forceMarketOrders?: boolean }
  ) {
    this.exchange = exchange;
    this.riskManager = riskManager;
    this.logger = UnifiedLogger.getInstance();
    this.forceMarketOrders = Boolean(options?.forceMarketOrders);
    const cfg = getConfig();
    this.priceSanityEnabled = Boolean(cfg.trading?.priceSanity?.enabled);
    this.priceSanityMaxDeviation = Number(cfg.trading?.priceSanity?.maxDeviation ?? 0.05);
  }

  /**
   * Execute a partial close of a position by submitting an opposite side market order
   * for the requested fraction of current size.
   */
  async executePartialClose(position: Position, fraction: number): Promise<OrderResult> {
    try {
      const symbol = position.symbol;
      const side: 'buy' | 'sell' = position.side === 'long' ? 'sell' : 'buy';
      const amount = Math.max(0, Math.min(1, fraction)) * position.size;
      if (amount <= 0) return { success: false, error: 'Zero amount for partial close' };

      // Market order for immediate reduction
      const order = await this.exchange.placeOrder(
        symbol,
        side,
        amount,
        undefined,
        position.leverage
      );
      // Set metadata for simulator exchange if applicable
      if (isSimulatorExchange(this.exchange)) {
        this.exchange.setOrderMetadata?.(order.id, 'AI', 'partial-close');
      }
      this.pushOrderEvent(order, symbol, side, amount, 'AI', 'partial-close', undefined);
      if (order.status === 'filled' || order.status === 'open') {
        return { success: true, order };
      }
      return { success: false, error: `Order ${order.status || 'unknown'} on partial close` };
    } catch (error) {
      return this.handleError('Partial close', error);
    }
  }
  /**
   * Build full symbol from coin name
   */
  private buildSymbol(coin: string): string {
    return ensureUsdtSuffix(coin);
  }

  /**
   * Find position by coin name
   */
  private findPosition(coin: string, positions: Position[]): Position | undefined {
    const symbol = this.buildSymbol(coin);
    return positions.find(p => p.symbol === symbol);
  }

  /**
   * Convert position side to order side
   * Long positions need to be sold to close, short positions need to be bought to close
   */
  private positionSideToOrderSide(positionSide: 'long' | 'short'): 'buy' | 'sell' {
    return positionSide === 'long' ? 'sell' : 'buy';
  }

  /**
   * Handle error and return standardized error result
   */
  private handleError(context: string, error: unknown): OrderResult {
    this.logger.error(
      `Error executing ${context}`,
      error instanceof Error ? error : new Error(String(error)),
      this.context
    );
    return {
      success: false,
      error: error instanceof Error ? error.message : `${context} execution failed`,
    };
  }

  private pushOrderEvent(
    order: Order,
    symbol: string,
    side: 'buy' | 'sell',
    amount: number,
    source: string,
    reason: string,
    price?: number
  ): void {
    try {
      const event: OrderEvent = {
        id: order?.id ?? `${symbol}-${Date.now()}`,
        timestamp: Date.now(),
        symbol,
        side,
        amount,
        status: order?.status ?? 'open',
        source,
        reason,
        ...(price !== undefined ? { price } : {}),
      };
      TradingManager.getInstance().pushOrder(event);
    } catch (error) {
      // TradingManager might not be initialized in backtest mode
      // This is non-critical, so we log at debug level
      this.logger.debug(
        'Failed to push order to TradingManager',
        error instanceof Error ? { error: error.message } : { error: String(error) },
        this.context
      );
    }
  }

  async executeSignal(
    signal: TradingSignal,
    account: Account,
    currentPositions: Position[],
    currentPrice: number
  ): Promise<OrderResult> {
    try {
      // Validate signal (do not log per-failure here; caller aggregates for UI)
      const validationResult = this.riskManager.validateSignal(signal, account, currentPositions);
      if (!validationResult.valid) {
        return { success: false, error: validationResult.reason || 'Signal validation failed' };
      }

      // Calculate position sizing (ATR not available at this level, will use default)
      const sizing = this.riskManager.calculatePositionSizing(
        signal,
        account,
        currentPositions,
        currentPrice
      );

      if (!sizing) {
        return { success: false, error: 'Position sizing calculation failed' };
      }

      // Execute order based on signal action
      switch (signal.action) {
        case 'LONG':
          return await this.executeLongOrder(signal, sizing, currentPrice);

        case 'SHORT':
          return await this.executeShortOrder(signal, sizing, currentPrice);

        case 'CLOSE':
          return await this.executeCloseOrder(signal, currentPositions);

        case 'HOLD':
          return { success: true, order: undefined };

        default:
          return { success: false, error: `Unknown action: ${signal.action}` };
      }
    } catch (error) {
      this.logger.error(
        'Error executing signal',
        error instanceof Error ? error : new Error(String(error)),
        this.context
      );
      return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
    }
  }

  /**
   * Execute a directional order (long or short)
   * Consolidates duplicate logic from executeLongOrder and executeShortOrder
   */
  private async executeDirectionalOrder(
    signal: TradingSignal,
    sizing: PositionSizing,
    currentPrice: number,
    side: 'buy' | 'sell'
  ): Promise<OrderResult> {
    try {
      // Validate current price before proceeding
      if (currentPrice <= 0 || !isFinite(currentPrice)) {
        return {
          success: false,
          error: `Invalid current price: ${currentPrice}`,
        };
      }

      const symbol = this.buildSymbol(signal.coin);
      const amount = sizing.suggestedSize;
      // Determine intended price
      let price = this.forceMarketOrders ? undefined : signal.entry_price || currentPrice;

      // Stale price guard: if entry_price deviates too much from current ticker, convert to market
      if (!this.forceMarketOrders && this.priceSanityEnabled && signal.entry_price !== undefined) {
        // currentPrice is already validated above
        const denom = currentPrice;
        const relDiff = denom > 0 ? Math.abs(signal.entry_price - denom) / denom : 0;
        if (relDiff > this.priceSanityMaxDeviation) {
          this.logger.warn(
            'Overriding stale entry price with market due to deviation',
            {
              coin: signal.coin,
              side,
              entryPrice: signal.entry_price,
              currentPrice: denom,
              relativeDiff: relDiff,
              maxAllowed: this.priceSanityMaxDeviation,
            },
            this.context
          );
          price = undefined; // force market order
        }
      }
      const leverage = sizing.leverage;

      const order = await this.exchange.placeOrder(symbol, side, amount, price, leverage);
      // Set metadata for simulator exchange if applicable
      if (isSimulatorExchange(this.exchange)) {
        this.exchange.setOrderMetadata?.(order.id, 'AI', 'signal');
      }
      this.pushOrderEvent(order, symbol, side, amount, 'AI', 'signal', price);

      // Check if order was actually filled
      if (order.status === 'filled') {
        return { success: true, order };
      } else if (order.status === 'open') {
        // For limit orders that cannot fill immediately, this is expected behavior
        // The order will remain open until market conditions allow it to fill
        return { success: true, order };
      } else {
        return {
          success: false,
          error: `Order ${order.status}: ${order.status === 'rejected' ? 'Insufficient margin' : 'Unknown reason'}`,
        };
      }
    } catch (error) {
      return this.handleError(`${side.toUpperCase()} order`, error);
    }
  }

  private async executeLongOrder(
    signal: TradingSignal,
    sizing: PositionSizing,
    currentPrice: number
  ): Promise<OrderResult> {
    return this.executeDirectionalOrder(signal, sizing, currentPrice, 'buy');
  }

  private async executeShortOrder(
    signal: TradingSignal,
    sizing: PositionSizing,
    currentPrice: number
  ): Promise<OrderResult> {
    return this.executeDirectionalOrder(signal, sizing, currentPrice, 'sell');
  }

  private async executeCloseOrder(
    signal: TradingSignal,
    currentPositions: Position[]
  ): Promise<OrderResult> {
    try {
      const position = this.findPosition(signal.coin, currentPositions);

      if (!position) {
        return { success: false, error: `No position found for ${signal.coin}` };
      }

      const symbol = this.buildSymbol(signal.coin);
      const side = this.positionSideToOrderSide(position.side);

      // For CLOSE orders, use exact position size to prevent creating new positions
      // This ensures the order amount exactly matches the position size, preventing
      // floating point precision issues that could cause small remainders and trigger
      // new position creation in updatePosition()
      const exactAmount = position.size;

      // Fetch current price to compute realized P&L for display
      let priceForPnl: number | undefined;
      try {
        const ticker = await this.exchange.getTicker(symbol);
        priceForPnl = (ticker as { price: number }).price;
      } catch (error) {
        // If ticker fails, proceed without realized pnl
        // This is non-critical for position closing
        this.logger.debug(
          `Failed to fetch ticker for P&L calculation on ${symbol}`,
          error instanceof Error ? { error: error.message } : { error: String(error) },
          this.context
        );
      }

      const order = await this.exchange.placeOrder(symbol, side, exactAmount);
      // Set metadata for simulator exchange if applicable
      if (isSimulatorExchange(this.exchange)) {
        this.exchange.setOrderMetadata?.(order.id, 'AI', 'signal');
      }
      this.pushOrderEvent(order, symbol, side, exactAmount, 'AI', 'signal');

      const realizedPnl =
        priceForPnl !== undefined
          ? calculatePositionPnl(position.side, priceForPnl, position.entryPrice, position.size)
          : undefined;

      return { success: true, order, realizedPnl, fees: 0 };
    } catch (error) {
      return this.handleError('CLOSE order', error);
    }
  }

  /**
   * Execute position exit (stop loss or take profit)
   * Consolidates duplicate logic
   */
  private async executePositionExit(
    position: Position,
    currentPrice: number,
    source: string,
    reason: string,
    context: string
  ): Promise<OrderResult> {
    try {
      const symbol = ensureUsdtSuffix(position.symbol);
      const side = this.positionSideToOrderSide(position.side);
      const amount = position.size;

      const order = await this.exchange.placeOrder(symbol, side, amount, currentPrice);
      // Set metadata for simulator exchange if applicable
      if (isSimulatorExchange(this.exchange)) {
        this.exchange.setOrderMetadata?.(order.id, source, reason);
      }
      this.pushOrderEvent(order, symbol, side, amount, source, reason, currentPrice);
      return { success: true, order };
    } catch (error) {
      return this.handleError(context, error);
    }
  }

  async executeStopLoss(
    position: Position,
    currentPrice: number,
    source?: string,
    reason?: string
  ): Promise<OrderResult> {
    return this.executePositionExit(
      position,
      currentPrice,
      source ?? 'stop-loss',
      reason ?? 'Stop loss triggered',
      'stop loss'
    );
  }

  async executeTakeProfit(
    position: Position,
    currentPrice: number,
    source?: string,
    reason?: string
  ): Promise<OrderResult> {
    return this.executePositionExit(
      position,
      currentPrice,
      source ?? 'take-profit',
      reason ?? 'Take profit triggered',
      'take profit'
    );
  }

  async cancelOrder(orderId: string, symbol: string): Promise<boolean> {
    try {
      return await this.exchange.cancelOrder(orderId, symbol);
    } catch (error) {
      this.logger.error(
        'Error canceling order',
        error instanceof Error ? error : new Error(String(error)),
        this.context
      );
      return false;
    }
  }
}

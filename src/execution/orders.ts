import { Exchange, TradingSignal, Order, Position, Account } from '../exchange/types.js';
import { calculatePositionPnl } from '../utils/symbol-utils.js';
import { RiskManager, PositionSizing } from './risk.js';
import { ensureUsdtSuffix } from '../utils/symbol-utils.js';
import { UnifiedLogger } from '../logging/index.js';
import { TradingManager } from '../core/trading-manager.js';
import type { OrderEvent, TradeEvent } from '../core/types/trading-manager.js';
import { getConfig } from '../config/settings.js';
import { SlippageManager } from './slippage-manager.js';
import { TechnicalIndicators } from '../types/index.js';

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
  private slippageManager: SlippageManager;

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
    this.slippageManager = new SlippageManager();
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

  private pushTradeEvent(
    order: Order,
    orderId: string,
    symbol: string,
    side: 'buy' | 'sell',
    amount: number,
    source: string,
    reason: string,
    realizedPnl?: number,
    fees?: number
  ): void {
    try {
      const event: TradeEvent = {
        id: `${orderId}-${Date.now()}`, // unique trade ID
        orderId, // link to order
        timestamp: Date.now(),
        symbol,
        side,
        amount,
        price: order.price, // execution price (required for trades)
        source,
        reason,
        ...(fees !== undefined ? { fee: fees, feeAsset: 'USDT' } : {}),
        ...(realizedPnl !== undefined ? { realizedPnl } : {}),
      };
      TradingManager.getInstance().pushTrade(event);
    } catch (error) {
      // TradingManager might not be initialized in backtest mode
      // This is non-critical, so we log at debug level
      this.logger.debug(
        'Failed to push trade to TradingManager',
        error instanceof Error ? { error: error.message } : { error: String(error) },
        this.context
      );
    }
  }

  /**
   * Helper to push both order and trade events (if order is filled)
   */
  private pushOrderAndTradeEvents(
    order: Order,
    symbol: string,
    side: 'buy' | 'sell',
    amount: number,
    source: string,
    reason: string,
    price?: number,
    realizedPnl?: number,
    fees?: number
  ): void {
    // Always emit order event
    this.pushOrderEvent(order, symbol, side, amount, source, reason, price);

    // Emit trade event if order was filled
    if (order.status === 'filled') {
      this.pushTradeEvent(order, order.id, symbol, side, amount, source, reason, realizedPnl, fees);
    }
  }

  async executeSignal(
    signal: TradingSignal,
    account: Account,
    currentPositions: Position[],
    currentPrice: number,
    indicators?: TechnicalIndicators
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
          return await this.executeLongOrder(signal, sizing, currentPrice, indicators);

        case 'SHORT':
          return await this.executeShortOrder(signal, sizing, currentPrice, indicators);

        case 'CLOSE':
          return await this.executeCloseOrder(signal, currentPositions, currentPrice);

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
    side: 'buy' | 'sell',
    indicators?: TechnicalIndicators
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

      // Calculate expected slippage
      const slippageMetrics = this.slippageManager.calculateExpectedSlippage(
        symbol,
        amount,
        currentPrice,
        side,
        indicators
      );

      // Log slippage warning if high
      if (slippageMetrics.warning) {
        this.logger.warn(
          slippageMetrics.warning,
          {
            symbol,
            coin: signal.coin,
            side,
            expectedSlippage: (slippageMetrics.expectedSlippage * 100).toFixed(2) + '%',
            historicalAverage: (slippageMetrics.historicalAverage * 100).toFixed(2) + '%',
            orderSize: amount,
            orderValue: amount * currentPrice,
          },
          this.context
        );
      }

      // Determine intended price
      // Use limit order if expected slippage is high and not forcing market orders
      let price = this.forceMarketOrders ? undefined : signal.entry_price || currentPrice;

      // If expected slippage is high, prefer limit order to reduce slippage
      if (!this.forceMarketOrders && slippageMetrics.shouldUseLimitOrder && !price) {
        // Set limit price slightly better than market to reduce slippage
        // For buy: 0.1% below market, for sell: 0.1% above market
        const limitOffset = currentPrice * 0.001; // 0.1%
        price = side === 'buy' ? currentPrice - limitOffset : currentPrice + limitOffset;

        this.logger.info(
          'Using limit order to reduce expected slippage',
          {
            symbol,
            coin: signal.coin,
            side,
            expectedSlippage: (slippageMetrics.expectedSlippage * 100).toFixed(2) + '%',
            limitPrice: price,
            marketPrice: currentPrice,
          },
          this.context
        );
      }

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

      // Calculate actual slippage if order was filled
      const actualPrice = order.price || currentPrice;
      if (order.status === 'filled' && actualPrice > 0 && currentPrice > 0) {
        const actualSlippage =
          side === 'buy'
            ? (actualPrice - currentPrice) / currentPrice
            : (currentPrice - actualPrice) / currentPrice;

        // Record slippage for tracking
        this.slippageManager.recordSlippage({
          symbol,
          timestamp: Date.now(),
          expectedPrice: currentPrice,
          actualPrice,
          slippage: actualSlippage,
          orderSize: amount,
          side,
        });

        // Log if actual slippage differs significantly from expected
        if (Math.abs(actualSlippage - slippageMetrics.expectedSlippage) > 0.002) {
          this.logger.info(
            'Slippage deviation from expected',
            {
              symbol,
              coin: signal.coin,
              side,
              expected: (slippageMetrics.expectedSlippage * 100).toFixed(2) + '%',
              actual: (actualSlippage * 100).toFixed(2) + '%',
              deviation:
                ((actualSlippage - slippageMetrics.expectedSlippage) * 100).toFixed(2) + '%',
            },
            this.context
          );
        }
      }

      this.pushOrderAndTradeEvents(order, symbol, side, amount, 'AI', 'signal', price);

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
    currentPrice: number,
    indicators?: TechnicalIndicators
  ): Promise<OrderResult> {
    return this.executeDirectionalOrder(signal, sizing, currentPrice, 'buy', indicators);
  }

  private async executeShortOrder(
    signal: TradingSignal,
    sizing: PositionSizing,
    currentPrice: number,
    indicators?: TechnicalIndicators
  ): Promise<OrderResult> {
    return this.executeDirectionalOrder(signal, sizing, currentPrice, 'sell', indicators);
  }

  private async executeCloseOrder(
    signal: TradingSignal,
    currentPositions: Position[],
    currentPrice: number
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

      // Use currentPrice from cache to compute realized P&L (avoid duplicate ticker call)
      const priceForPnl = currentPrice > 0 && isFinite(currentPrice) ? currentPrice : undefined;

      const order = await this.exchange.placeOrder(symbol, side, exactAmount);
      // Set metadata for simulator exchange if applicable
      if (isSimulatorExchange(this.exchange)) {
        this.exchange.setOrderMetadata?.(order.id, 'AI', 'signal');
      }

      const realizedPnl =
        priceForPnl !== undefined
          ? calculatePositionPnl(position.side, priceForPnl, position.entryPrice, position.size)
          : undefined;

      // Emit order and trade events for filled close orders with realized PnL
      this.pushOrderAndTradeEvents(
        order,
        symbol,
        side,
        exactAmount,
        'AI',
        'signal',
        undefined,
        realizedPnl
      );

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
      // Exits should default to market orders for immediacy; avoid posting limits here.
      // Pass leverage to ensure consistent fee/margin application on some exchanges.
      const order = await this.exchange.placeOrder(
        symbol,
        side,
        amount,
        undefined,
        position.leverage
      );
      // Set metadata for simulator exchange if applicable
      if (isSimulatorExchange(this.exchange)) {
        this.exchange.setOrderMetadata?.(order.id, source, reason);
      }
      this.pushOrderAndTradeEvents(order, symbol, side, amount, source, reason, currentPrice);

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

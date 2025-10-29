import { Exchange, TradingSignal, Order, Position, Account } from '../exchange/types.js';
import { RiskManager, PositionSizing } from './risk.js';
import { ensureUsdtSuffix } from '../utils/symbol-utils.js';
import { Logger } from '../utils/logger.js';
import { TradingManager } from '../web/trading-manager.js';
import type { OrderEvent } from '../web/types.js';

export interface OrderResult {
  success: boolean;
  order?: Order;
  error?: string;
}

export class OrderExecutor {
  private exchange: Exchange;
  private riskManager: RiskManager;
  private logger: Logger;

  constructor(exchange: Exchange, riskManager: RiskManager) {
    this.exchange = exchange;
    this.riskManager = riskManager;
    this.logger = Logger.getInstance('OrderExecutor');
  }

  /**
   * Build full symbol from coin name
   */
  private buildSymbol(coin: string): string {
    return `${coin}/USDT`;
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
    this.logger.error(`Error executing ${context}`, error);
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
        ...(price !== undefined ? { price } : {}),
      };
      TradingManager.getInstance().pushOrder(event);
    } catch {
      // Silently ignore TradingManager push errors
    }
  }

  async executeSignal(
    signal: TradingSignal,
    account: Account,
    currentPositions: Position[],
    currentPrice: number
  ): Promise<OrderResult> {
    try {
      // Validate signal
      const validationResult = this.riskManager.validateSignal(signal, account, currentPositions);
      if (!validationResult.valid) {
        this.logger.warn(
          `Signal validation failed for ${signal.coin} ${signal.action}: ${validationResult.reason}`
        );
        return { success: false, error: validationResult.reason || 'Signal validation failed' };
      }

      // Calculate position sizing
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
      this.logger.error('Error executing signal', error);
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
      const symbol = this.buildSymbol(signal.coin);
      const amount = sizing.suggestedSize;
      const price = signal.entry_price || currentPrice;
      const leverage = sizing.leverage;

      const order = await this.exchange.placeOrder(symbol, side, amount, price, leverage);
      this.pushOrderEvent(order, symbol, side, amount, price);

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
      const amount = position.size;

      const order = await this.exchange.placeOrder(symbol, side, amount);
      this.pushOrderEvent(order, symbol, side, amount);

      return { success: true, order };
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
    context: string
  ): Promise<OrderResult> {
    try {
      const symbol = ensureUsdtSuffix(position.symbol);
      const side = this.positionSideToOrderSide(position.side);
      const amount = position.size;

      const order = await this.exchange.placeOrder(symbol, side, amount, currentPrice);
      this.pushOrderEvent(order, symbol, side, amount, currentPrice);
      return { success: true, order };
    } catch (error) {
      return this.handleError(context, error);
    }
  }

  async executeStopLoss(position: Position, currentPrice: number): Promise<OrderResult> {
    return this.executePositionExit(position, currentPrice, 'stop loss');
  }

  async executeTakeProfit(position: Position, currentPrice: number): Promise<OrderResult> {
    return this.executePositionExit(position, currentPrice, 'take profit');
  }

  async cancelOrder(orderId: string, symbol: string): Promise<boolean> {
    try {
      return await this.exchange.cancelOrder(orderId, symbol);
    } catch (error) {
      this.logger.error('Error canceling order', error);
      return false;
    }
  }
}

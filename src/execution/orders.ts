import { Exchange, TradingSignal, Order, Position, Account } from '../exchange/types.js';
import { RiskManager, PositionSizing } from './risk.js';
import { ensureUsdtSuffix } from '../utils/symbol-utils.js';
import { Logger } from '../utils/logger.js';

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

  async executeSignal(
    signal: TradingSignal,
    account: Account,
    currentPositions: Position[],
    currentPrice: number
  ): Promise<OrderResult> {
    try {
      // Validate signal
      if (!this.riskManager.validateSignal(signal, account, currentPositions)) {
        return { success: false, error: 'Signal validation failed' };
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
      const symbol = `${signal.coin}/USDT`;
      const amount = sizing.suggestedSize;
      const price = signal.entry_price || currentPrice;
      const leverage = sizing.leverage;

      const order = await this.exchange.placeOrder(symbol, side, amount, price, leverage);

      // Check if order was actually filled
      if (order.status === 'filled') {
        return { success: true, order };
      } else {
        return {
          success: false,
          error: `Order ${order.status}: ${order.status === 'rejected' ? 'Insufficient margin' : 'Unknown reason'}`,
        };
      }
    } catch (error) {
      this.logger.error(`Error executing ${side.toUpperCase()} order`, error);
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Order execution failed',
      };
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
      const position = currentPositions.find(p => p.symbol === signal.coin);

      if (!position) {
        return { success: false, error: `No position found for ${signal.coin}` };
      }

      const symbol = `${signal.coin}/USDT`;
      const side = position.side === 'long' ? 'sell' : 'buy';
      const amount = position.size;

      // Silent during backtest

      const order = await this.exchange.placeOrder(symbol, side, amount);

      return { success: true, order };
    } catch (error) {
      this.logger.error('Error executing CLOSE order', error);
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Order execution failed',
      };
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
      const side = position.side === 'long' ? 'sell' : 'buy';
      const amount = position.size;

      const order = await this.exchange.placeOrder(symbol, side, amount, currentPrice);
      return { success: true, order };
    } catch (error) {
      this.logger.error(`Error executing ${context}`, error);
      return {
        success: false,
        error: error instanceof Error ? error.message : `${context} execution failed`,
      };
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

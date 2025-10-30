import { Exchange, Account, Position, Candlestick, Order } from './types.js';
import { normalizeSymbol } from '../utils/symbol-utils.js';
import { shouldCreatePositionAfterClose } from '../utils/position-close-utils.js';
import { POSITION_CLOSING } from '../execution/constants.js';
import { CompletedTrade } from '../types/index.js';
import {
  createPosition,
  updatePositionWithPrice,
  updateAccountEquity as calculateAccountEquity,
  calculateRealizedPnl,
  createCompletedTrade,
  calculateAverageEntryPrice,
  calculateMargin,
  calculateNotional,
} from './position-calculations.js';
import {
  safeAdd,
  safeSubtract,
  safeMultiply,
  safeDivide,
  roundToPrecision,
  EXCHANGE_PRECISION,
} from '../utils/precision.js';

/**
 * BacktestExchange - Time-aware exchange for historical data replay
 * Tracks current simulation time and only allows actions based on historical data
 */
export class BacktestExchange implements Exchange {
  private account: Account;
  private positions: Position[];
  private orders: Order[];
  private currentTime: number;
  private historicalData: Map<string, Candlestick[]>;
  private completedTrades: CompletedTrade[] = [];

  constructor(initialBalance: number, initialTime: number) {
    this.account = {
      balance: initialBalance,
      equity: initialBalance,
      availableMargin: initialBalance,
      usedMargin: 0,
      marginRatio: 0,
      timestamp: initialTime,
    };

    this.positions = [];
    this.orders = [];
    this.currentTime = initialTime;
    this.historicalData = new Map();
  }

  /**
   * Set the current simulation time
   * This advances the "clock" of the backtest
   */
  setCurrentTime(timestamp: number): void {
    this.currentTime = timestamp;
  }

  getCurrentTime(): number {
    return this.currentTime;
  }

  /**
   * Load historical data for a symbol
   * Data must be loaded before the backtest starts
   */
  loadHistoricalData(symbol: string, candlesticks: Candlestick[]): void {
    this.historicalData.set(symbol, candlesticks);
  }

  async getAccount(): Promise<Account> {
    this.updateAccountEquity();
    return {
      ...this.account,
      timestamp: this.currentTime,
    };
  }

  async getPositions(): Promise<Position[]> {
    this.updateAllPositions();
    return [...this.positions];
  }

  async getPositionsBySymbol(symbol: string): Promise<Position[]> {
    this.updateAllPositions();
    return this.positions.filter(p => p.symbol === symbol);
  }

  async getTotalExposure(): Promise<{ totalValue: number; bySymbol: Record<string, number> }> {
    this.updateAllPositions();
    const bySymbol: Record<string, number> = {};
    let totalValue = 0;

    this.positions.forEach(position => {
      // Use position.notional which already includes leverage (size * markPrice * leverage)
      const positionValue = position.notional;
      bySymbol[position.symbol] = (bySymbol[position.symbol] || 0) + positionValue;
      totalValue += positionValue;
    });

    return { totalValue, bySymbol };
  }

  async getPortfolioMetrics(): Promise<{
    totalPositions: number;
    totalExposure: number;
    totalUnrealizedPnl: number;
    exposureBySymbol: Record<string, number>;
    pnlBySymbol: Record<string, number>;
    leverage: number;
  }> {
    this.updateAllPositions();
    const exposure = await this.getTotalExposure();
    const totalUnrealizedPnl = this.positions.reduce((sum, pos) => sum + pos.unrealizedPnl, 0);

    const pnlBySymbol: Record<string, number> = {};
    this.positions.forEach(position => {
      pnlBySymbol[position.symbol] = (pnlBySymbol[position.symbol] || 0) + position.unrealizedPnl;
    });

    const leverage = this.account.equity > 0 ? exposure.totalValue / this.account.equity : 0;

    return {
      totalPositions: this.positions.length,
      totalExposure: exposure.totalValue,
      totalUnrealizedPnl,
      exposureBySymbol: exposure.bySymbol,
      pnlBySymbol,
      leverage,
    };
  }

  async getCandlesticks(
    symbol: string,
    timeframe: string,
    limit: number = 100
  ): Promise<Candlestick[]> {
    const key = `${symbol}_${timeframe}`;
    const candles = this.historicalData.get(key);

    if (!candles) {
      return [];
    }

    // Return only data up to current time
    const availableCandles = candles.filter(c => c.timestamp <= this.currentTime);
    return availableCandles.slice(-limit);
  }

  async placeOrder(
    symbol: string,
    side: 'buy' | 'sell',
    amount: number,
    price?: number,
    leverage?: number
  ): Promise<Order> {
    const normalizedSymbol = normalizeSymbol(symbol);
    const currentPrice = this.getCurrentPrice(normalizedSymbol);
    const orderPrice = price || currentPrice;
    const orderLeverage = leverage || 1;

    const order: Order = {
      id: `bt_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
      symbol: normalizedSymbol,
      side,
      amount,
      price: orderPrice,
      status: 'open',
      timestamp: this.currentTime,
    };

    this.orders.push(order);

    // Execute order immediately at the current historical price
    this.executeOrder(order, orderLeverage);

    return order;
  }

  async cancelOrder(orderId: string, _symbol: string): Promise<boolean> {
    const orderIndex = this.orders.findIndex(o => o.id === orderId);
    if (orderIndex >= 0) {
      this.orders.splice(orderIndex, 1);
      return true;
    }
    return false;
  }

  async getTicker(symbol: string): Promise<{ price: number; timestamp: number }> {
    return {
      price: this.getCurrentPrice(symbol),
      timestamp: this.currentTime,
    };
  }

  getExchangeName(): string {
    return 'backtest';
  }

  isTestnetMode(): boolean {
    return false;
  }

  /**
   * Get completed trades (for performance analysis)
   */
  getCompletedTrades(): CompletedTrade[] {
    return [...this.completedTrades];
  }

  /**
   * Force close all positions (used at end of backtest)
   */
  async closeAllPositions(): Promise<void> {
    // Create a copy to avoid issues while removing during iteration
    const positionsToClose = [...this.positions];
    for (const position of positionsToClose) {
      await this.closePosition(position);
    }
  }

  private closePosition(position: Position): void {
    // Check if position was already closed
    const positionIndex = this.positions.indexOf(position);
    if (positionIndex < 0) {
      return; // Already closed
    }

    const currentPrice = this.getCurrentPrice(position.symbol);

    // Record completed trade using shared utility
    const completedTrade = createCompletedTrade(
      position,
      currentPrice,
      this.currentTime,
      this.completedTrades.length + 1,
      'end_of_backtest'
    );

    const pnl = completedTrade.pnl;

    this.completedTrades.push(completedTrade);

    // Update account
    this.account.balance += pnl;
    this.account.availableMargin += position.marginUsed + pnl;
    this.account.usedMargin -= position.marginUsed;

    // Remove position
    this.positions.splice(positionIndex, 1);
  }

  private getCurrentPrice(symbol: string): number {
    // Try to get from historical data
    const candles = this.historicalData.get(symbol);
    if (candles && candles.length > 0) {
      // Find the most recent candle up to current time
      const availableCandles = candles.filter(c => c.timestamp <= this.currentTime);
      if (availableCandles.length > 0) {
        return availableCandles[availableCandles.length - 1].close;
      }
    }

    // Fallback to base price
    return this.getBasePrice(symbol);
  }

  private getBasePrice(symbol: string): number {
    const normalizedSymbol = symbol.replace(/\/USDT\/USDT$/, '/USDT');
    const prices: { [key: string]: number } = {
      'BTC/USDT': 45000,
      'ETH/USDT': 3000,
      'SOL/USDT': 100,
      'BNB/USDT': 400,
      'ADA/USDT': 0.5,
      'XRP/USDT': 0.5,
      'DOGE/USDT': 0.1,
      'AVAX/USDT': 25,
    };
    return prices[normalizedSymbol] || 100;
  }

  private executeOrder(order: Order, leverage: number = 1): void {
    const currentPrice = this.getCurrentPrice(order.symbol);

    // Simulate realistic order execution with slippage
    let executedPrice: number;
    if (order.price && order.price !== currentPrice) {
      // Limit order - check if it can fill at historical price
      const canFill =
        (order.side === 'buy' && order.price >= currentPrice) ||
        (order.side === 'sell' && order.price <= currentPrice);

      if (!canFill) {
        order.status = 'open'; // Keep as open limit order
        return;
      }
      executedPrice = order.price;
    } else {
      // Market order - apply historical slippage
      const slippagePercent = Math.random() * 0.05; // 0-0.05% slippage for backtest
      const slippageMultiplier = order.side === 'buy' ? 1 + slippagePercent : 1 - slippagePercent;
      executedPrice = currentPrice * slippageMultiplier;
    }

    const notionalValue = order.amount * executedPrice;
    const marginRequired = notionalValue / leverage;

    if (order.side === 'buy' || order.side === 'sell') {
      if (marginRequired <= this.account.availableMargin) {
        this.updatePosition(order.symbol, order.side, order.amount, executedPrice, leverage);
        // Update account balances using precision-safe arithmetic
        this.account.availableMargin = roundToPrecision(
          safeSubtract(this.account.availableMargin, marginRequired).toNumber(),
          EXCHANGE_PRECISION.USDT
        );
        this.account.usedMargin = roundToPrecision(
          safeAdd(this.account.usedMargin, marginRequired).toNumber(),
          EXCHANGE_PRECISION.USDT
        );
        order.status = 'filled';
        order.price = executedPrice; // Update with actual execution price
      } else {
        order.status = 'rejected';
      }
    }
  }

  private updatePosition(
    symbol: string,
    side: 'buy' | 'sell',
    amount: number,
    price: number,
    leverage: number = 1
  ): void {
    const positionSide = side === 'buy' ? 'long' : 'short';
    const oppositeSide = positionSide === 'long' ? 'short' : 'long';

    symbol = normalizeSymbol(symbol);

    const oppositePosition = this.positions.find(
      p => p.symbol === symbol && p.side === oppositeSide
    );

    if (oppositePosition) {
      // Closing or reducing opposite position
      // Use tolerance from constants to handle floating point errors and price volatility
      const tolerance = oppositePosition.size * POSITION_CLOSING.CLOSE_TOLERANCE_PERCENT;
      const isFullClose = amount >= oppositePosition.size - tolerance;

      if (isFullClose) {
        const closedSize = oppositePosition.size;
        const remainingAmount = Math.max(0, amount - closedSize);

        const realizedPnl = calculateRealizedPnl(
          oppositePosition.side,
          price,
          oppositePosition.entryPrice,
          closedSize,
          symbol
        );

        // Update account with realized P&L using precision-safe arithmetic
        this.account.balance = roundToPrecision(
          safeAdd(this.account.balance, realizedPnl).toNumber(),
          EXCHANGE_PRECISION.USDT
        );

        const marginReleasePlusPnl = safeAdd(oppositePosition.marginUsed, realizedPnl).toNumber();
        this.account.availableMargin = roundToPrecision(
          safeAdd(this.account.availableMargin, marginReleasePlusPnl).toNumber(),
          EXCHANGE_PRECISION.USDT
        );

        this.account.usedMargin = roundToPrecision(
          safeSubtract(this.account.usedMargin, oppositePosition.marginUsed).toNumber(),
          EXCHANGE_PRECISION.USDT
        );

        const closeIndex = this.positions.findIndex(p => p === oppositePosition);
        if (closeIndex >= 0) {
          this.positions.splice(closeIndex, 1);
        }

        // Check if we should create a new position after closing
        // This prevents CLOSE orders from accidentally creating new positions
        const closeCheck = shouldCreatePositionAfterClose(
          remainingAmount,
          closedSize,
          symbol,
          positionSide
        );

        if (closeCheck.shouldCreatePosition) {
          if (closeCheck.warningMessage) {
            console.warn(closeCheck.warningMessage);
          }
          this.createNewPosition(symbol, positionSide, remainingAmount, price, leverage);
        } else if (closeCheck.shouldLogRemainder) {
          console.debug(
            `Ignoring small remaining amount (${remainingAmount}) after closing ${symbol} position ` +
              `(likely floating point precision). Closed size: ${closedSize}`
          );
        }
      } else {
        // Partial close calculations using precision-safe arithmetic
        const ratio = safeDivide(amount, oppositePosition.size, 8).toNumber();
        const marginToReturn = roundToPrecision(
          safeMultiply(oppositePosition.marginUsed, ratio).toNumber(),
          EXCHANGE_PRECISION.USDT
        );

        const realizedPnl = calculateRealizedPnl(
          oppositePosition.side,
          price,
          oppositePosition.entryPrice,
          amount,
          symbol
        );

        // Update position using precision
        oppositePosition.size = roundToPrecision(
          safeSubtract(oppositePosition.size, amount).toNumber(),
          8
        );
        oppositePosition.marginUsed = roundToPrecision(
          safeSubtract(oppositePosition.marginUsed, marginToReturn).toNumber(),
          EXCHANGE_PRECISION.USDT
        );

        // Update account using precision-safe arithmetic
        this.account.balance = roundToPrecision(
          safeAdd(this.account.balance, realizedPnl).toNumber(),
          EXCHANGE_PRECISION.USDT
        );
        this.account.usedMargin = roundToPrecision(
          safeSubtract(this.account.usedMargin, marginToReturn).toNumber(),
          EXCHANGE_PRECISION.USDT
        );
        const marginPlusPnl = safeAdd(marginToReturn, realizedPnl).toNumber();
        this.account.availableMargin = roundToPrecision(
          safeAdd(this.account.availableMargin, marginPlusPnl).toNumber(),
          EXCHANGE_PRECISION.USDT
        );
      }
    } else {
      const existingPosition = this.positions.find(
        p => p.symbol === symbol && p.side === positionSide
      );

      if (existingPosition) {
        // Update existing position with average entry price
        existingPosition.entryPrice = calculateAverageEntryPrice(
          existingPosition.size,
          existingPosition.entryPrice,
          amount,
          price
        );
        existingPosition.size += amount;

        // Calculate margin with leverage for the additional position
        const additionalMargin = calculateMargin(amount, price, leverage);
        existingPosition.marginUsed += additionalMargin;

        // Update notional with leverage (matches real exchanges: size * markPrice * leverage)
        existingPosition.notional = calculateNotional(
          existingPosition.size,
          this.getCurrentPrice(symbol),
          leverage
        );
        existingPosition.leverage = leverage;

        this.account.availableMargin -= additionalMargin;
        this.account.usedMargin += additionalMargin;
      } else {
        this.createNewPosition(symbol, positionSide, amount, price, leverage);
      }
    }
  }

  /**
   * Create a new position using shared calculation utilities
   */
  private createNewPosition(
    symbol: string,
    side: 'long' | 'short',
    amount: number,
    price: number,
    leverage: number = 1
  ): void {
    const position = createPosition(symbol, side, amount, price, leverage, this.currentTime);
    this.positions.push(position);
  }

  private updateAllPositions(): void {
    this.positions.forEach(position => {
      const currentPrice = this.getCurrentPrice(position.symbol);
      updatePositionWithPrice(position, currentPrice);
    });
  }

  /**
   * Update account equity and related metrics using shared calculation utilities
   */
  private updateAccountEquity(): void {
    this.updateAllPositions();
    this.account.timestamp = this.currentTime;
    calculateAccountEquity(this.account, this.positions);
  }
}

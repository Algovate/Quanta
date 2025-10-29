import { Exchange, Account, Position, Candlestick, Order } from './types.js';
import { normalizeSymbol, calculatePositionPnl } from '../utils/symbol-utils.js';
import { CompletedTrade } from '../types/index.js';

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
      const positionValue = position.size * position.markPrice;
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
    const pnl = calculatePositionPnl(
      position.side,
      currentPrice,
      position.entryPrice,
      position.size
    );

    // Record completed trade
    const completedTrade = {
      id: `trade_${this.completedTrades.length + 1}`,
      symbol: position.symbol,
      side: position.side,
      entryTime: position.timestamp,
      exitTime: this.currentTime,
      entryPrice: position.entryPrice,
      exitPrice: currentPrice,
      size: position.size,
      pnl,
      pnlPercent: (pnl / (position.size * position.entryPrice)) * 100,
      holdingPeriod: (this.currentTime - position.timestamp) / 1000, // Convert milliseconds to seconds
      reason: 'end_of_backtest' as const,
    };

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
        this.account.availableMargin -= marginRequired;
        this.account.usedMargin += marginRequired;
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
      // Use 1% tolerance to handle floating point errors and price volatility
      const tolerance = oppositePosition.size * 0.01; // 1% tolerance
      const isFullClose = amount >= oppositePosition.size - tolerance;

      if (isFullClose) {
        const closedSize = oppositePosition.size;
        const remainingAmount = Math.max(0, amount - closedSize);

        const realizedPnl = calculatePositionPnl(
          oppositePosition.side,
          price,
          oppositePosition.entryPrice,
          closedSize
        );

        this.account.balance += realizedPnl;
        this.account.availableMargin += oppositePosition.marginUsed + realizedPnl;
        this.account.usedMargin -= oppositePosition.marginUsed;

        const closeIndex = this.positions.findIndex(p => p === oppositePosition);
        if (closeIndex >= 0) {
          this.positions.splice(closeIndex, 1);
        }

        // Only open new position if remaining amount is significant
        // Use 5% threshold to prevent accidental reverse positions from close orders
        const significantThreshold = closedSize * 0.05; // 5% threshold
        if (remainingAmount > significantThreshold) {
          this.createNewPosition(symbol, positionSide, remainingAmount, price, leverage);
        }
      } else {
        const ratio = amount / oppositePosition.size;
        const marginToReturn = oppositePosition.marginUsed * ratio;

        const realizedPnl = calculatePositionPnl(
          oppositePosition.side,
          price,
          oppositePosition.entryPrice,
          amount
        );

        oppositePosition.size -= amount;
        oppositePosition.marginUsed -= marginToReturn;

        this.account.balance += realizedPnl;
        this.account.usedMargin -= marginToReturn;
        this.account.availableMargin += marginToReturn + realizedPnl;
      }
    } else {
      const existingPosition = this.positions.find(
        p => p.symbol === symbol && p.side === positionSide
      );

      if (existingPosition) {
        const totalValue = existingPosition.size * existingPosition.entryPrice + amount * price;
        const totalSize = existingPosition.size + amount;
        existingPosition.entryPrice = totalValue / totalSize;
        existingPosition.size = totalSize;

        // Calculate margin with leverage
        const notionalValue = amount * price;
        const additionalMargin = notionalValue / leverage;
        existingPosition.marginUsed += additionalMargin;
        existingPosition.notional = totalSize * this.getCurrentPrice(symbol);
        existingPosition.leverage = leverage;

        this.account.availableMargin -= additionalMargin;
        this.account.usedMargin += additionalMargin;
      } else {
        this.createNewPosition(symbol, positionSide, amount, price, leverage);
      }
    }
  }

  private createNewPosition(
    symbol: string,
    side: 'long' | 'short',
    amount: number,
    price: number,
    leverage: number = 1
  ): void {
    const normalizedSymbol = normalizeSymbol(symbol);
    const notionalValue = amount * price;
    const marginRequired = notionalValue / leverage;

    this.positions.push({
      symbol: normalizedSymbol,
      side,
      size: amount,
      entryPrice: price,
      markPrice: price,
      unrealizedPnl: 0,
      marginUsed: marginRequired,
      notional: notionalValue,
      leverage: leverage,
      timestamp: this.currentTime,
    });
  }

  private updateAllPositions(): void {
    this.positions.forEach(position => {
      const currentPrice = this.getCurrentPrice(position.symbol);
      position.markPrice = currentPrice;
      position.unrealizedPnl = calculatePositionPnl(
        position.side,
        currentPrice,
        position.entryPrice,
        position.size
      );
      position.notional = position.size * currentPrice;
    });
  }

  private updateAccountEquity(): void {
    this.updateAllPositions();

    // Reconcile used margin with current positions to ensure identity holds
    const recalculatedUsedMargin = this.positions.reduce(
      (sum, pos) => sum + (pos.marginUsed || 0),
      0
    );
    this.account.usedMargin = recalculatedUsedMargin;

    const unrealizedPnl = this.positions.reduce((sum, pos) => sum + pos.unrealizedPnl, 0);
    this.account.equity = this.account.balance + unrealizedPnl;
    this.account.availableMargin = Math.max(0, this.account.equity - this.account.usedMargin);
    this.account.marginRatio =
      this.account.equity > 0 ? this.account.usedMargin / this.account.equity : 0;
  }
}

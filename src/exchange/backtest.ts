import { Exchange, Account, Position, Candlestick, Order } from './types.js';
import { normalizeSymbol } from '../utils/symbol-utils.js';
import { CompletedTrade } from '../types/index.js';
import { updatePositionWithPrice, updateAccountEquity } from './position-calculations.js';
import { PositionUpdateManager } from './position-manager.js';

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
  private positionManager: PositionUpdateManager;

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

    // Initialize position manager with config for backtest
    this.positionManager = new PositionUpdateManager({
      account: this.account,
      positions: this.positions,
      completedTrades: this.completedTrades,
      currentTime: initialTime,
      onAccountUpdate: () => {
        // Sync time on account updates for backtest
        this.account.timestamp = this.currentTime;
      },
    });
  }

  /**
   * Set the current simulation time
   * This advances the "clock" of the backtest
   */
  setCurrentTime(timestamp: number): void {
    this.currentTime = timestamp;
    // Update position manager with new time instead of recreating it
    this.positionManager.updateCurrentTime(timestamp);
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
    const side = position.side === 'long' ? 'sell' : 'buy'; // Opposite side to close

    // Use position manager to close the position properly
    // This ensures all account updates, margin calculations, and trade recording are consistent
    this.positionManager.updatePosition(
      position.symbol,
      side,
      position.size,
      currentPrice,
      position.leverage
    );
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
        this.positionManager.updatePosition(
          order.symbol,
          order.side,
          order.amount,
          executedPrice,
          leverage
        );
        order.status = 'filled';
        order.price = executedPrice; // Update with actual execution price
      } else {
        order.status = 'rejected';
      }
    }
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
    updateAccountEquity(this.account, this.positions);
  }
}

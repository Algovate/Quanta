import { Exchange, Account, Position, Candlestick, Order } from './types.js';
import { normalizeSymbol } from '../utils/symbol-utils.js';
import { CompletedTrade } from '../types/index.js';
import { updatePositionWithPrice, updateAccountEquity } from './position-calculations.js';
import { PositionUpdateManager } from './position-manager.js';

/**
 * BacktestExchange - Time-aware exchange for historical data replay
 * Tracks current simulation time and only allows actions based on historical data
 */
export interface BacktestExecutionConfig {
  takerFeeRate?: number; // e.g., 0.0004 = 4 bps
  makerFeeRate?: number; // e.g., 0.0002 = 2 bps
  maxMarketSlippageBps?: number; // cap for rng slippage, default 5 bps
  partialFillProbability?: number; // probability [0,1]
  minPartialFillRatio?: number; // e.g., 0.3
  maxPartialFillRatio?: number; // e.g., 0.9
  networkLatencyMs?: number; // simulated network/engine latency in ms
  latencySlippageBpsPerSec?: number; // extra slip per second of latency
}

export class BacktestExchange implements Exchange {
  private account: Account;
  private positions: Position[];
  private orders: Order[];
  private currentTime: number;
  private historicalData: Map<string, Candlestick[]>;
  private completedTrades: CompletedTrade[] = [];
  private positionManager: PositionUpdateManager;
  private rng: () => number;
  private candleIndex: Map<string, number> = new Map();

  private cfg: Required<BacktestExecutionConfig>;

  constructor(
    initialBalance: number,
    initialTime: number,
    rng?: () => number,
    cfg?: BacktestExecutionConfig
  ) {
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
    this.rng = rng || Math.random;
    this.cfg = {
      takerFeeRate: 0.0004,
      makerFeeRate: 0.0002,
      maxMarketSlippageBps: 5,
      partialFillProbability: 0.0,
      minPartialFillRatio: 0.5,
      maxPartialFillRatio: 1.0,
      networkLatencyMs: 0,
      latencySlippageBpsPerSec: 0.5, // add 0.5 bps per second latency
      ...(cfg || {}),
    };

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
    // Advance indices for all series to current time
    for (const [key, candles] of this.historicalData.entries()) {
      let idx = this.candleIndex.get(key) ?? -1;
      const len = candles.length;
      while (idx + 1 < len && candles[idx + 1].timestamp <= this.currentTime) {
        idx++;
      }
      this.candleIndex.set(key, idx);
    }
  }

  getCurrentTime(): number {
    return this.currentTime;
  }

  /**
   * Load historical data for a symbol and timeframe.
   *
   * Preferred signature:
   *   loadHistoricalData(symbol, timeframe, candlesticks)
   *
   * Backward compatibility:
   *   loadHistoricalData(symbol, candlesticks)
   *     - Stored under `symbol` key; readers include a fallback to symbol-only keys
   */
  loadHistoricalData(
    symbol: string,
    timeframeOrCandles: string | Candlestick[],
    maybeCandles?: Candlestick[]
  ): void {
    let key: string;
    let candles: Candlestick[];

    if (Array.isArray(timeframeOrCandles)) {
      // Backward compatibility path: key by symbol only
      key = symbol;
      candles = timeframeOrCandles;
    } else {
      const timeframe = timeframeOrCandles;
      candles = maybeCandles || [];
      key = `${symbol}_${timeframe}`;
    }

    this.historicalData.set(key, candles);

    // Initialize index for this series up to current time
    let idx = -1;
    const len = candles.length;
    while (idx + 1 < len && candles[idx + 1].timestamp <= this.currentTime) {
      idx++;
    }
    this.candleIndex.set(key, idx);
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

  async getSnapshot(): Promise<{ account: Account; positions: Position[] }> {
    // Ensure a single time-consistent update for both positions and account
    this.updateAllPositions();
    this.account.timestamp = this.currentTime;
    updateAccountEquity(this.account, this.positions);
    return { account: { ...this.account }, positions: this.positions.map(p => ({ ...p })) };
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
      // Use unlevered exposure (size * markPrice) for portfolio metrics, matches aggregates.totalNotional
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
    let candles = this.historicalData.get(key);
    // Fallback to symbol-only legacy storage
    if (!candles) {
      candles = this.historicalData.get(symbol);
    }

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

    // Apply taker fee on closing notional (common in most venues)
    const closeNotional = Math.abs(position.size) * currentPrice;
    const closeFee = closeNotional * this.cfg.takerFeeRate;
    this.account.balance -= closeFee;
    this.account.equity -= closeFee;

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
    // Prefer lower timeframe data for more granular pricing
    const preferredKeys = [`${symbol}_3m`, `${symbol}_4h`];

    // 1) Try preferred timeframes first
    for (const key of preferredKeys) {
      const candles = this.historicalData.get(key);
      if (candles && candles.length > 0) {
        const idx = this.candleIndex.get(key) ?? -1;
        if (idx >= 0) return candles[idx].close;
      }
    }

    // 2) Fallback: any timeframe for this symbol
    const anyKey = [...this.historicalData.keys()].find(k => k.startsWith(`${symbol}_`));
    if (anyKey) {
      const candles = this.historicalData.get(anyKey);
      if (candles && candles.length > 0) {
        const idx = this.candleIndex.get(anyKey) ?? -1;
        if (idx >= 0) return candles[idx].close;
      }
    }

    // 2b) Legacy fallback: symbol-only key
    const legacyCandles = this.historicalData.get(symbol);
    if (legacyCandles && legacyCandles.length > 0) {
      const idx = this.candleIndex.get(symbol) ?? legacyCandles.length - 1;
      return legacyCandles[Math.max(0, idx)].close;
    }

    // 3) Ultimate fallback: static base price
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
      const baseSlip = (this.rng() * this.cfg.maxMarketSlippageBps) / 10_000; // 0 - max bps
      const latencySlipBps =
        ((this.cfg.networkLatencyMs || 0) / 1000) * (this.cfg.latencySlippageBpsPerSec || 0);
      const latencySlip = latencySlipBps / 10_000;
      const slippagePercent = baseSlip + latencySlip;
      const slippageMultiplier = order.side === 'buy' ? 1 + slippagePercent : 1 - slippagePercent;
      executedPrice = currentPrice * slippageMultiplier;
    }

    // Partial fills (best-effort)
    let filledAmount = order.amount;
    if (this.rng() < this.cfg.partialFillProbability) {
      const ratio =
        this.cfg.minPartialFillRatio +
        this.rng() * (this.cfg.maxPartialFillRatio - this.cfg.minPartialFillRatio);
      filledAmount = Math.max(0, Math.min(order.amount, order.amount * ratio));
    }

    const notionalValue = filledAmount * executedPrice;
    const marginRequired = notionalValue / leverage;

    if (order.side === 'buy' || order.side === 'sell') {
      if (marginRequired <= this.account.availableMargin) {
        this.positionManager.updatePosition(
          order.symbol,
          order.side,
          filledAmount,
          executedPrice,
          leverage
        );
        order.status = filledAmount < order.amount ? 'open' : 'filled';
        order.amount = filledAmount;
        order.price = executedPrice; // Update with actual execution price

        // Apply fees (taker for market, maker for resting limit)
        const isLimit = !!order.price && order.price !== currentPrice;
        const feeRate = isLimit ? this.cfg.makerFeeRate : this.cfg.takerFeeRate;
        const fee = notionalValue * feeRate;
        this.account.balance -= fee;
        this.account.equity -= fee;
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

import { Exchange, Account, Position, Candlestick, Order } from './types.js';
import { normalizeSymbol, ensureUsdtSuffix } from '../utils/symbol-utils.js';
import { CompletedTrade } from '../types/index.js';
import { updatePositionWithPrice, updateAccountEquity } from './position-calculations.js';
import { PositionUpdateManager } from './position-manager.js';
import {
  validateOrder as validateOrderUtil,
  clampReduceOnlyQuantity,
  attemptFallbackRounding,
} from '../utils/order-validation.js';
import { UnifiedLogger } from '../logging/index.js';

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
  private totalFees: number = 0; // Track total fees paid

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
   * Load historical candlestick data for backtesting
   *
   * @param symbol - Trading symbol (e.g., 'BTC/USDT')
   * @param timeframe - Timeframe identifier (e.g., '3m', '4h')
   * @param candlesticks - Array of historical candlestick data
   */
  loadHistoricalData(symbol: string, timeframe: string, candlesticks: Candlestick[]): void {
    const key = `${symbol}_${timeframe}`;
    this.historicalData.set(key, candlesticks);

    // Initialize index for this series up to current time
    let idx = -1;
    const len = candlesticks.length;
    while (idx + 1 < len && candlesticks[idx + 1].timestamp <= this.currentTime) {
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
    // Normalize symbol to ensure it matches stored data keys (e.g., "ETH" -> "ETH/USDT")
    const normalizedSymbol = ensureUsdtSuffix(symbol);
    const key = `${normalizedSymbol}_${timeframe}`;
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

    // Check if this is a reduce-only order (opposite position exists)
    const oppositeSide = side === 'buy' ? 'short' : 'long';
    const oppositePosition = this.positions.find(
      p => p.symbol === normalizedSymbol && p.side === oppositeSide
    );
    const isReduceOnly = oppositePosition !== undefined;

    // For reduce-only orders, clamp to position size
    let validatedAmount = amount;
    if (isReduceOnly && oppositePosition) {
      validatedAmount = clampReduceOnlyQuantity(amount, oppositePosition.size, normalizedSymbol);
      if (validatedAmount <= 0) {
        // Reject order if clamped amount is invalid
        const order: Order = {
          id: `bt_${Date.now()}_${Math.random().toString(36).slice(2, 11)}`,
          symbol: normalizedSymbol,
          side,
          amount,
          price: orderPrice,
          status: 'rejected',
          timestamp: this.currentTime,
        };
        return order;
      }
    }

    // Validate order
    const validation = validateOrderUtil(normalizedSymbol, side, validatedAmount, orderPrice, {
      isReduceOnly,
      positionSize: oppositePosition?.size,
    });

    if (!validation.valid) {
      // Attempt fallback rounding
      const fallback = attemptFallbackRounding(
        normalizedSymbol,
        validatedAmount,
        orderPrice,
        isReduceOnly
      );
      if (fallback && fallback.valid && fallback.validatedQuantity) {
        // Clamp fallback to position size if reduce-only
        if (isReduceOnly && oppositePosition) {
          validatedAmount = Math.min(fallback.validatedQuantity, oppositePosition.size);
        } else {
          validatedAmount = fallback.validatedQuantity;
        }
      } else {
        // Reject order if validation fails and no fallback
        const order: Order = {
          id: `bt_${Date.now()}_${Math.random().toString(36).slice(2, 11)}`,
          symbol: normalizedSymbol,
          side,
          amount,
          price: orderPrice,
          status: 'rejected',
          timestamp: this.currentTime,
        };
        return order;
      }
    } else if (validation.validatedQuantity) {
      // Use validated quantity
      validatedAmount = validation.validatedQuantity;
      // Clamp to position size if reduce-only
      if (isReduceOnly && oppositePosition) {
        validatedAmount = Math.min(validatedAmount, oppositePosition.size);
      }
    }

    const order: Order = {
      id: `bt_${Date.now()}_${Math.random().toString(36).slice(2, 11)}`,
      symbol: normalizedSymbol,
      side,
      amount: validatedAmount,
      price: orderPrice,
      status: 'open',
      timestamp: this.currentTime,
    };

    this.orders.push(order);

    // Execute order immediately at the current historical price
    this.executeOrder(order, orderLeverage, isReduceOnly);

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
   * Get total fees paid during backtest
   */
  getTotalFees(): number {
    return this.totalFees;
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

  private async closePosition(position: Position): Promise<void> {
    // Check if position was already closed
    const positionIndex = this.positions.indexOf(position);
    if (positionIndex < 0) {
      return; // Already closed
    }

    // Use placeOrder() to close the position - this ensures consistency with normal trading:
    // - Applies slippage (same as normal market orders)
    // - Uses executeOrder() which handles fees correctly
    // - Maintains consistency in P&L calculation
    const side = position.side === 'long' ? 'sell' : 'buy'; // Opposite side to close

    try {
      // placeOrder() will automatically detect this is a reduce-only order
      // (because opposite position exists) and handle it correctly
      await this.placeOrder(
        position.symbol,
        side,
        position.size,
        undefined, // Market order (no price = market order)
        position.leverage
      );
    } catch (error) {
      // If order placement fails, log error but don't throw
      // This prevents one failed close from stopping all closes
      const logger = UnifiedLogger.getInstance();
      logger.warn(
        `Failed to close position ${position.symbol} ${position.side} at end of backtest`,
        error instanceof Error ? { error: error.message } : { error: String(error) },
        'BacktestExchange'
      );
    }
  }

  private getCurrentPrice(symbol: string): number {
    // Normalize symbol to avoid duplicates like BTC/USDT/USDT
    const normalized = normalizeSymbol(symbol);
    // Prefer lower timeframe data for more granular pricing
    const preferredKeys = [`${normalized}_3m`, `${normalized}_4h`];

    // 1) Try preferred timeframes first
    for (const key of preferredKeys) {
      const candles = this.historicalData.get(key);
      if (candles && candles.length > 0) {
        const idx = this.candleIndex.get(key) ?? -1;
        if (idx >= 0 && idx < candles.length) {
          return candles[idx].close;
        }
        // If index is valid but no data yet, try previous candle
        if (idx >= 0 && idx - 1 >= 0 && idx - 1 < candles.length) {
          return candles[idx - 1].close;
        }
      }
    }

    // 2) Fallback: any timeframe for this symbol
    const anyKey = [...this.historicalData.keys()].find(k => k.startsWith(`${normalized}_`));
    if (anyKey) {
      const candles = this.historicalData.get(anyKey);
      if (candles && candles.length > 0) {
        const idx = this.candleIndex.get(anyKey) ?? -1;
        if (idx >= 0 && idx < candles.length) {
          return candles[idx].close;
        }
        // If index is valid but no data yet, try previous candle
        if (idx >= 0 && idx - 1 >= 0 && idx - 1 < candles.length) {
          return candles[idx - 1].close;
        }
        // If no valid index, use last available candle
        if (candles.length > 0) {
          return candles[candles.length - 1].close;
        }
      }
    }

    // 3) Ultimate fallback: static base price
    // Log warning when falling back to base price (indicates cache miss)
    const basePrice = this.getBasePrice(normalized);
    // Only log if we're past initial time (to avoid spam during initialization)
    if (this.currentTime > 0) {
      // Use console.warn for backtest (logger might not be available)
      console.warn(
        `[BacktestExchange] Cache miss for ${normalized} at ${new Date(this.currentTime).toISOString()}, using base price ${basePrice}`
      );
    }
    return basePrice;
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

  private executeOrder(order: Order, leverage: number = 1, isReduceOnly: boolean = false): void {
    const currentPrice = this.getCurrentPrice(order.symbol);

    // For reduce-only orders, check if opposite position exists
    if (isReduceOnly) {
      const oppositeSide = order.side === 'buy' ? 'short' : 'long';
      const oppositePosition = this.positions.find(
        p => p.symbol === order.symbol && p.side === oppositeSide
      );

      if (!oppositePosition) {
        // Reject reduce-only order if no opposite position
        order.status = 'rejected';
        return;
      }

      // Clamp amount to position size (should already be done, but double-check)
      if (order.amount > oppositePosition.size) {
        order.amount = oppositePosition.size;
      }
    }

    // Simulate realistic order execution with slippage
    let executedPrice: number;
    if (order.price && order.price !== currentPrice) {
      // Limit order - check if it can fill at historical price
      // For reduce-only, allow crossing spread (closing position)
      const canFill =
        (order.side === 'buy' && order.price >= currentPrice) ||
        (order.side === 'sell' && order.price <= currentPrice) ||
        isReduceOnly; // Allow reduce-only to fill even if crossing spread

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

    // For reduce-only, ensure we don't exceed position size
    if (isReduceOnly) {
      const oppositeSide = order.side === 'buy' ? 'short' : 'long';
      const oppositePosition = this.positions.find(
        p => p.symbol === order.symbol && p.side === oppositeSide
      );
      if (oppositePosition && filledAmount > oppositePosition.size) {
        filledAmount = oppositePosition.size;
      }
    }

    const notionalValue = filledAmount * executedPrice;
    const marginRequired = notionalValue / leverage;

    if (order.side === 'buy' || order.side === 'sell') {
      // For reduce-only orders, margin check is less strict (closing reduces margin)
      // For opening orders, check margin requirement
      if (isReduceOnly || marginRequired <= this.account.availableMargin) {
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
        this.totalFees += fee;
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

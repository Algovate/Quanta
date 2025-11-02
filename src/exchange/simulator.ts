import { Exchange, Account, Position, Candlestick, Order } from './types.js';
import { TradingManager } from '../web/trading-manager.js';
import { normalizeSymbol } from '../utils/symbol-utils.js';
import { CompletedTrade } from '../types/index.js';
import {
  updatePositionWithPrice,
  verifyLeverageConsistency,
  updateAccountEquity,
} from './position-calculations.js';
import { Logger } from '../utils/logger.js';
import { PositionUpdateManager } from './position-manager.js';

// Constants for memory management
const MAX_COMPLETED_TRADES = 1000; // Keep last 1000 trades
const MAX_ORDERS_HISTORY = 500; // Keep last 500 orders

interface OrderMetadata {
  source: string;
  reason: string;
}

export class SimulatorExchange implements Exchange {
  private account: Account;
  private positions: Position[];
  private orders: Order[];
  private marketData: Map<string, Candlestick[]>;
  private dataSourceExchange?: Exchange;
  private completedTrades: CompletedTrade[] = [];
  private logger = Logger.getInstance('SimulatorExchange');
  private positionManager: PositionUpdateManager;
  private orderMetadata: Map<string, OrderMetadata> = new Map();

  constructor(initialBalance: number = 10000, dataSourceExchange?: Exchange) {
    this.account = {
      balance: initialBalance,
      equity: initialBalance,
      availableMargin: initialBalance,
      usedMargin: 0,
      marginRatio: 0,
      timestamp: Date.now(),
    };

    this.positions = [];
    this.orders = [];
    this.marketData = new Map();
    this.dataSourceExchange = dataSourceExchange;
    this.completedTrades = [];

    // Initialize position manager with config
    this.positionManager = new PositionUpdateManager({
      account: this.account,
      positions: this.positions,
      completedTrades: this.completedTrades,
      maxCompletedTrades: MAX_COMPLETED_TRADES,
    });

    // Only initialize mock market data if no external data source is provided
    if (!this.dataSourceExchange) {
      this.initializeMarketData();
    }
  }

  async getAccount(): Promise<Account> {
    // Update equity based on current positions
    await this.updateAccountEquity();
    return { ...this.account };
  }

  async getPositions(): Promise<Position[]> {
    // Update all position prices and PnL
    await this.updateAllPositions();
    return [...this.positions];
  }

  async getSnapshot(): Promise<{ account: Account; positions: Position[] }> {
    // Refresh prices once to maintain consistency between positions and equity
    await this.updateAllPositions();
    this.account.timestamp = Date.now();
    updateAccountEquity(this.account, this.positions);
    return { account: { ...this.account }, positions: this.positions.map(p => ({ ...p })) };
  }

  async getPositionsBySymbol(symbol: string): Promise<Position[]> {
    await this.updateAllPositions();
    return this.positions.filter(p => p.symbol === symbol);
  }

  /**
   * Get total exposure across all positions (unlevered)
   *
   * Exposure represents the total unlevered notional value of all open positions.
   * Formula: Total Exposure = sum of all (size * markPrice)
   * This matches aggregates.totalNotional and workflow terminology for portfolio leverage.
   *
   * @returns Total exposure value (unlevered) and breakdown by symbol
   */
  async getTotalExposure(): Promise<{ totalValue: number; bySymbol: Record<string, number> }> {
    await this.updateAllPositions();
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

  /**
   * Get comprehensive portfolio metrics
   *
   * Calculation formulas:
   * - Total Leverage = Total Exposure / Equity (portfolio-level metric, not per-position)
   *   Where Total Exposure is UNLEVERED (size * price)
   * - Average Leverage = mean of individual position leverages (calculated elsewhere)
   * - Total Exposure = sum of all (size * markPrice) - unlevered, matches aggregates.totalNotional
   * - Total Unrealized P&L = sum of all position unrealized P&L
   *
   * @returns Portfolio metrics including exposure, P&L, and leverage
   */
  async getPortfolioMetrics(): Promise<{
    totalPositions: number;
    totalExposure: number;
    totalUnrealizedPnl: number;
    exposureBySymbol: Record<string, number>;
    pnlBySymbol: Record<string, number>;
    leverage: number;
  }> {
    await this.updateAllPositions();

    const exposure = await this.getTotalExposure();
    const totalUnrealizedPnl = this.positions.reduce((sum, pos) => sum + pos.unrealizedPnl, 0);

    const pnlBySymbol: Record<string, number> = {};
    this.positions.forEach(position => {
      pnlBySymbol[position.symbol] = (pnlBySymbol[position.symbol] || 0) + position.unrealizedPnl;
    });

    // Total leverage = total exposure / equity (portfolio-level metric)
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

  /**
   * Get completed trades (for performance analysis)
   */
  getCompletedTrades(): CompletedTrade[] {
    return [...this.completedTrades];
  }

  async getCandlesticks(
    symbol: string,
    timeframe: string,
    limit: number = 100
  ): Promise<Candlestick[]> {
    // Try real data source first
    if (this.dataSourceExchange) {
      try {
        const candles = await this.dataSourceExchange.getCandlesticks(symbol, timeframe, limit);
        this.updateMarketData(symbol, timeframe, candles);
        return candles.slice(-limit);
      } catch (error) {
        console.warn(
          `Failed to fetch real market data for ${symbol} ${timeframe}, falling back to mock data:`,
          error
        );
      }
    }

    // Use cached data or generate mock data
    const key = `${symbol}_${timeframe}`;
    let candles = this.marketData.get(key);

    if (!candles) {
      candles = this.generateMockCandlesticks(symbol, timeframe, limit);
      this.marketData.set(key, candles);
    }

    return candles.slice(-limit);
  }

  /**
   * Update market data for a symbol/timeframe
   * Allows MarketDataProvider to inject fetched market data into the simulator's internal map
   * This ensures getTicker() uses the same prices as signal generation
   */
  updateMarketData(symbol: string, timeframe: string, candles: Candlestick[]): void {
    const key = `${symbol}_${timeframe}`;
    this.marketData.set(key, candles);
  }

  async placeOrder(
    symbol: string,
    side: 'buy' | 'sell',
    amount: number,
    price?: number,
    leverage: number = 1
  ): Promise<Order> {
    const normalizedSymbol = normalizeSymbol(symbol);
    const currentPrice = this.getBasePrice(normalizedSymbol);
    const orderPrice = price || currentPrice;

    const order: Order = {
      id: `sim_${Date.now()}_${Math.random().toString(36).substring(2, 11)}`,
      symbol: normalizedSymbol,
      side,
      amount,
      price: orderPrice,
      status: 'open', // Start as open, will be updated by executeOrder
      timestamp: Date.now(),
    };

    this.orders.push(order);

    // Try to infer source from call stack (fallback to 'AI' for simulator context)
    // This will be overridden by explicit metadata if set via setOrderMetadata
    if (!this.orderMetadata.has(order.id)) {
      // Infer from calling context - check if we can determine the source
      const source = this.inferOrderSource();
      this.orderMetadata.set(order.id, {
        source,
        reason: source === 'AI' ? 'signal' : 'unknown',
      });
    }

    // Execute the order immediately to simulate real exchange behavior
    await this.executeOrder(order, leverage);

    return order;
  }

  /**
   * Set metadata for an order (source and reason)
   * This allows external code (like OrderExecutor) to specify the order source
   */
  setOrderMetadata(orderId: string, source: string, reason: string): void {
    this.orderMetadata.set(orderId, { source, reason });
  }

  /**
   * Infer order source from calling context
   * Checks the call stack to determine where the order came from
   */
  private inferOrderSource(): string {
    try {
      const stack = new Error().stack;
      if (!stack) return 'AI';

      // Check call stack for known patterns
      if (stack.includes('OrderExecutor') && stack.includes('executeSignal')) {
        return 'AI';
      }
      if (stack.includes('OrderExecutor') && stack.includes('executeStopLoss')) {
        return 'stop-loss';
      }
      if (stack.includes('OrderExecutor') && stack.includes('executeTakeProfit')) {
        return 'take-profit';
      }
      if (stack.includes('executePositionClose') || stack.includes('PositionMonitor')) {
        // This could be stop-loss, take-profit, or auto-close
        // We'll use the metadata set by monitor.ts if available
        return 'stop-loss'; // Default fallback
      }
      if (stack.includes('api-service') || stack.includes('placeOrderService')) {
        return 'manual';
      }

      // Default for simulator context (usually AI signals)
      return 'AI';
    } catch {
      // If stack trace analysis fails, default to AI
      return 'AI';
    }
  }

  /**
   * Get metadata for an order, with fallback to defaults
   */
  private getOrderMetadata(orderId: string): OrderMetadata {
    return (
      this.orderMetadata.get(orderId) || {
        source: 'AI',
        reason: 'signal',
      }
    );
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
    const normalizedSymbol = normalizeSymbol(symbol);

    // Try real data source first
    if (this.dataSourceExchange) {
      try {
        return await this.dataSourceExchange.getTicker(normalizedSymbol);
      } catch (error) {
        console.warn(
          `Failed to fetch real ticker data for ${normalizedSymbol}, falling back to mock data:`,
          error
        );
      }
    }

    // Try to get price from market data (prefer shorter timeframes for recency)
    const price = this.getPriceFromMarketData(normalizedSymbol);
    if (price !== null) {
      return { price, timestamp: Date.now() };
    }

    // Fall back to base price
    return {
      price: this.getBasePrice(normalizedSymbol),
      timestamp: Date.now(),
    };
  }

  /**
   * Get latest price from market data map
   * Checks multiple timeframes, preferring shorter ones for more recent prices
   */
  private getPriceFromMarketData(symbol: string): number | null {
    const timeframes = ['3m', '4h', '1m'];

    for (const timeframe of timeframes) {
      const key = `${symbol}_${timeframe}`;
      const candles = this.marketData.get(key);

      if (candles && candles.length > 0) {
        const latestPrice = candles[candles.length - 1].close;
        if (latestPrice > 0 && !isNaN(latestPrice)) {
          return latestPrice;
        }
      }
    }

    return null;
  }

  getExchangeName(): string {
    return 'simulator';
  }

  isTestnetMode(): boolean {
    return false; // Simulator is not a real exchange, so it's not testnet
  }

  private initializeMarketData(): void {
    const symbols = ['BTC/USDT', 'ETH/USDT', 'SOL/USDT'];
    const timeframes = ['1m', '3m', '4h', '1d'];

    symbols.forEach(symbol => {
      timeframes.forEach(timeframe => {
        const key = `${symbol}_${timeframe}`;
        this.marketData.set(key, this.generateMockCandlesticks(symbol, timeframe, 100));
      });
    });
  }

  private generateMockCandlesticks(
    symbol: string,
    timeframe: string,
    count: number
  ): Candlestick[] {
    const candles: Candlestick[] = [];
    const basePrice = this.getBasePrice(symbol);
    let currentPrice = basePrice;
    const timestamp = Date.now() - count * this.getTimeframeMs(timeframe);

    for (let i = 0; i < count; i++) {
      const volatility = 0.02; // 2% volatility
      const change = (Math.random() - 0.5) * volatility;
      const open = currentPrice;
      const close = open * (1 + change);
      const high = Math.max(open, close) * (1 + Math.random() * 0.01);
      const low = Math.min(open, close) * (1 - Math.random() * 0.01);
      const volume = Math.random() * 1000;

      candles.push({
        timestamp: timestamp + i * this.getTimeframeMs(timeframe),
        open,
        high,
        low,
        close,
        volume,
      });

      currentPrice = close;
    }

    return candles;
  }

  private getBasePrice(symbol: string): number {
    // Normalize symbol by removing duplicate /USDT
    const normalizedSymbol = symbol.replace(/\/USDT\/USDT$/, '/USDT');

    const prices: { [key: string]: number } = {
      'BTC/USDT': 45000,
      'ETH/USDT': 3000,
      'SOL/USDT': 100,
    };

    // Try exact match first
    if (prices[normalizedSymbol]) {
      return prices[normalizedSymbol];
    }

    // Try to extract coin name and use default
    const match = normalizedSymbol.match(/^([A-Z]+)/);
    const coin = match ? match[1] : 'USDT';

    // Return a sensible default based on coin type
    return coin === 'BTC' ? 45000 : coin === 'ETH' ? 3000 : 100;
  }

  private getTimeframeMs(timeframe: string): number {
    const timeframes: { [key: string]: number } = {
      '1m': 60 * 1000,
      '3m': 3 * 60 * 1000,
      '5m': 5 * 60 * 1000,
      '15m': 15 * 60 * 1000,
      '1h': 60 * 60 * 1000,
      '4h': 4 * 60 * 60 * 1000,
      '1d': 24 * 60 * 60 * 1000,
    };
    return timeframes[timeframe] || 60 * 1000;
  }

  private async getCurrentPrice(symbol: string): Promise<number> {
    // If we have a real data source exchange, try to get real-time price
    if (this.dataSourceExchange) {
      try {
        const ticker = await this.dataSourceExchange.getTicker(symbol);
        return ticker.price;
      } catch (error) {
        // Fall back to mock data if real data fetch fails
        console.warn(`Failed to fetch real price for ${symbol}, using mock data:`, error);
      }
    }

    // Fall back to mock candlesticks
    const key = `${symbol}_3m`;
    const candles = this.marketData.get(key);
    if (candles && candles.length > 0) {
      return candles[candles.length - 1].close;
    }
    return this.getBasePrice(symbol);
  }

  private async executeOrder(order: Order, leverage: number = 1): Promise<void> {
    // Use current ticker-derived price (same source used for deviation checks)
    const currentPrice = await this.getCurrentPrice(order.symbol);

    // Simulate realistic order execution behavior
    let executedPrice: number;

    if (order.price && order.price !== currentPrice) {
      // Limit order - check if it can fill at current market price
      const canFill =
        (order.side === 'buy' && order.price >= currentPrice) ||
        (order.side === 'sell' && order.price <= currentPrice);

      if (!canFill) {
        // Limit order cannot fill immediately - keep as open
        order.status = 'open';
        // Emit open status so UI knows it's still pending
        try {
          const metadata = this.getOrderMetadata(order.id);
          TradingManager.getInstance().pushOrder({
            id: order.id,
            timestamp: Date.now(),
            symbol: order.symbol,
            side: order.side,
            amount: order.amount,
            price: order.price,
            status: order.status,
            source: metadata.source,
            reason: metadata.reason,
          });
        } catch {
          // TradingManager might not be initialized in backtest mode
          // This is non-critical, so we silently ignore
        }
        return;
      }
      executedPrice = order.price;
    } else {
      // Market order - apply realistic slippage
      const slippagePercent = Math.random() * 0.1; // 0-0.1% slippage
      const slippageMultiplier = order.side === 'buy' ? 1 + slippagePercent : 1 - slippagePercent;
      executedPrice = currentPrice * slippageMultiplier;
    }

    const notionalValue = order.amount * executedPrice;
    const marginRequired = notionalValue / leverage;

    // Check margin requirements
    if (marginRequired <= this.account.availableMargin) {
      // Execute the order using position manager
      this.positionManager.updatePosition(
        order.symbol,
        order.side,
        order.amount,
        executedPrice,
        leverage
      );

      // Immediately refresh marks so unrealized P&L reflects latest price within the same cycle
      try {
        await this.updateAllPositions();
        updateAccountEquity(this.account, this.positions);
      } catch (e) {
        const err = e as Error;
        this.logger.warn(`Failed to refresh marks after order for ${order.symbol}`, {
          error: err?.message || String(e),
        });
      }

      // Update order with execution details
      order.status = 'filled';
      order.price = executedPrice; // Update with actual execution price

      // Prevent memory leak: keep only last N orders
      if (this.orders.length > MAX_ORDERS_HISTORY) {
        const removedOrder = this.orders.shift(); // Remove oldest order
        // Also clean up metadata for removed order
        if (removedOrder) {
          this.orderMetadata.delete(removedOrder.id);
        }
      }

      // Emit filled status
      try {
        const metadata = this.getOrderMetadata(order.id);
        TradingManager.getInstance().pushOrder({
          id: order.id,
          timestamp: Date.now(),
          symbol: order.symbol,
          side: order.side,
          amount: order.amount,
          price: order.price,
          status: order.status,
          source: metadata.source,
          reason: metadata.reason,
        });
      } catch {
        // TradingManager might not be initialized in backtest mode
        // This is non-critical, so we silently ignore
      }
    } else {
      // Insufficient margin - reject order
      order.status = 'rejected';
      try {
        const metadata = this.getOrderMetadata(order.id);
        TradingManager.getInstance().pushOrder({
          id: order.id,
          timestamp: Date.now(),
          symbol: order.symbol,
          side: order.side,
          amount: order.amount,
          price: order.price,
          status: order.status,
          source: metadata.source,
          reason: metadata.reason,
        });
      } catch {
        // TradingManager might not be initialized in backtest mode
        // This is non-critical, so we silently ignore
      }
    }
  }

  private async updateAllPositions(): Promise<void> {
    for (const position of this.positions) {
      const currentPrice = await this.getCurrentPrice(position.symbol);
      updatePositionWithPrice(position, currentPrice);

      // Verify leverage consistency
      const leverageCheck = verifyLeverageConsistency(position);
      // Only log when there is a meaningful mismatch on the notional-based check;
      // margin-based derived figure can legitimately differ due to definition.
      if (!leverageCheck.isValid) {
        this.logger.debug(`Position leverage mismatch for ${position.symbol}:`, {
          stored: leverageCheck.stored,
          fromNotional: leverageCheck.fromNotional,
          fromMargin: leverageCheck.fromMargin,
          notional: position.notional,
          marginUsed: position.marginUsed,
          size: position.size,
          markPrice: currentPrice,
        });
      }
    }
  }

  /**
   * Update account equity and related metrics using shared calculation utilities
   */
  private async updateAccountEquity(): Promise<void> {
    await this.updateAllPositions();
    this.account.timestamp = Date.now();
    updateAccountEquity(this.account, this.positions);
  }
}

import { Exchange, Account, Position, Candlestick, Order } from './types.js';
import { TradingManager } from '../web/trading-manager.js';
import { normalizeSymbol } from '../utils/symbol-utils.js';
import { shouldCreatePositionAfterClose } from '../utils/position-close-utils.js';
import { POSITION_CLOSING } from '../execution/constants.js';
import { CompletedTrade } from '../types/index.js';
import {
  createPosition,
  updatePositionWithPrice,
  verifyLeverageConsistency,
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
import { Logger } from '../utils/logger.js';

// Constants for memory management
const MAX_COMPLETED_TRADES = 1000; // Keep last 1000 trades
const MAX_ORDERS_HISTORY = 500; // Keep last 500 orders

export class SimulatorExchange implements Exchange {
  private account: Account;
  private positions: Position[];
  private orders: Order[];
  private marketData: Map<string, Candlestick[]>;
  private dataSourceExchange?: Exchange;
  private completedTrades: CompletedTrade[] = [];
  private logger = Logger.getInstance('SimulatorExchange');

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

  async getPositionsBySymbol(symbol: string): Promise<Position[]> {
    await this.updateAllPositions();
    return this.positions.filter(p => p.symbol === symbol);
  }

  /**
   * Get total exposure across all positions
   *
   * Exposure represents the total notional value of all open positions.
   * Formula: Total Exposure = sum of all position.notional
   * where position.notional = size * markPrice * leverage
   *
   * @returns Total exposure value and breakdown by symbol
   */
  async getTotalExposure(): Promise<{ totalValue: number; bySymbol: Record<string, number> }> {
    await this.updateAllPositions();
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

  /**
   * Get comprehensive portfolio metrics
   *
   * Calculation formulas:
   * - Total Leverage = Total Exposure / Equity
   *   (This is the portfolio-level leverage, not per-position leverage)
   * - Average Leverage = mean of individual position leverages (calculated elsewhere)
   * - Total Exposure = sum of all position notional values
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
    // If we have a real data source exchange, delegate to it
    if (this.dataSourceExchange) {
      try {
        return await this.dataSourceExchange.getCandlesticks(symbol, timeframe, limit);
      } catch (error) {
        // Fall back to mock data if real data fetch fails
        console.warn(
          `Failed to fetch real market data for ${symbol} ${timeframe}, falling back to mock data:`,
          error
        );
      }
    }

    // Fall back to mock data generation
    const key = `${symbol}_${timeframe}`;
    let candles = this.marketData.get(key);

    if (!candles) {
      candles = this.generateMockCandlesticks(symbol, timeframe, limit);
      this.marketData.set(key, candles);
    }

    return candles.slice(-limit);
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

    // Execute the order immediately to simulate real exchange behavior
    await this.executeOrder(order, leverage);

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
    // If we have a real data source exchange, delegate to it
    if (this.dataSourceExchange) {
      try {
        return await this.dataSourceExchange.getTicker(symbol);
      } catch (error) {
        // Fall back to mock price if real data fetch fails
        console.warn(
          `Failed to fetch real ticker data for ${symbol}, falling back to mock data:`,
          error
        );
        // Explicitly return mock data on error
        const mockPrice = this.getBasePrice(symbol);
        return {
          price: mockPrice,
          timestamp: Date.now(),
        };
      }
    }

    // Fall back to mock data
    const mockPrice = this.getBasePrice(symbol);
    return {
      price: mockPrice,
      timestamp: Date.now(),
    };
  }

  getExchangeName(): string {
    return 'simulator';
  }

  isTestnetMode(): boolean {
    return false; // Simulator is not a real exchange, so it's not testnet
  }

  private initializeMarketData(): void {
    const symbols = ['BTC/USDT', 'ETH/USDT', 'SOL/USDT'];
    const timeframes = ['3m', '4h'];

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
    const currentPrice = this.getBasePrice(order.symbol);

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
          TradingManager.getInstance().pushOrder({
            id: order.id,
            timestamp: Date.now(),
            symbol: order.symbol,
            side: order.side,
            amount: order.amount,
            price: order.price,
            status: order.status,
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
      // Execute the order
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

      // Update order with execution details
      order.status = 'filled';
      order.price = executedPrice; // Update with actual execution price

      // Prevent memory leak: keep only last N orders
      if (this.orders.length > MAX_ORDERS_HISTORY) {
        this.orders.shift(); // Remove oldest order
      }

      // Emit filled status
      try {
        TradingManager.getInstance().pushOrder({
          id: order.id,
          timestamp: Date.now(),
          symbol: order.symbol,
          side: order.side,
          amount: order.amount,
          price: order.price,
          status: order.status,
        });
      } catch {
        // TradingManager might not be initialized in backtest mode
        // This is non-critical, so we silently ignore
      }
    } else {
      // Insufficient margin - reject order
      order.status = 'rejected';
      try {
        TradingManager.getInstance().pushOrder({
          id: order.id,
          timestamp: Date.now(),
          symbol: order.symbol,
          side: order.side,
          amount: order.amount,
          price: order.price,
          status: order.status,
        });
      } catch {
        // TradingManager might not be initialized in backtest mode
        // This is non-critical, so we silently ignore
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

    // Check if there's an opposite position to close/reduce
    const oppositePosition = this.positions.find(
      p => p.symbol === symbol && p.side === oppositeSide
    );

    if (oppositePosition) {
      // Closing or reducing opposite position
      // Use tolerance from constants to handle floating point errors and price volatility
      const tolerance = oppositePosition.size * POSITION_CLOSING.CLOSE_TOLERANCE_PERCENT;
      const isFullClose = amount >= oppositePosition.size - tolerance;

      if (isFullClose) {
        // Full close: remove position completely
        const closedSize = oppositePosition.size;
        const remainingAmount = Math.max(0, amount - closedSize);

        // Calculate realized P&L and record completed trade using precision-safe arithmetic
        const realizedPnl = calculateRealizedPnl(
          oppositePosition.side,
          price,
          oppositePosition.entryPrice,
          closedSize,
          symbol
        );

        const completedTrade = createCompletedTrade(
          oppositePosition,
          price,
          Date.now(),
          this.completedTrades.length + 1,
          'signal'
        );

        this.completedTrades.push(completedTrade);

        // Prevent memory leak: keep only last N trades
        if (this.completedTrades.length > MAX_COMPLETED_TRADES) {
          this.completedTrades.shift(); // Remove oldest trade
        }

        // Update account with realized P&L using precision-safe arithmetic
        this.account.balance = roundToPrecision(
          safeAdd(this.account.balance, realizedPnl).toNumber(),
          EXCHANGE_PRECISION.USDT
        );

        // Calculate margin release plus P&L with precision
        const marginReleasePlusPnl = safeAdd(oppositePosition.marginUsed, realizedPnl).toNumber();
        this.account.availableMargin = roundToPrecision(
          safeAdd(this.account.availableMargin, marginReleasePlusPnl).toNumber(),
          EXCHANGE_PRECISION.USDT
        );

        this.account.usedMargin = roundToPrecision(
          safeSubtract(this.account.usedMargin, oppositePosition.marginUsed).toNumber(),
          EXCHANGE_PRECISION.USDT
        );

        // Close the position
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
        // Partial close: reduce position size using precision-safe arithmetic
        const ratio = safeDivide(amount, oppositePosition.size, 8).toNumber();
        const marginToReturn = roundToPrecision(
          safeMultiply(oppositePosition.marginUsed, ratio).toNumber(),
          EXCHANGE_PRECISION.USDT
        );

        // Update position size and margin using precision
        oppositePosition.size = roundToPrecision(
          safeSubtract(oppositePosition.size, amount).toNumber(),
          8 // Max precision for position sizes
        );
        oppositePosition.marginUsed = roundToPrecision(
          safeSubtract(oppositePosition.marginUsed, marginToReturn).toNumber(),
          EXCHANGE_PRECISION.USDT
        );

        // Calculate realized P&L for partial close
        const realizedPnl = calculateRealizedPnl(
          oppositePosition.side,
          price,
          oppositePosition.entryPrice,
          amount,
          symbol
        );

        // For partial closes, create a temporary position object for the closed portion
        const partialPosition: Position = {
          ...oppositePosition,
          size: amount,
        };
        const completedTrade = createCompletedTrade(
          partialPosition,
          price,
          Date.now(),
          this.completedTrades.length + 1,
          'signal'
        );

        this.completedTrades.push(completedTrade);

        // Position size and margin already updated above with precision

        // Update account with partial realized P&L using precision-safe arithmetic
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
      // No opposite position, create or update same-side position
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
        // Note: leverage might have changed, use the new leverage value
        existingPosition.notional = calculateNotional(
          existingPosition.size,
          existingPosition.markPrice,
          leverage
        );
        existingPosition.leverage = leverage;

        // Update account margins
        // Update account margins using precision-safe arithmetic
        this.account.availableMargin = roundToPrecision(
          safeSubtract(this.account.availableMargin, additionalMargin).toNumber(),
          EXCHANGE_PRECISION.USDT
        );
        this.account.usedMargin = roundToPrecision(
          safeAdd(this.account.usedMargin, additionalMargin).toNumber(),
          EXCHANGE_PRECISION.USDT
        );
      } else {
        // Create new position
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
    const position = createPosition(symbol, side, amount, price, leverage, Date.now());
    this.positions.push(position);
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
    calculateAccountEquity(this.account, this.positions);
  }
}

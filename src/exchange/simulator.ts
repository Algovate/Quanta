import { Exchange, Account, Position, Candlestick, Order } from './types.js';
import { TradingManager } from '../web/trading-manager.js';
import { normalizeSymbol, calculatePositionPnl } from '../utils/symbol-utils.js';
import { shouldCreatePositionAfterClose } from '../utils/position-close-utils.js';
import { POSITION_CLOSING } from '../execution/constants.js';
import { CompletedTrade } from '../types/index.js';

export class SimulatorExchange implements Exchange {
  private account: Account;
  private positions: Position[];
  private orders: Order[];
  private marketData: Map<string, Candlestick[]>;
  private dataSourceExchange?: Exchange;
  private completedTrades: CompletedTrade[] = [];

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
      id: `sim_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
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
          // Silently ignore TradingManager push errors
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

      // Update account balances
      this.account.availableMargin -= marginRequired;
      this.account.usedMargin += marginRequired;

      // Update order with execution details
      order.status = 'filled';
      order.price = executedPrice; // Update with actual execution price

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
        // Silently ignore TradingManager push errors
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
        // Silently ignore TradingManager push errors
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

        // Calculate realized P&L
        const realizedPnl = calculatePositionPnl(
          oppositePosition.side,
          price,
          oppositePosition.entryPrice,
          closedSize
        );

        // Record completed trade
        const completedTrade = {
          id: `trade_${this.completedTrades.length + 1}`,
          symbol: oppositePosition.symbol,
          side: oppositePosition.side,
          entryTime: oppositePosition.timestamp,
          exitTime: Date.now(),
          entryPrice: oppositePosition.entryPrice,
          exitPrice: price,
          size: closedSize,
          pnl: realizedPnl,
          pnlPercent: (realizedPnl / (closedSize * oppositePosition.entryPrice)) * 100,
          holdingPeriod: (Date.now() - oppositePosition.timestamp) / 1000, // Convert milliseconds to seconds
          reason: 'signal' as const,
        };

        this.completedTrades.push(completedTrade);

        // Update account with realized P&L
        this.account.balance += realizedPnl;
        this.account.availableMargin += oppositePosition.marginUsed + realizedPnl;
        this.account.usedMargin -= oppositePosition.marginUsed;

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
        // Partial close: reduce position size
        const ratio = amount / oppositePosition.size;
        const marginToReturn = oppositePosition.marginUsed * ratio;

        // Calculate realized P&L for partial close
        const realizedPnl = calculatePositionPnl(
          oppositePosition.side,
          price,
          oppositePosition.entryPrice,
          amount
        );

        // For partial closes, we still record a trade with the closed portion
        const completedTrade = {
          id: `trade_${this.completedTrades.length + 1}`,
          symbol: oppositePosition.symbol,
          side: oppositePosition.side,
          entryTime: oppositePosition.timestamp,
          exitTime: Date.now(),
          entryPrice: oppositePosition.entryPrice,
          exitPrice: price,
          size: amount,
          pnl: realizedPnl,
          pnlPercent: (realizedPnl / (amount * oppositePosition.entryPrice)) * 100,
          holdingPeriod: (Date.now() - oppositePosition.timestamp) / 1000,
          reason: 'signal' as const,
        };

        this.completedTrades.push(completedTrade);

        oppositePosition.size -= amount;
        oppositePosition.marginUsed -= marginToReturn;

        // Update account with partial realized P&L
        this.account.balance += realizedPnl;
        this.account.usedMargin -= marginToReturn;
        this.account.availableMargin += marginToReturn + realizedPnl;
      }
    } else {
      // No opposite position, create or update same-side position
      const existingPosition = this.positions.find(
        p => p.symbol === symbol && p.side === positionSide
      );

      if (existingPosition) {
        // Update existing position
        const totalValue = existingPosition.size * existingPosition.entryPrice + amount * price;
        const totalSize = existingPosition.size + amount;
        existingPosition.entryPrice = totalValue / totalSize;
        existingPosition.size = totalSize;

        // Calculate margin with leverage for the additional position
        const notionalValue = amount * price;
        const additionalMargin = notionalValue / leverage;
        existingPosition.marginUsed += additionalMargin;
        // Update notional with leverage (matches real exchanges: size * markPrice * leverage)
        // Note: leverage might have changed, use the new leverage value
        existingPosition.notional = totalSize * existingPosition.markPrice * leverage;
        existingPosition.leverage = leverage; // Update leverage

        // Update account margins
        this.account.availableMargin -= additionalMargin;
        this.account.usedMargin += additionalMargin;
      } else {
        // Create new position
        this.createNewPosition(symbol, positionSide, amount, price, leverage);
      }
    }
  }

  /**
   * Create a new position
   * 
   * Calculation formulas:
   * - Notional Value = amount * price (base position value)
   * - Margin Required = Notional Value / leverage
   * - Position Notional = Notional Value * leverage = size * markPrice * leverage
   *   (matches real exchanges: Binance, Hyperliquid, OKX, Coinbase all use this formula)
   * 
   * @param symbol - Trading symbol (e.g., 'BTC/USDT')
   * @param side - Position side ('long' or 'short')
   * @param amount - Position size in base currency
   * @param price - Entry price
   * @param leverage - Leverage multiplier (default: 1)
   */
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
      marginUsed: marginRequired, // Only margin, not full notional
      notional: notionalValue * leverage, // Full position value with leverage (matches real exchanges: size * markPrice * leverage)
      leverage: leverage, // Actual leverage used
      timestamp: Date.now(),
    });
  }

  private async updateAllPositions(): Promise<void> {
    for (const position of this.positions) {
      const currentPrice = await this.getCurrentPrice(position.symbol);
      position.markPrice = currentPrice;

      // Calculate P&L using utility function
      // Formula: For LONG: P&L = (currentPrice - entryPrice) * size
      //         For SHORT: P&L = (entryPrice - currentPrice) * size
      position.unrealizedPnl = calculatePositionPnl(
        position.side,
        currentPrice,
        position.entryPrice,
        position.size
      );

      // Notional = position size * current price * leverage (matches real exchanges)
      // This represents the total position value at current market price with leverage applied
      position.notional = position.size * currentPrice * position.leverage;

      // Verify leverage consistency: leverage = notional / (size * markPrice)
      // Also verify: leverage ≈ notional / marginUsed when marginUsed > 0
      if (position.marginUsed > 0) {
        const calculatedLeverageFromNotional = position.notional / (position.size * currentPrice);
        const calculatedLeverageFromMargin = position.notional / position.marginUsed;
        
        // Check if stored leverage matches calculated leverage (with tolerance for floating point)
        const tolerance = 0.01;
        if (
          Math.abs(position.leverage - calculatedLeverageFromNotional) > tolerance ||
          Math.abs(position.leverage - calculatedLeverageFromMargin) > tolerance
        ) {
          console.warn(
            `Position leverage mismatch for ${position.symbol}:`,
            {
              stored: position.leverage,
              fromNotional: calculatedLeverageFromNotional,
              fromMargin: calculatedLeverageFromMargin,
              notional: position.notional,
              marginUsed: position.marginUsed,
              size: position.size,
              markPrice: currentPrice,
            }
          );
        }
      }
    }
  }

  /**
   * Update account equity and related metrics
   * 
   * Calculation formulas:
   * - Used Margin = sum of all position.marginUsed
   * - Unrealized P&L = sum of all position.unrealizedPnl
   * - Equity = Balance + Unrealized P&L
   *   - Balance = Initial Capital + All Realized P&L (from closed positions)
   *   - Unrealized P&L = Current P&L from open positions (not yet locked in)
   * - Available Margin = Equity - Used Margin (cannot go below 0)
   * - Margin Ratio = Used Margin / Equity (0 if equity <= 0)
   * 
   * Note: Used margin is recalculated from positions to ensure consistency,
   * preventing floating-point accumulation errors.
   */
  private async updateAccountEquity(): Promise<void> {
    await this.updateAllPositions();

    // Reconcile used margin with current positions to ensure identity holds
    const recalculatedUsedMargin = this.positions.reduce(
      (sum, pos) => sum + (pos.marginUsed || 0),
      0
    );
    this.account.usedMargin = recalculatedUsedMargin;

    // Calculate total P&L from all open positions (unrealized)
    const unrealizedPnl = this.positions.reduce((sum, pos) => sum + pos.unrealizedPnl, 0);

    // Total equity = balance (initial cash + realized P&L from closed positions) + unrealized P&L from open positions
    this.account.equity = this.account.balance + unrealizedPnl;

    // Available margin = equity - used margin (margin locked in positions)
    this.account.availableMargin = Math.max(0, this.account.equity - this.account.usedMargin);

    // Margin ratio = used margin / equity
    this.account.marginRatio =
      this.account.equity > 0 ? this.account.usedMargin / this.account.equity : 0;

    // Update timestamp to current time for accurate equity history tracking
    this.account.timestamp = Date.now();

    // Verify: equity - usedMargin = availableMargin
    if (
      Math.abs(this.account.equity - this.account.usedMargin - this.account.availableMargin) > 0.01
    ) {
      console.warn('Account calculation mismatch!', {
        equity: this.account.equity,
        usedMargin: this.account.usedMargin,
        availableMargin: this.account.availableMargin,
        balance: this.account.balance,
        unrealizedPnl,
      });
    }
  }
}

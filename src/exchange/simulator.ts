import { Exchange, Account, Position, Candlestick, Order } from './types.js';
import { normalizeSymbol, calculatePositionPnl } from '../utils/symbol-utils.js';
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
    this.updateAccountEquity();
    return { ...this.account };
  }

  async getPositions(): Promise<Position[]> {
    // Update all position prices and PnL
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
    const orderPrice = price || this.getCurrentPrice(normalizedSymbol);

    const order: Order = {
      id: `sim_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
      symbol: normalizedSymbol,
      side,
      amount,
      price: orderPrice,
      status: 'open',
      timestamp: Date.now(),
    };

    this.orders.push(order);

    // Execute order immediately (synchronously) with leverage
    this.executeOrder(order, leverage);

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
        return {
          price: this.getCurrentPrice(symbol),
          timestamp: Date.now(),
        };
      }
    }

    // Fall back to mock data
    return {
      price: this.getCurrentPrice(symbol),
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

  private getCurrentPrice(symbol: string): number {
    const key = `${symbol}_3m`;
    const candles = this.marketData.get(key);
    if (candles && candles.length > 0) {
      return candles[candles.length - 1].close;
    }
    return this.getBasePrice(symbol);
  }

  private executeOrder(order: Order, leverage: number = 1): void {
    const currentPrice = this.getCurrentPrice(order.symbol);
    const executedPrice = order.price || currentPrice;
    const notionalValue = order.amount * executedPrice; // Total position value
    const marginRequired = notionalValue / leverage; // Margin needed with leverage

    if (order.side === 'buy' || order.side === 'sell') {
      // Check if we have enough margin
      if (marginRequired <= this.account.availableMargin) {
        // Create position first
        this.updatePosition(order.symbol, order.side, order.amount, executedPrice, leverage);

        // Update account balances
        // For futures: balance stays the same, only used margin increases
        // balance = initial cash - realized P&L only (not affected by opening positions)
        this.account.availableMargin -= marginRequired;
        this.account.usedMargin += marginRequired;

        order.status = 'filled';
        order.price = executedPrice;
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

    // Check if there's an opposite position to close/reduce
    const oppositePosition = this.positions.find(
      p => p.symbol === symbol && p.side === oppositeSide
    );

    if (oppositePosition) {
      // Closing or reducing opposite position
      if (amount >= oppositePosition.size) {
        // Full close: remove position and if there's remaining amount, open new
        const closedSize = oppositePosition.size;
        const remainingAmount = amount - closedSize;

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

        // If there's remaining amount, open new position
        if (remainingAmount > 0) {
          this.createNewPosition(symbol, positionSide, remainingAmount, price, leverage);
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
        existingPosition.notional = totalSize * this.getCurrentPrice(symbol);
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
      notional: notionalValue, // Full position value
      leverage: leverage, // Actual leverage used
      timestamp: Date.now(),
    });
  }

  private updateAllPositions(): void {
    this.positions.forEach(position => {
      const currentPrice = this.getCurrentPrice(position.symbol);
      position.markPrice = currentPrice;

      // Calculate P&L using utility function
      position.unrealizedPnl = calculatePositionPnl(
        position.side,
        currentPrice,
        position.entryPrice,
        position.size
      );

      // Notional = position size * current price
      position.notional = position.size * currentPrice;
    });
  }

  private updateAccountEquity(): void {
    this.updateAllPositions();

    // Calculate total P&L from all open positions (unrealized)
    const unrealizedPnl = this.positions.reduce((sum, pos) => sum + pos.unrealizedPnl, 0);

    // Total equity = balance (initial cash + realized P&L from closed positions) + unrealized P&L from open positions
    this.account.equity = this.account.balance + unrealizedPnl;

    // Available margin = equity - used margin (margin locked in positions)
    this.account.availableMargin = Math.max(0, this.account.equity - this.account.usedMargin);

    // Margin ratio = used margin / equity
    this.account.marginRatio =
      this.account.equity > 0 ? this.account.usedMargin / this.account.equity : 0;

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

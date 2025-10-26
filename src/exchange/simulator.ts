import { Exchange, Account, Position, Candlestick, Order } from './types';

export class SimulatorExchange implements Exchange {
  private account: Account;
  private positions: Position[];
  private orders: Order[];
  private marketData: Map<string, Candlestick[]>;

  constructor(initialBalance: number = 10000) {
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

    // Initialize with some sample market data
    this.initializeMarketData();
  }

  async getAccount(): Promise<Account> {
    // Update equity based on current positions
    this.updateAccountEquity();
    return { ...this.account };
  }

  async getPositions(): Promise<Position[]> {
    return [...this.positions];
  }

  async getCandlesticks(
    symbol: string,
    timeframe: string,
    limit: number = 100
  ): Promise<Candlestick[]> {
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
    price?: number
  ): Promise<Order> {
    const orderPrice = price || this.getCurrentPrice(symbol);
    const order: Order = {
      id: `sim_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
      symbol,
      side,
      amount,
      price: orderPrice,
      status: 'open',
      timestamp: Date.now(),
    };

    this.orders.push(order);

    // Simulate order execution
    setTimeout(() => {
      this.executeOrder(order);
    }, 100);

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
    const prices: { [key: string]: number } = {
      'BTC/USDT': 45000,
      'ETH/USDT': 3000,
      'SOL/USDT': 100,
    };
    return prices[symbol] || 100;
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

  private executeOrder(order: Order): void {
    const currentPrice = this.getCurrentPrice(order.symbol);
    const executedPrice = order.price || currentPrice;
    const value = order.amount * executedPrice;

    if (order.side === 'buy') {
      // Check if we have enough balance
      if (value <= this.account.availableMargin) {
        this.account.availableMargin -= value;
        this.account.usedMargin += value;

        // Update or create position
        this.updatePosition(order.symbol, order.side, order.amount, executedPrice);

        order.status = 'filled';
        order.price = executedPrice;
      } else {
        order.status = 'rejected';
      }
    } else {
      // Handle sell orders
      const position = this.positions.find(p => p.symbol === order.symbol && p.side === 'long');
      if (position && position.size >= order.amount) {
        const pnl = (executedPrice - position.entryPrice) * order.amount;
        this.account.balance += pnl;
        this.account.availableMargin += value;
        this.account.usedMargin -= value;

        // Update position
        position.size -= order.amount;
        if (position.size <= 0) {
          const index = this.positions.indexOf(position);
          this.positions.splice(index, 1);
        }

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
    price: number
  ): void {
    const existingPosition = this.positions.find(p => p.symbol === symbol && p.side === 'long');

    if (existingPosition) {
      // Update existing position
      const totalValue = existingPosition.size * existingPosition.entryPrice + amount * price;
      const totalSize = existingPosition.size + amount;
      existingPosition.entryPrice = totalValue / totalSize;
      existingPosition.size = totalSize;
    } else {
      // Create new position
      this.positions.push({
        symbol,
        side: 'long',
        size: amount,
        entryPrice: price,
        markPrice: price,
        unrealizedPnl: 0,
        marginUsed: amount * price,
        leverage: 1,
        timestamp: Date.now(),
      });
    }
  }

  private updateAccountEquity(): void {
    let totalPnl = 0;

    this.positions.forEach(position => {
      const currentPrice = this.getCurrentPrice(position.symbol);
      position.markPrice = currentPrice;
      position.unrealizedPnl = (currentPrice - position.entryPrice) * position.size;
      totalPnl += position.unrealizedPnl;
    });

    this.account.equity = this.account.balance + totalPnl;
  }
}

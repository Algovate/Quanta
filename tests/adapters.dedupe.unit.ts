import { DedupingExchangeAdapter } from '../src/exchange/adapters/dedupe.js';
import type { Exchange, Account, Position, Candlestick, Order } from '../src/exchange/types.js';

class StubExchange implements Exchange {
  public calls: Record<string, number> = {};
  getExchangeName(): string {
    return 'stub';
  }
  async getTicker(symbol: string): Promise<{ price: number; timestamp: number }> {
    this.calls[`getTicker:${symbol}`] = (this.calls[`getTicker:${symbol}`] ?? 0) + 1;
    return { price: Math.random() * 1000, timestamp: Date.now() };
  }
  async getSnapshot(): Promise<{ account: Account; positions: Position[] }> {
    this.calls['getSnapshot'] = (this.calls['getSnapshot'] ?? 0) + 1;
    return {
      account: {
        balance: 0,
        equity: 0,
        availableMargin: 0,
        usedMargin: 0,
        marginRatio: 0,
        timestamp: Date.now(),
      },
      positions: [],
    };
  }
  async getAccount(): Promise<Account> {
    this.calls['getAccount'] = (this.calls['getAccount'] ?? 0) + 1;
    return {
      balance: 0,
      equity: 0,
      availableMargin: 0,
      usedMargin: 0,
      marginRatio: 0,
      timestamp: Date.now(),
    };
  }
  async getPositions(): Promise<Position[]> {
    this.calls['getPositions'] = (this.calls['getPositions'] ?? 0) + 1;
    return [];
  }
  async getCandlesticks(_s: string, _t: string, _l: number): Promise<Candlestick[]> {
    this.calls['getCandlesticks'] = (this.calls['getCandlesticks'] ?? 0) + 1;
    return [];
  }
  async placeOrder(
    _s: string,
    _sd: 'buy' | 'sell',
    _a: number,
    _p?: number,
    _lvg?: number
  ): Promise<Order> {
    this.calls['placeOrder'] = (this.calls['placeOrder'] ?? 0) + 1;
    return {
      id: '1',
      symbol: 'X',
      side: 'buy',
      amount: 1,
      price: 1,
      status: 'open',
      timestamp: Date.now(),
    };
  }
  async cancelOrder(_id: string, _s: string): Promise<boolean> {
    this.calls['cancelOrder'] = (this.calls['cancelOrder'] ?? 0) + 1;
    return true;
  }
}

describe('DedupingExchangeAdapter', () => {
  it('dedupes concurrent identical getTicker calls', async () => {
    const inner = new StubExchange();
    const adapter = new DedupingExchangeAdapter(inner, {
      ttl: { ticker: 400, snapshot: 0, positions: 0, account: 0, candles: 0 },
    });
    const p1 = adapter.getTicker('BTC/USDT:USDT');
    const p2 = adapter.getTicker('BTC/USDT:USDT');
    const [r1, r2] = await Promise.all([p1, p2]);
    expect(inner.calls['getTicker:BTC/USDT:USDT']).toBe(1);
    expect(r1.price).toBeGreaterThan(0);
    expect(r2.price).toBeGreaterThan(0);
  });

  it('uses TTL cache for rapid repeat calls', async () => {
    const inner = new StubExchange();
    const adapter = new DedupingExchangeAdapter(inner, {
      ttl: { ticker: 500, snapshot: 0, positions: 0, account: 0, candles: 0 },
    });
    await adapter.getTicker('ETH/USDT:USDT');
    await adapter.getTicker('ETH/USDT:USDT');
    expect(inner.calls['getTicker:ETH/USDT:USDT']).toBe(1);
  });
});

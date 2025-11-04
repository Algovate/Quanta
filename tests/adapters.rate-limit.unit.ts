import { RateLimitedExchangeAdapter } from '../src/exchange/adapters/rate-limit.js';
import type { Exchange, Account, Position, Candlestick, Order } from '../src/exchange/types.js';

class SlowStub implements Exchange {
  calls = 0;
  getExchangeName(): string {
    return 'slow';
  }
  async getTicker(symbol: string): Promise<{ price: number; timestamp: number }> {
    this.calls++;
    await new Promise(r => setTimeout(r, 10));
    return { price: 1, timestamp: Date.now() };
  }
  async getSnapshot(): Promise<{ account: Account; positions: Position[] }> {
    throw new Error('n/a');
  }
  async getAccount(): Promise<Account> {
    throw new Error('n/a');
  }
  async getPositions(): Promise<Position[]> {
    throw new Error('n/a');
  }
  async getCandlesticks(_s: string, _t: string, _l: number): Promise<Candlestick[]> {
    return [];
  }
  async placeOrder(
    _s: string,
    _sd: 'buy' | 'sell',
    _a: number,
    _p?: number,
    _lvg?: number
  ): Promise<Order> {
    throw new Error('n/a');
  }
  async cancelOrder(_id: string, _s: string): Promise<boolean> {
    return true;
  }
}

describe('RateLimitedExchangeAdapter', () => {
  it('limits concurrency for getTicker', async () => {
    const inner = new SlowStub();
    const limited = new RateLimitedExchangeAdapter(inner, {
      methods: { getTicker: { rpm: 1000, concurrency: 2 } as any },
    });
    const start = Date.now();
    await Promise.all([
      limited.getTicker('A'),
      limited.getTicker('B'),
      limited.getTicker('C'),
      limited.getTicker('D'),
    ]);
    const duration = Date.now() - start;
    // With concurrency=2 and ~10ms per call, total should be >= ~20ms
    expect(duration).toBeGreaterThanOrEqual(18);
    expect(inner.calls).toBe(4);
  });
});

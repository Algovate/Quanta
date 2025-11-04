import { PaperExchange } from '../src/exchange/paper.js';
import { DedupingExchangeAdapter } from '../src/exchange/adapters/dedupe.js';
import { RateLimitedExchangeAdapter } from '../src/exchange/adapters/rate-limit.js';
import type { Exchange, Account, Position, Candlestick, Order } from '../src/exchange/types.js';

class CountingExchange implements Exchange {
  public tickerCalls = 0;
  getExchangeName(): string {
    return 'counting';
  }
  async getTicker(_symbol: string): Promise<{ price: number; timestamp: number }> {
    this.tickerCalls++;
    await new Promise(r => setTimeout(r, 5));
    return { price: 100, timestamp: Date.now() };
  }
  async getSnapshot(): Promise<{ account: Account; positions: Position[] }> {
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
    return [];
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
    throw new Error('no-op');
  }
  async cancelOrder(_id: string, _s: string): Promise<boolean> {
    return true;
  }
}

describe('Paper mode with adapters - ticker spam control', () => {
  it('collapses concurrent requests and limits concurrency', async () => {
    const real = new CountingExchange();
    const dedup = new DedupingExchangeAdapter(real, {
      ttl: { ticker: 300, snapshot: 0, positions: 0, account: 0, candles: 0 },
    });
    const limited = new RateLimitedExchangeAdapter(dedup, {
      methods: { getTicker: { rpm: 1000, concurrency: 2 } as any },
    });
    const paper = new PaperExchange(limited, 10000);

    const start = Date.now();
    // 10 rapid calls for the SAME symbol should dedupe heavily
    await Promise.all(Array.from({ length: 10 }).map(() => paper.getTicker('BTC/USDT:USDT')));
    const dur = Date.now() - start;

    // Under dedupe, inner ticker calls should be ~1 (or very few) for the burst
    expect(real.tickerCalls).toBeLessThanOrEqual(3);
    // With concurrency=2 and 5ms per inner call, overall duration should be >= ~5ms
    expect(dur).toBeGreaterThanOrEqual(5);
  });
});

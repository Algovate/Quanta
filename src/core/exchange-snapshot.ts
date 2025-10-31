import { Exchange, Account, Position } from '../exchange/types.js';
import { withRetry } from '../utils/retry.js';

export class ExchangeSnapshotService {
  private exchange: Exchange;

  constructor(exchange: Exchange) {
    this.exchange = exchange;
  }

  async getSnapshot(): Promise<{ account: Account; positions: Position[] }> {
    // Prefer native exchange snapshot if available
    const maybeAny = this.exchange as unknown as {
      getSnapshot?: () => Promise<{ account: Account; positions: Position[] }>;
    };
    if (typeof maybeAny.getSnapshot === 'function') {
      return await maybeAny.getSnapshot!();
    }
    // Fallback: fetch sequentially to avoid double-refresh timing drift
    const account = await this.exchange.getAccount();
    const positions = await this.exchange.getPositions();
    return { account, positions };
  }

  async getTicker(symbol: string): Promise<{ price: number; timestamp: number }> {
    return withRetry(() => this.exchange.getTicker(symbol), { attempts: 2, delayMs: 80 });
  }
}

import { Exchange, Account, Position } from '../exchange/types.js';
import { withRetry, createRetryConfig } from '../utils/retry.js';

export class ExchangeSnapshotService {
  private exchange: Exchange;

  constructor(exchange: Exchange) {
    this.exchange = exchange;
  }

  /**
   * Get atomic snapshot of account and positions
   * Prefers native exchange snapshot if available (ensures consistency)
   * Fallback: fetches sequentially but warns about potential time drift
   *
   * IMPORTANT: For accurate PnL calculations, account equity should match
   * the sum of balance + sum of positions' unrealized PnL. Using getSnapshot()
   * ensures this consistency.
   */
  async getSnapshot(): Promise<{ account: Account; positions: Position[] }> {
    // Prefer native exchange snapshot if available (ensures atomicity)
    const maybeAny = this.exchange as unknown as {
      getSnapshot?: () => Promise<{ account: Account; positions: Position[] }>;
    };
    if (typeof maybeAny.getSnapshot === 'function') {
      const snapshot = await maybeAny.getSnapshot!();
      // Verify consistency: equity should equal balance + sum of unrealized PnL
      const calculatedEquity =
        snapshot.account.balance +
        snapshot.positions.reduce((sum, p) => sum + (p.unrealizedPnl || 0), 0);
      const equityDiff = Math.abs(snapshot.account.equity - calculatedEquity);
      // Allow small drift due to rounding (0.01 USD tolerance)
      if (equityDiff > 0.01) {
        console.warn(
          `Potential snapshot inconsistency detected: equity=${snapshot.account.equity}, calculated=${calculatedEquity}, diff=${equityDiff}`
        );
      }
      return snapshot;
    }

    // Fallback: fetch sequentially (potential time drift between calls)
    // Log warning about potential inconsistency
    console.warn(
      'Exchange does not support atomic getSnapshot() - fetching sequentially may cause time drift'
    );
    const account = await this.exchange.getAccount();
    const positions = await this.exchange.getPositions();

    // Verify consistency after sequential fetch
    const calculatedEquity =
      account.balance + positions.reduce((sum, p) => sum + (p.unrealizedPnl || 0), 0);
    const equityDiff = Math.abs(account.equity - calculatedEquity);
    if (equityDiff > 0.01) {
      console.warn(
        `Snapshot inconsistency after sequential fetch: equity=${account.equity}, calculated=${calculatedEquity}, diff=${equityDiff}`
      );
    }

    return { account, positions };
  }

  async getTicker(symbol: string): Promise<{ price: number; timestamp: number }> {
    return withRetry(
      () => this.exchange.getTicker(symbol),
      createRetryConfig({
        maxRetries: 2,
        baseDelay: 80,
        maxDelay: 500,
      })
    );
  }
}

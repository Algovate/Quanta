import { Exchange, Account, Position } from '../exchange/types.js';
import { withRetry, createRetryConfig } from '../utils/retry.js';
import { TOLERANCES } from '../execution/constants/tolerances.js';
import { UnifiedLogger } from '../logging/index.js';

export class ExchangeSnapshotService {
  private exchange: Exchange;
  private readonly logger: UnifiedLogger;
  private readonly context = 'ExchangeSnapshot';

  constructor(exchange: Exchange) {
    this.exchange = exchange;
    this.logger = UnifiedLogger.getInstance();
  }

  /**
   * Get atomic snapshot of account and positions
   * Prefers native exchange snapshot if available (ensures consistency)
   * Fallback: fetches in parallel (Promise.all) to minimize time drift
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
      // Allow small drift due to rounding
      if (equityDiff > TOLERANCES.EQUITY_DRIFT) {
        this.logger.warn(
          'Potential snapshot inconsistency detected',
          {
            equity: snapshot.account.equity,
            calculated: calculatedEquity,
            diff: equityDiff,
          },
          this.context
        );
      }
      return snapshot;
    }

    // Fallback: fetch in parallel to minimize time drift between calls
    // Note: Even with Promise.all, there's no guarantee of true atomicity,
    // but parallel fetching reduces the time window for inconsistency
    this.logger.warn(
      'Exchange does not support native atomic getSnapshot() - using parallel fetch fallback',
      {},
      this.context
    );
    const [account, positions] = await Promise.all([
      this.exchange.getAccount(),
      this.exchange.getPositions(),
    ]);

    // Verify consistency after parallel fetch
    const calculatedEquity =
      account.balance + positions.reduce((sum, p) => sum + (p.unrealizedPnl || 0), 0);
    const equityDiff = Math.abs(account.equity - calculatedEquity);
    if (equityDiff > TOLERANCES.EQUITY_DRIFT) {
      this.logger.warn(
        'Snapshot inconsistency detected after parallel fetch - data may be slightly stale',
        {
          equity: account.equity,
          calculated: calculatedEquity,
          diff: equityDiff,
          threshold: TOLERANCES.EQUITY_DRIFT,
        },
        this.context
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

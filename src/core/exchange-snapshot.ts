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

    // Fallback: fetch sequentially (potential time drift between calls)
    // Log warning about potential inconsistency
    this.logger.warn(
      'Exchange does not support atomic getSnapshot() - fetching sequentially may cause time drift',
      {},
      this.context
    );
    const account = await this.exchange.getAccount();
    const positions = await this.exchange.getPositions();

    // Verify consistency after sequential fetch
    const calculatedEquity =
      account.balance + positions.reduce((sum, p) => sum + (p.unrealizedPnl || 0), 0);
    const equityDiff = Math.abs(account.equity - calculatedEquity);
    if (equityDiff > TOLERANCES.EQUITY_DRIFT) {
      this.logger.warn(
        'Snapshot inconsistency after sequential fetch',
        {
          equity: account.equity,
          calculated: calculatedEquity,
          diff: equityDiff,
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

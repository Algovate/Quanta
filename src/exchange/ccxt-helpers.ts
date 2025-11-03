import * as ccxt from 'ccxt';
import { Candlestick, Account, Position } from './types.js';
import { withRetry, createRetryConfig, type RetryConfig } from '../utils/retry.js';
import { UnifiedLogger } from '../logging/index.js';

export interface MarketsState {
  promise: Promise<void> | null;
}

/** Ensure markets are loaded once per exchange instance using a shared state holder */
export async function ensureMarketsLoaded(
  exchange: ccxt.Exchange,
  logger: UnifiedLogger,
  state: MarketsState
): Promise<void> {
  if (!state.promise) {
    state.promise = (async () => {
      try {
        await exchange.loadMarkets();
      } catch (error) {
        state.promise = null;
        logger.error('Failed to load markets', error as Error, 'CCXT');
        throw error;
      }
    })();
  }
  return state.promise;
}

/** Thin retry wrapper with sensible defaults */
export async function retry<T>(
  fn: () => Promise<T>,
  logger: UnifiedLogger,
  label: string,
  cfg?: Partial<RetryConfig>
): Promise<T> {
  return withRetry(
    fn,
    createRetryConfig({
      maxRetries: 3,
      baseDelay: 1000,
      maxDelay: 5000,
      onRetry: (attempt, error) => {
        logger.warn(
          `Retrying ${label}`,
          {
            attempt,
            error: error instanceof Error ? error.message : String(error),
          },
          'CCXT'
        );
      },
      ...cfg,
    })
  );
}

/**
 * Map a CCXT OHLCV tuple to our Candlestick.
 *
 * Note: CCXT returns timestamps in UTC milliseconds since epoch.
 * The adjustForTimeDifference option in exchange configs ensures
 * consistent UTC timezone handling across exchanges.
 */
export function mapOHLCV(candle: number[]): Candlestick {
  return {
    timestamp: candle[0], // UTC milliseconds since epoch
    open: candle[1],
    high: candle[2],
    low: candle[3],
    close: candle[4],
    volume: candle[5],
  };
}

/**
 * Compute a safe mid-like price from a ticker.
 *
 * Note: CCXT ticker.timestamp is in UTC milliseconds since epoch.
 * Falls back to Date.now() (also UTC) if timestamp is missing.
 */
export function safeTickerMid(ticker: ccxt.Ticker): { price: number; ts: number } {
  const bid = (ticker.bid as number) ?? 0;
  const ask = (ticker.ask as number) ?? 0;
  const lastLike = (ticker.last as number) ?? (ticker.close as number) ?? 0;
  const price = bid && ask ? (bid + ask) / 2 : lastLike;
  const ts = ticker.timestamp || Date.now(); // Both are UTC milliseconds
  return { price, ts };
}

/** Map raw positions to standard Position shape (best-effort, derivatives) */
export function mapPositionsStandard(raw: unknown[]): Position[] {
  return (raw as Record<string, unknown>[]).map(pos => {
    const size = (pos.contracts as number) ?? 0;
    const markPrice = (pos.markPrice as number) ?? 0;
    const leverage = (pos.leverage as number) ?? 1;
    // Note: markPrice may be 0 from exchange if position data is incomplete
    // Caller should validate positions before using them in calculations
    return {
      symbol: (pos.symbol as string) ?? '',
      side: (pos.side as 'long' | 'short') ?? 'long',
      size,
      entryPrice: (pos.entryPrice as number) ?? 0,
      markPrice,
      unrealizedPnl: (pos.unrealizedPnl as number) ?? 0,
      marginUsed: (pos.marginUsed as number) ?? 0,
      notional: size * markPrice * leverage,
      leverage,
      timestamp: Date.now(),
    };
  });
}

/** Map CCXT balance to our Account with a preferred quote (USDT/USDC) */
export function mapAccountFromBalance(
  balance: ccxt.Balances,
  prefer: 'USDT' | 'USDC' = 'USDT'
): Account {
  const total = (balance.total as unknown as Record<string, number>) || {};
  const free = (balance.free as unknown as Record<string, number>) || {};
  const used = (balance.used as unknown as Record<string, number>) || {};

  const alt = prefer === 'USDT' ? 'USDC' : 'USDT';
  const pick = (m: Record<string, number>) => m[prefer] ?? m[alt] ?? 0;

  const equity = pick(total);
  return {
    balance: equity,
    equity,
    availableMargin: pick(free),
    usedMargin: pick(used),
    marginRatio: 0,
    timestamp: Date.now(),
  };
}

/** Detect sandbox support for an exchange constructor */
export function supportsSandbox(ExchangeCtor: new (...args: any[]) => ccxt.Exchange): boolean {
  try {
    const temp = new ExchangeCtor();
    return Boolean((temp.urls as unknown as Record<string, unknown>)?.sandbox);
  } catch {
    return false;
  }
}

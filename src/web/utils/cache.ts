/**
 * Cache management utilities for market data
 */

export interface PriceCacheEntry {
  price: number;
  ts: number;
}

export interface KlineCacheEntry {
  candle: {
    timestamp: number;
    open: number;
    high: number;
    low: number;
    close: number;
    volume: number;
  };
  ts: number;
}

/**
 * Validates if a cached price entry is still valid
 */
export function isPriceCacheValid(
  entry: PriceCacheEntry | undefined,
  ttl: number,
  now: number
): boolean {
  if (!entry) return false;
  if (now - entry.ts >= ttl) return false;
  // Validate price value
  return entry.price > 0 && isFinite(entry.price);
}

/**
 * Validates if a cached kline entry is still valid
 */
export function isKlineCacheValid(
  entry: KlineCacheEntry | undefined,
  ttl: number,
  now: number
): boolean {
  if (!entry) return false;
  return now - entry.ts < ttl;
}

/**
 * Creates a new price cache
 */
export function createPriceCache(): Map<string, PriceCacheEntry> {
  return new Map<string, PriceCacheEntry>();
}

/**
 * Creates a new kline cache
 */
export function createKlineCache(): Map<string, KlineCacheEntry> {
  return new Map<string, KlineCacheEntry>();
}

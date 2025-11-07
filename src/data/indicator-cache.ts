import { CacheManager } from '../utils/cache-manager.js';
import { generateIndicatorKey, hashCandlesticks } from '../utils/cache-keys.js';
import type { Candlestick, TechnicalIndicators } from './market.js';

/**
 * Indicator cache entry
 */
interface IndicatorCacheEntry {
  indicators: TechnicalIndicators;
  candlestickHash: string;
  timestamp: number;
}

/**
 * Indicator cache with content-aware invalidation
 * Only recalculates indicators when candlesticks actually change
 */
export class IndicatorCache {
  private cache: CacheManager<IndicatorCacheEntry>;
  private readonly defaultTTL: number;

  constructor(options: { maxSize?: number; defaultTTL?: number } = {}) {
    this.defaultTTL = options.defaultTTL ?? 5 * 60 * 1000; // 5 minutes default
    this.cache = new CacheManager<IndicatorCacheEntry>({
      maxSize: options.maxSize ?? 500,
      defaultTTL: this.defaultTTL,
      strategy: 'hybrid',
      enableStatistics: true,
    });
  }

  /**
   * Get cached indicators if available and valid
   * @param symbol - Trading symbol
   * @param timeframe - Timeframe
   * @param candlesticks - Current candlesticks to check against
   * @returns Cached indicators or null if cache miss/invalid
   */
  get(symbol: string, timeframe: string, candlesticks: Candlestick[]): TechnicalIndicators | null {
    if (candlesticks.length === 0) {
      return null;
    }

    // Generate cache key and hash in one pass
    const hash = hashCandlesticks(candlesticks);
    const key = generateIndicatorKey(symbol, timeframe, candlesticks);

    const entry = this.cache.get(key);

    if (!entry) {
      return null;
    }

    // Verify hash matches (content hasn't changed)
    if (entry.candlestickHash !== hash) {
      // Content changed, invalidate this entry
      this.cache.delete(key);
      return null;
    }

    return entry.indicators;
  }

  /**
   * Cache calculated indicators
   * @param symbol - Trading symbol
   * @param timeframe - Timeframe
   * @param candlesticks - Candlesticks used for calculation
   * @param indicators - Calculated indicators to cache
   * @param ttl - Optional TTL override
   */
  set(
    symbol: string,
    timeframe: string,
    candlesticks: Candlestick[],
    indicators: TechnicalIndicators,
    ttl?: number
  ): void {
    if (candlesticks.length === 0) {
      return;
    }

    const hash = hashCandlesticks(candlesticks);
    const key = generateIndicatorKey(symbol, timeframe, candlesticks);

    const entry: IndicatorCacheEntry = {
      indicators,
      candlestickHash: hash,
      timestamp: Date.now(),
    };

    this.cache.set(key, entry, ttl);
  }

  /**
   * Check if indicators are cached for given candlesticks
   * @param symbol - Trading symbol
   * @param timeframe - Timeframe
   * @param candlesticks - Candlesticks to check
   * @returns True if cached and valid
   */
  has(symbol: string, timeframe: string, candlesticks: Candlestick[]): boolean {
    if (candlesticks.length === 0) {
      return false;
    }

    const key = generateIndicatorKey(symbol, timeframe, candlesticks);
    return this.cache.has(key);
  }

  /**
   * Invalidate cache for a symbol/timeframe
   * @param _symbol - Trading symbol (unused, kept for API compatibility)
   * @param _timeframe - Timeframe (unused, kept for API compatibility)
   */
  invalidate(_symbol: string, _timeframe: string): void {
    // We need to iterate and delete matching keys
    // Since we can't easily pattern match, we'll use a different approach
    // For now, we'll clear all entries (this is acceptable for indicator cache)
    // In a production system, you might want to maintain a reverse index
    this.clear();
  }

  /**
   * Clear all cached indicators
   */
  clear(): void {
    this.cache.clear();
  }

  /**
   * Get cache statistics
   */
  getStatistics() {
    return this.cache.getStatistics();
  }

  /**
   * Clean up expired entries
   */
  cleanup(): number {
    return this.cache.cleanup();
  }

  /**
   * Get current cache size
   */
  size(): number {
    return this.cache.size();
  }
}

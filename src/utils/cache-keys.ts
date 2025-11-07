import { createHash } from 'crypto';
import type { Candlestick } from '../data/market.js';

/**
 * Cache key utilities with content-based hashing
 * Detects when candlesticks actually change to avoid redundant calculations
 */

/**
 * Generate a content hash for candlesticks
 * Uses the last N candles (most recent data) to detect changes
 * @param candlesticks - Array of candlesticks
 * @param sampleSize - Number of recent candles to include in hash (default: 10)
 * @returns Hash string representing the content
 */
export function hashCandlesticks(candlesticks: Candlestick[], sampleSize: number = 10): string {
  if (candlesticks.length === 0) {
    return 'empty';
  }

  // Use the most recent candles for hashing (they change most frequently)
  const recent = candlesticks.slice(-sampleSize);

  // Create a compact representation: last candle's close + timestamp + count
  // This is fast and sufficient for detecting changes
  const last = recent[recent.length - 1];
  const first = recent[0];

  // Include key fields that indicate data changes
  const data = `${last.timestamp}:${last.close}:${first.timestamp}:${candlesticks.length}`;

  return createHash('sha256').update(data).digest('hex').substring(0, 16); // Use first 16 chars for shorter keys
}

/**
 * Generate a hierarchical cache key for market data
 * Format: symbol:timeframe:hash
 * @param symbol - Trading symbol (e.g., "BTC/USDT")
 * @param timeframe - Timeframe (e.g., "3m", "4h")
 * @param candlesticks - Candlesticks to hash
 * @returns Cache key string
 */
export function generateMarketDataKey(
  symbol: string,
  timeframe: string,
  candlesticks: Candlestick[]
): string {
  const hash = hashCandlesticks(candlesticks);
  // Normalize symbol (remove special chars for cache key)
  const normalizedSymbol = symbol.replace(/[^a-zA-Z0-9]/g, '_');
  return `${normalizedSymbol}:${timeframe}:${hash}`;
}

/**
 * Generate a cache key for indicators
 * Uses candlestick hash to detect when recalculation is needed
 * @param symbol - Trading symbol
 * @param timeframe - Timeframe
 * @param candlesticks - Candlesticks to hash
 * @returns Cache key for indicators
 */
export function generateIndicatorKey(
  symbol: string,
  timeframe: string,
  candlesticks: Candlestick[]
): string {
  const hash = hashCandlesticks(candlesticks);
  const normalizedSymbol = symbol.replace(/[^a-zA-Z0-9]/g, '_');
  return `indicators:${normalizedSymbol}:${timeframe}:${hash}`;
}

/**
 * Generate a simple cache key (without content hashing)
 * Useful for TTL-based caching where content changes don't matter
 * @param symbol - Trading symbol
 * @param timeframe - Timeframe
 * @returns Simple cache key
 */
export function generateSimpleKey(symbol: string, timeframe: string): string {
  const normalizedSymbol = symbol.replace(/[^a-zA-Z0-9]/g, '_');
  return `${normalizedSymbol}:${timeframe}`;
}

/**
 * Parse a cache key to extract components
 * @param key - Cache key to parse
 * @returns Parsed components or null if invalid
 */
export function parseCacheKey(
  key: string
): { symbol: string; timeframe: string; hash?: string; type?: string } | null {
  const parts = key.split(':');
  if (parts.length < 2) {
    return null;
  }

  // Handle indicator keys: indicators:symbol:timeframe:hash
  if (parts[0] === 'indicators' && parts.length >= 4) {
    return {
      type: 'indicators',
      symbol: parts[1],
      timeframe: parts[2],
      hash: parts[3],
    };
  }

  // Handle market data keys: symbol:timeframe:hash
  if (parts.length >= 3) {
    return {
      symbol: parts[0],
      timeframe: parts[1],
      hash: parts[2],
    };
  }

  // Handle simple keys: symbol:timeframe
  if (parts.length === 2) {
    return {
      symbol: parts[0],
      timeframe: parts[1],
    };
  }

  return null;
}

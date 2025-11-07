import { Candlestick } from '../types/index.js';

/**
 * Get candlesticks at a specific point in time
 * Returns only data up to and including the specified timestamp
 */
export function getCandlesticksUpTo(candlesticks: Candlestick[], timestamp: number): Candlestick[] {
  return candlesticks.filter(c => c.timestamp <= timestamp);
}

/**
 * Get the current price from the last available candlestick
 */
export function getCurrentPrice(candlesticks: Candlestick[], timestamp: number): number {
  const filtered = getCandlesticksUpTo(candlesticks, timestamp);
  if (filtered.length === 0) {
    throw new Error('No candlesticks available');
  }
  return filtered[filtered.length - 1].close;
}

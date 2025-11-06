/**
 * Cache key generation utilities for historical data
 */
export function generateCacheKey(
  symbol: string,
  timeframe: string,
  startDate: Date,
  endDate: Date
): string {
  // Sanitize symbol for filename (replace / with -)
  const safeSymbol = symbol.replace(/\//g, '-');
  const start = startDate.toISOString().split('T')[0];
  const end = endDate.toISOString().split('T')[0];
  return `${safeSymbol}_${timeframe}_${start}_${end}`;
}

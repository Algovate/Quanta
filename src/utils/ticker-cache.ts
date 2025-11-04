import { UnifiedLogger } from '../logging/index.js';

export interface TickerSnapshotService {
  getTicker(symbol: string): Promise<{ price: number; timestamp: number }>;
}

export interface TickerCacheEntry {
  price: number;
  timestamp: number;
}

export type TickerCache = Map<string, TickerCacheEntry>;

/**
 * Creates a ticker price getter function with caching
 * Returns undefined if price is invalid or unavailable (caller must handle)
 */
export function createTickerPriceGetter(
  tickerCache: TickerCache,
  snapshotService: TickerSnapshotService,
  logger?: UnifiedLogger,
  loggerContext?: string
): (symbol: string) => Promise<number | undefined> {
  return async (symbol: string): Promise<number | undefined> => {
    const cached = tickerCache.get(symbol);
    if (cached) {
      // Validate cached price before returning
      if (cached.price > 0 && isFinite(cached.price)) {
        return cached.price;
      }
      // Invalid cached price - remove it and fetch fresh
      tickerCache.delete(symbol);
    }
    try {
      const ticker = await snapshotService.getTicker(symbol);
      const price = ticker.price;
      // Only cache valid prices
      if (price !== undefined && price !== null && isFinite(price) && price > 0) {
        tickerCache.set(symbol, { price, timestamp: Date.now() });
        return price;
      }
      if (logger && loggerContext) {
        logger.warn(`Invalid price from ticker for ${symbol}: ${price}`, {}, loggerContext);
      }
      return undefined;
    } catch (error) {
      if (logger && loggerContext) {
        logger.debug(
          `Failed to fetch ticker for ${symbol}`,
          error instanceof Error ? { error: error.message } : { error: String(error) },
          loggerContext
        );
      }
      return undefined; // Return undefined instead of 0 - caller must handle
    }
  };
}

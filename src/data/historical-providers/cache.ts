import { promises as fs } from 'fs';
import { join } from 'path';
import { Candlestick } from '../../types/index.js';
import { UnifiedLogger } from '../../logging/index.js';
import type { IHistoricalProvider } from './base.js';
import { generateCacheKey } from './cache-utils.js';

/**
 * Disk cache wrapper for historical data providers
 */
export class CachedHistoricalProvider implements IHistoricalProvider {
  private provider: IHistoricalProvider;
  private cacheDir: string;
  private logger = UnifiedLogger.getInstance();
  private readonly context = 'CachedHistoricalProvider';

  constructor(provider: IHistoricalProvider, cacheDir: string) {
    this.provider = provider;
    this.cacheDir = cacheDir;
  }

  async getHistoricalCandlesticks(
    symbol: string,
    timeframe: string,
    startDate: Date,
    endDate: Date
  ): Promise<Candlestick[]> {
    // Generate cache file path
    const cacheKey = generateCacheKey(symbol, timeframe, startDate, endDate);
    const cachePath = join(this.cacheDir, `${cacheKey}.json`);

    try {
      // Try to read from cache
      const cached = await this.readCache(cachePath);
      if (cached) {
        this.logger.info(
          `💾 Cache hit: ${symbol} ${timeframe} (${cached.length} candles)`,
          { symbol, timeframe, count: cached.length, cachePath },
          this.context
        );
        return cached;
      }
    } catch (error) {
      // Cache read failed, continue to fetch
      this.logger.debug(
        `Cache miss or read error for ${symbol} ${timeframe}`,
        { cachePath, error: error instanceof Error ? error.message : String(error) },
        this.context
      );
    }

    // Fetch from provider
    const candles = await this.provider.getHistoricalCandlesticks(
      symbol,
      timeframe,
      startDate,
      endDate
    );

    // Write to cache
    try {
      await this.writeCache(cachePath, candles);
      this.logger.info(
        `💾 Cached ${candles.length} candles for ${symbol} ${timeframe}`,
        { symbol, timeframe, count: candles.length, cachePath },
        this.context
      );
    } catch (error) {
      // Cache write failed, but we still have the data
      this.logger.warn(
        `Failed to write cache for ${symbol} ${timeframe}`,
        { cachePath, error: error instanceof Error ? error.message : String(error) },
        this.context
      );
    }

    return candles;
  }

  /**
   * Read candles from cache file
   */
  private async readCache(cachePath: string): Promise<Candlestick[] | null> {
    try {
      const data = await fs.readFile(cachePath, 'utf-8');
      const candles = JSON.parse(data) as Candlestick[];

      // Validate format
      if (Array.isArray(candles) && candles.length > 0) {
        // Basic validation
        const first = candles[0];
        if (
          typeof first.timestamp === 'number' &&
          typeof first.open === 'number' &&
          typeof first.high === 'number' &&
          typeof first.low === 'number' &&
          typeof first.close === 'number'
        ) {
          return candles;
        }
      }

      return null;
    } catch {
      return null;
    }
  }

  /**
   * Write candles to cache file
   */
  private async writeCache(cachePath: string, candles: Candlestick[]): Promise<void> {
    // Ensure cache directory exists
    await fs.mkdir(this.cacheDir, { recursive: true });

    // Write JSON file
    await fs.writeFile(cachePath, JSON.stringify(candles, null, 2), 'utf-8');
  }
}

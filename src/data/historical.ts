import { Candlestick } from '../types/index.js';
import type { IHistoricalProvider } from './historical-providers/base.js';
import { SimulatedHistoricalProvider } from './historical-providers/simulated.js';

export class HistoricalDataProvider {
  private cache: Map<string, Candlestick[]> = new Map();
  private provider: IHistoricalProvider;

  constructor(provider?: IHistoricalProvider, rng?: () => number) {
    // Use provided provider or default to simulated
    this.provider = provider || new SimulatedHistoricalProvider(rng);
  }

  /**
   * Fetch historical candlesticks for a symbol within a date range
   * Uses the configured provider (real exchange or simulated)
   */
  async getHistoricalCandlesticks(
    symbol: string,
    timeframe: string,
    startDate: Date,
    endDate: Date
  ): Promise<Candlestick[]> {
    const cacheKey = `${symbol}_${timeframe}_${startDate.getTime()}_${endDate.getTime()}`;

    // Check in-memory cache
    if (this.cache.has(cacheKey)) {
      const cached = this.cache.get(cacheKey);
      if (cached) {
        return cached;
      }
    }

    // Fetch from provider
    const candlesticks = await this.provider.getHistoricalCandlesticks(
      symbol,
      timeframe,
      startDate,
      endDate
    );

    // Cache the data
    this.cache.set(cacheKey, candlesticks);

    return candlesticks;
  }

  /**
   * Get candlesticks at a specific point in time
   * Returns only data up to and including the specified timestamp
   */
  getCandlesticksUpTo(candlesticks: Candlestick[], timestamp: number): Candlestick[] {
    return candlesticks.filter(c => c.timestamp <= timestamp);
  }

  /**
   * Get the current price from the last available candlestick
   */
  getCurrentPrice(candlesticks: Candlestick[], timestamp: number): number {
    const filtered = this.getCandlesticksUpTo(candlesticks, timestamp);
    if (filtered.length === 0) {
      throw new Error('No candlesticks available');
    }
    return filtered[filtered.length - 1].close;
  }

  /**
   * Clear cache to free memory
   */
  clearCache(): void {
    this.cache.clear();
  }
}

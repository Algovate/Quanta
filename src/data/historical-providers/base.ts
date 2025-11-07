import { Candlestick } from '../../types/index.js';

/**
 * Progress information during historical data fetching
 */
export interface FetchProgress {
  pages: number;
  candles: number;
  elapsedSec: number;
}

/**
 * Base interface for historical data providers
 */
export interface IHistoricalProvider {
  /**
   * Fetch historical candlesticks for a symbol within a date range
   * @param symbol - Trading symbol (e.g., "BTC/USDT")
   * @param timeframe - Timeframe (e.g., "3m", "4h", "1d")
   * @param startDate - Start date
   * @param endDate - End date
   * @param onProgress - Optional callback for progress updates during fetch
   * @returns Array of candlesticks
   */
  getHistoricalCandlesticks(
    symbol: string,
    timeframe: string,
    startDate: Date,
    endDate: Date,
    onProgress?: (progress: FetchProgress) => void
  ): Promise<Candlestick[]>;
}

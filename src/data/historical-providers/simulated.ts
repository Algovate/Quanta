import { Candlestick } from '../../types/index.js';
import type { IHistoricalProvider, FetchProgress } from './base.js';

/**
 * Simulated historical data provider (original implementation)
 */
export class SimulatedHistoricalProvider implements IHistoricalProvider {
  private rng: () => number;

  constructor(rng?: () => number) {
    this.rng = rng || Math.random;
  }

  async getHistoricalCandlesticks(
    symbol: string,
    timeframe: string,
    startDate: Date,
    endDate: Date,
    _onProgress?: (progress: FetchProgress) => void
  ): Promise<Candlestick[]> {
    // Simulated provider generates data synchronously, so no progress updates needed
    // But we still accept the parameter for interface compatibility
    return this.generateHistoricalData(symbol, timeframe, startDate, endDate);
  }

  /**
   * Generate historical candlesticks for the given date range
   * Uses realistic price movements with trend
   */
  private generateHistoricalData(
    symbol: string,
    timeframe: string,
    startDate: Date,
    endDate: Date
  ): Candlestick[] {
    const candlesticks: Candlestick[] = [];
    const timeframeMs = this.getTimeframeMs(timeframe);
    const basePrice = this.getBasePrice(symbol);

    let currentPrice = basePrice;
    let timestamp = startDate.getTime();
    const endTimestamp = endDate.getTime();

    // Add some trend and volatility for realism
    const trend = 0.0002; // Slight upward trend
    const volatility = 0.015; // 1.5% volatility

    while (timestamp < endTimestamp) {
      // Add some randomness with seasonal variation
      const cycleEffect =
        Math.sin((timestamp - startDate.getTime()) / (30 * 24 * 60 * 60 * 1000)) * 0.005;

      const change = trend + (this.rng() - 0.5) * volatility + cycleEffect;
      const open = currentPrice;
      const close = open * (1 + change);
      const high = Math.max(open, close) * (1 + this.rng() * 0.01);
      const low = Math.min(open, close) * (1 - this.rng() * 0.01);
      const volume = 1000 + this.rng() * 2000;

      candlesticks.push({
        timestamp,
        open,
        high,
        low,
        close,
        volume,
      });

      currentPrice = close;
      timestamp += timeframeMs;
    }

    return candlesticks;
  }

  private getTimeframeMs(timeframe: string): number {
    const timeframes: { [key: string]: number } = {
      '1m': 60 * 1000,
      '3m': 3 * 60 * 1000,
      '5m': 5 * 60 * 1000,
      '15m': 15 * 60 * 1000,
      '30m': 30 * 60 * 1000,
      '1h': 60 * 60 * 1000,
      '4h': 4 * 60 * 60 * 1000,
      '12h': 12 * 60 * 60 * 1000,
      '1d': 24 * 60 * 60 * 1000,
      '1w': 7 * 24 * 60 * 60 * 1000,
    };
    return timeframes[timeframe] || 60 * 1000;
  }

  private getBasePrice(symbol: string): number {
    const prices: { [key: string]: number } = {
      'BTC/USDT': 45000,
      'ETH/USDT': 3000,
      'SOL/USDT': 100,
      'BNB/USDT': 400,
      'ADA/USDT': 0.5,
      'XRP/USDT': 0.5,
      'DOGE/USDT': 0.1,
      'AVAX/USDT': 25,
    };

    return prices[symbol] || 100;
  }
}

import { Exchange } from '../exchange/types.js';
import { UnifiedLogger } from '../logging/index.js';
import { RequestDeduplicator } from '../utils/request-deduplication.js';
import { CacheManager } from '../utils/cache-manager.js';
import { IndicatorCache } from './indicator-cache.js';
import { generateMarketDataKey, generateSimpleKey } from '../utils/cache-keys.js';

export interface Candlestick {
  timestamp: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

export interface TechnicalIndicators {
  // Moving averages
  sma5?: number;
  sma20?: number;
  sma50?: number;
  ema5?: number;
  ema20: number;
  ema50: number;
  macd: {
    macd: number;
    signal: number;
    histogram: number;
  };
  // Momentum & volatility
  rsi7: number;
  rsi14: number;
  atr3: number;
  atr14: number;
  // Bands
  bollinger?: {
    upper: number;
    middle: number;
    lower: number;
    percentB: number;
    bandwidth: number;
    position: 'above' | 'upper' | 'middle' | 'lower' | 'below';
  };
  // Structure levels
  supportResistance?: {
    support: number | null;
    resistance: number | null;
    distToSupport: number | null;
    distToResistance: number | null;
  };
  // Volume metrics
  volume?: {
    sma20: number;
    ratio: number;
    obv?: number;
  };
}

export interface MarketData {
  coin: string;
  timeframe: string;
  candlesticks: Candlestick[];
  indicators: TechnicalIndicators;
  currentPrice: number;
  trend: 'bullish' | 'bearish' | 'sideways';
  volatility: 'low' | 'medium' | 'high';
  isStale?: boolean; // Indicates data is from cache due to fetch failure
  cacheAge?: number; // Age of cached data in milliseconds
}

interface CachedMarketData {
  data: MarketData;
  timestamp: number;
  candlestickHash?: string; // Content hash for smart invalidation
}

export class MarketDataProvider {
  // Unified cache manager with LRU/LFU/TTL hybrid strategy
  private cache: CacheManager<CachedMarketData>;
  // Separate indicator cache for content-aware invalidation
  private indicatorCache: IndicatorCache;
  private readonly MAX_CACHE_AGE = 5 * 60 * 1000; // 5 minutes - still useful for fallback
  private readonly CACHE_FRESH_THRESHOLD = 1 * 60 * 1000; // 1 minute - consider cache fresh if within this
  private readonly logger = UnifiedLogger.getInstance();
  private readonly context = 'MarketDataProvider';
  // Request deduplication for candlestick fetches to prevent duplicate API calls
  private readonly candlestickDeduplicator = new RequestDeduplicator<Candlestick[]>();
  // Track reported cache misses to prevent spam
  private readonly reportedCacheMisses = new Set<string>();
  // Cleanup interval for expired entries
  private cleanupInterval?: NodeJS.Timeout;

  constructor(
    private exchange: Exchange,
    options: {
      maxCacheSize?: number;
      cacheTTL?: number;
      indicatorCacheSize?: number;
    } = {}
  ) {
    // Initialize unified cache manager
    this.cache = new CacheManager<CachedMarketData>({
      maxSize: options.maxCacheSize ?? 1000,
      defaultTTL: options.cacheTTL ?? this.CACHE_FRESH_THRESHOLD,
      strategy: 'hybrid',
      enableStatistics: true,
    });

    // Initialize indicator cache
    this.indicatorCache = new IndicatorCache({
      maxSize: options.indicatorCacheSize ?? 500,
      defaultTTL: options.cacheTTL ?? this.CACHE_FRESH_THRESHOLD,
    });

    // Setup periodic cleanup
    this.startCleanup();
  }

  /**
   * Start periodic cleanup of expired cache entries
   */
  private startCleanup(): void {
    // Cleanup every 5 minutes
    this.cleanupInterval = setInterval(
      () => {
        const cleaned = this.cache.cleanup();
        const indicatorCleaned = this.indicatorCache.cleanup();
        if (cleaned > 0 || indicatorCleaned > 0) {
          this.logger.debug(
            `Cache cleanup: removed ${cleaned} market data entries, ${indicatorCleaned} indicator entries`,
            {},
            this.context
          );
        }
      },
      5 * 60 * 1000
    );
  }

  /**
   * Stop periodic cleanup
   */
  private stopCleanup(): void {
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
      this.cleanupInterval = undefined;
    }
  }

  async getMarketData(coin: string, timeframes: string[] = ['3m', '4h']): Promise<MarketData[]> {
    // Separate cached and uncached timeframes
    const cachedResults: MarketData[] = [];
    const uncachedTimeframes: string[] = [];

    // First pass: check cache for all timeframes
    for (const timeframe of timeframes) {
      const simpleKey = generateSimpleKey(coin, timeframe);
      const cached = this.getCachedData(simpleKey);
      if (cached) {
        cachedResults.push(cached);
      } else {
        uncachedTimeframes.push(timeframe);
      }
    }

    // If all timeframes are cached, return early
    if (uncachedTimeframes.length === 0) {
      return cachedResults;
    }

    // Parallelize fetching for uncached timeframes
    const fetchPromises = uncachedTimeframes.map(async timeframe => {
      const simpleKey = generateSimpleKey(coin, timeframe);
      return this.fetchMarketDataForTimeframe(coin, timeframe, simpleKey);
    });

    const results = await Promise.allSettled(fetchPromises);

    // Process results and combine with cached data
    const fetchedResults: MarketData[] = [];
    for (let i = 0; i < results.length; i++) {
      const result = results[i];
      const timeframe = uncachedTimeframes[i];
      if (result.status === 'fulfilled' && result.value) {
        fetchedResults.push(result.value);
      } else {
        // Try fallback cache for failed fetch
        const simpleKey = generateSimpleKey(coin, timeframe);
        const fallbackCached = this.getCachedData(simpleKey, true);
        if (fallbackCached) {
          this.logger.warn(
            'Using stale cached data due to fetch failure',
            {
              coin,
              timeframe,
              cacheAge: fallbackCached.cacheAge,
              error:
                result.status === 'rejected'
                  ? result.reason instanceof Error
                    ? result.reason.message
                    : String(result.reason)
                  : 'Unknown error',
            },
            this.context
          );
          fetchedResults.push(fallbackCached);
        } else {
          // Throttle warnings: only log once per coin:timeframe combination
          // Use debug level to reduce noise (expected during data loading)
          const missKey = `${coin}:${timeframe}`;
          if (!this.reportedCacheMisses.has(missKey)) {
            this.logger.debug(
              'No cached data available for failed fetch',
              {
                coin,
                timeframe,
              },
              this.context
            );
            this.reportedCacheMisses.add(missKey);
          }
        }
      }
    }

    // Combine cached and fetched results, maintaining timeframe order
    const allResults = [...cachedResults, ...fetchedResults];
    return allResults.sort((a, b) => {
      const aIndex = timeframes.indexOf(a.timeframe);
      const bIndex = timeframes.indexOf(b.timeframe);
      return aIndex - bIndex;
    });
  }

  /**
   * Fetch market data for a single timeframe with deduplication
   */
  private async fetchMarketDataForTimeframe(
    coin: string,
    timeframe: string,
    simpleKey: string
  ): Promise<MarketData | null> {
    try {
      // Use deduplication to prevent concurrent duplicate requests for same symbol/timeframe
      const candlesticks = await this.candlestickDeduplicator.execute(
        simpleKey,
        () => this.exchange.getCandlesticks(coin, timeframe, 100) as Promise<Candlestick[]>
      );

      if (candlesticks.length < 50) {
        // Try to use cached data if available (even if expired, as fallback)
        const fallbackCached = this.getCachedData(simpleKey, true);
        if (fallbackCached) {
          this.logger.warn(
            'Insufficient fresh candles, using cached data',
            {
              coin,
              timeframe,
              candlesReceived: candlesticks.length,
              cacheAge: fallbackCached.cacheAge,
            },
            this.context
          );
          return fallbackCached;
        }
        // Silent skip during backtesting when no cache available
        return null;
      }

      // Try to get cached indicators first (content-aware)
      let indicators = this.indicatorCache.get(coin, timeframe, candlesticks);

      if (!indicators) {
        // Calculate technical indicators (cache miss)
        indicators = this.calculateIndicators(candlesticks);
        // Cache the calculated indicators
        this.indicatorCache.set(coin, timeframe, candlesticks, indicators);
        this.logger.debug(
          `Calculated indicators for ${coin} ${timeframe}`,
          { candlestickCount: candlesticks.length },
          this.context
        );
      }

      // Determine trend and volatility
      const trend = this.determineTrend(candlesticks, indicators);
      const volatility = this.calculateVolatility(candlesticks);

      // Update simulator's internal market data map if supported
      // This ensures getTicker() uses the same prices as signal generation
      this.syncMarketDataToExchange(coin, timeframe, candlesticks);

      const now = Date.now();
      const data: MarketData = {
        coin,
        timeframe,
        candlesticks,
        indicators,
        currentPrice: candlesticks[candlesticks.length - 1].close,
        trend,
        volatility,
      };

      // Cache with both content-based and simple keys for different lookup patterns
      const cachedEntry: CachedMarketData = {
        data,
        timestamp: now,
      };

      // Content-based key for content-aware caching
      const contentKey = generateMarketDataKey(coin, timeframe, candlesticks);
      this.cache.set(contentKey, cachedEntry, this.CACHE_FRESH_THRESHOLD);

      // Simple key for quick lookups
      this.cache.set(simpleKey, cachedEntry, this.CACHE_FRESH_THRESHOLD);

      return data;
    } catch (error) {
      this.logger.error(
        `Error fetching market data for ${coin} ${timeframe}`,
        error instanceof Error ? error : new Error(String(error)),
        this.context
      );
      // Return null to let caller handle fallback
      return null;
    }
  }

  /**
   * Sync market data to exchange if it supports updateMarketData (e.g., SimulatorExchange)
   * This ensures price consistency between signal generation and order execution
   */
  private syncMarketDataToExchange(
    coin: string,
    timeframe: string,
    candlesticks: Candlestick[]
  ): void {
    const exchange = this.exchange as {
      updateMarketData?: (symbol: string, timeframe: string, candles: Candlestick[]) => void;
    };
    if (exchange.updateMarketData) {
      exchange.updateMarketData(coin, timeframe, candlesticks);
    }
  }

  /**
   * Get cached data if available and not too old
   * @param allowExpired - If true, return expired cache (within MAX_CACHE_AGE) as fallback
   */
  private getCachedData(cacheKey: string, allowExpired: boolean = false): MarketData | null {
    const cached = this.cache.get(cacheKey);
    if (!cached) {
      return null;
    }

    const age = Date.now() - cached.timestamp;

    // Don't use extremely stale data (older than MAX_CACHE_AGE)
    if (age > this.MAX_CACHE_AGE) {
      this.cache.delete(cacheKey);
      return null;
    }

    // If allowExpired is false, only return fresh cache (within FRESH_THRESHOLD)
    // If allowExpired is true, return cache even if expired (for fallback scenarios)
    const isExpired = age > this.CACHE_FRESH_THRESHOLD;
    if (!allowExpired && isExpired) {
      return null;
    }

    // Return cached data with staleness indicators
    return {
      ...cached.data,
      isStale: isExpired,
      cacheAge: age,
    };
  }

  /**
   * Clear the cache (useful for testing or manual refresh)
   */
  clearCache(): void {
    this.cache.clear();
    this.indicatorCache.clear();
    this.logger.info('Market data cache cleared', {}, this.context);
  }

  /**
   * Get cache statistics
   */
  getCacheStats(): {
    marketData: {
      size: number;
      stats: ReturnType<typeof this.cache.getStatistics>;
    };
    indicators: {
      size: number;
      stats: ReturnType<typeof this.indicatorCache.getStatistics>;
    };
  } {
    return {
      marketData: {
        size: this.cache.size(),
        stats: this.cache.getStatistics(),
      },
      indicators: {
        size: this.indicatorCache.size(),
        stats: this.indicatorCache.getStatistics(),
      },
    };
  }

  /**
   * Warm cache for frequently accessed symbols/timeframes
   * Preloads data to improve initial query performance
   * @param symbols - Array of symbols to warm
   * @param timeframes - Array of timeframes to warm
   * @returns Promise that resolves when warming is complete
   */
  async warmCache(symbols: string[], timeframes: string[] = ['3m', '4h']): Promise<void> {
    this.logger.info(
      `Warming cache for ${symbols.length} symbols and ${timeframes.length} timeframes`,
      { symbols, timeframes },
      this.context
    );

    // Warm cache in parallel for all symbol/timeframe combinations
    const warmPromises: Promise<void>[] = [];

    for (const symbol of symbols) {
      for (const timeframe of timeframes) {
        warmPromises.push(
          this.getMarketData(symbol, [timeframe])
            .then(() => {
              this.logger.debug(`Cache warmed for ${symbol} ${timeframe}`, {}, this.context);
            })
            .catch(error => {
              this.logger.warn(
                `Failed to warm cache for ${symbol} ${timeframe}`,
                { error: error instanceof Error ? error.message : String(error) },
                this.context
              );
            })
        );
      }
    }

    await Promise.allSettled(warmPromises);

    const stats = this.getCacheStats();
    this.logger.info(
      `Cache warming complete. Market data: ${stats.marketData.size}, Indicators: ${stats.indicators.size}`,
      {
        marketDataHitRate: stats.marketData.stats?.hitRate.toFixed(2),
        indicatorHitRate: stats.indicators.stats?.hitRate.toFixed(2),
      },
      this.context
    );
  }

  /**
   * Cleanup and stop periodic tasks
   * Should be called when shutting down
   */
  destroy(): void {
    this.stopCleanup();
    this.cache.clear();
    this.indicatorCache.clear();
  }

  private calculateIndicators(candlesticks: Candlestick[]): TechnicalIndicators {
    const closes = candlesticks.map(c => c.close);
    const highs = candlesticks.map(c => c.high);
    const lows = candlesticks.map(c => c.low);
    const volumes = candlesticks.map(c => c.volume);

    const ema20 = this.calculateEMA(closes, 20);
    const ema50 = this.calculateEMA(closes, 50);
    const ema5 = this.calculateEMA(closes, 5);
    const sma5 = this.calculateSMA(closes, 5);
    const sma20 = this.calculateSMA(closes, 20);
    const sma50 = this.calculateSMA(closes, 50);
    const macd = this.calculateMACD(closes);
    const rsi7 = this.calculateRSI(closes, 7);
    const rsi14 = this.calculateRSI(closes, 14);
    const atr3 = this.calculateATR(highs, lows, closes, 3);
    const atr14 = this.calculateATR(highs, lows, closes, 14);
    const bollinger = this.calculateBollinger(closes, 20, 2);
    const supportResistance = this.calculateSupportResistance(candlesticks, 5);
    const volume = this.calculateVolumeStats(closes, volumes, 20);

    return {
      sma5,
      sma20,
      sma50,
      ema5,
      ema20,
      ema50,
      macd,
      rsi7,
      rsi14,
      atr3,
      atr14,
      bollinger: bollinger ?? undefined,
      supportResistance,
      volume,
    };
  }

  private calculateSMA(values: number[], period: number): number | undefined {
    if (values.length < period) return undefined;
    const slice = values.slice(-period);
    const sum = slice.reduce((acc, v) => acc + v, 0);
    return sum / period;
  }

  private calculateStdDev(values: number[], period: number): number | undefined {
    if (values.length < period) return undefined;
    const slice = values.slice(-period);
    const mean = slice.reduce((acc, v) => acc + v, 0) / period;
    const variance = slice.reduce((acc, v) => acc + (v - mean) * (v - mean), 0) / period;
    return Math.sqrt(variance);
  }

  private calculateBollinger(
    closes: number[],
    period: number = 20,
    k: number = 2
  ): {
    upper: number;
    middle: number;
    lower: number;
    percentB: number;
    bandwidth: number;
    position: 'above' | 'upper' | 'middle' | 'lower' | 'below';
  } | null {
    const middle = this.calculateSMA(closes, period);
    const std = this.calculateStdDev(closes, period);
    if (middle === undefined || std === undefined) return null;
    const upper = middle + k * std;
    const lower = middle - k * std;
    const last = closes[closes.length - 1];
    const width = upper - lower;
    const percentB = width !== 0 ? (last - lower) / width : 0.5;
    const bandwidth = middle !== 0 ? width / middle : 0;
    let position: 'above' | 'upper' | 'middle' | 'lower' | 'below' = 'middle';
    if (last > upper) position = 'above';
    else if (last >= middle && last <= upper) position = 'upper';
    else if (last >= lower && last < middle) position = 'lower';
    else if (last < lower) position = 'below';
    return { upper, middle, lower, percentB, bandwidth, position };
  }

  private calculateSupportResistance(
    candles: Candlestick[],
    lookback: number = 5
  ): {
    support: number | null;
    resistance: number | null;
    distToSupport: number | null;
    distToResistance: number | null;
  } {
    if (candles.length < lookback + 2) {
      return { support: null, resistance: null, distToSupport: null, distToResistance: null };
    }
    const recent = candles.slice(-(lookback + 2));
    let support: number | null = null;
    let resistance: number | null = null;
    // Simple pivot-based: local minima/maxima in the window
    for (let i = 1; i < recent.length - 1; i++) {
      const prev = recent[i - 1];
      const curr = recent[i];
      const next = recent[i + 1];
      if (curr.low < prev.low && curr.low < next.low) {
        support = support == null ? curr.low : Math.max(support, curr.low);
      }
      if (curr.high > prev.high && curr.high > next.high) {
        resistance = resistance == null ? curr.high : Math.min(resistance, curr.high);
      }
    }
    const lastClose = recent[recent.length - 1].close;
    const distToSupport = support != null ? (lastClose - support) / lastClose : null;
    const distToResistance = resistance != null ? (resistance - lastClose) / lastClose : null;
    return { support, resistance, distToSupport, distToResistance };
  }

  private calculateVolumeStats(
    closes: number[],
    volumes: number[],
    period: number = 20
  ): { sma20: number; ratio: number; obv?: number } | undefined {
    if (volumes.length < period) return undefined;
    const volSMA = this.calculateSMA(volumes, period);
    if (volSMA === undefined) return undefined;
    const lastVol = volumes[volumes.length - 1];
    const ratio = volSMA !== 0 ? lastVol / volSMA : 1;
    // OBV optional: cumulative based on close change sign
    if (closes.length < 2) return { sma20: volSMA, ratio };
    let obv = 0;
    for (let i = 1; i < closes.length; i++) {
      if (closes[i] > closes[i - 1]) obv += volumes[i];
      else if (closes[i] < closes[i - 1]) obv -= volumes[i];
    }
    return { sma20: volSMA, ratio, obv };
  }

  private calculateEMA(prices: number[], period: number): number {
    if (prices.length < period) return prices[prices.length - 1];

    const multiplier = 2 / (period + 1);
    let ema = prices.slice(0, period).reduce((sum, price) => sum + price, 0) / period;

    for (let i = period; i < prices.length; i++) {
      ema = prices[i] * multiplier + ema * (1 - multiplier);
    }

    return ema;
  }

  private calculateMACD(prices: number[]): { macd: number; signal: number; histogram: number } {
    if (prices.length < 26) {
      return { macd: 0, signal: 0, histogram: 0 };
    }

    // Calculate MACD line (12-period EMA - 26-period EMA)
    const ema12 = this.calculateEMA(prices, 12);
    const ema26 = this.calculateEMA(prices, 26);
    const macd = ema12 - ema26;

    // Calculate signal line (9-period EMA of MACD)
    // For a proper signal line, we need to calculate MACD for each period
    // and then apply EMA to those MACD values
    const macdValues: number[] = [];

    // Calculate MACD for the last 35 periods (26 for EMA26 + 9 for signal)
    const startIdx = Math.max(0, prices.length - 35);
    for (let i = startIdx; i < prices.length; i++) {
      const subset = prices.slice(0, i + 1);
      if (subset.length >= 26) {
        const ema12Temp = this.calculateEMA(subset, 12);
        const ema26Temp = this.calculateEMA(subset, 26);
        macdValues.push(ema12Temp - ema26Temp);
      }
    }

    // Calculate 9-period EMA of MACD values for signal line
    const signal = macdValues.length >= 9 ? this.calculateEMA(macdValues, 9) : macd * 0.9;
    const histogram = macd - signal;

    return { macd, signal, histogram };
  }

  private calculateRSI(prices: number[], period: number): number {
    if (prices.length < period + 1) return 50;

    let gains = 0;
    let losses = 0;

    for (let i = 1; i <= period; i++) {
      const change = prices[i] - prices[i - 1];
      if (change > 0) gains += change;
      else losses -= change;
    }

    const avgGain = gains / period;
    const avgLoss = losses / period;

    if (avgLoss === 0) return 100;

    const rs = avgGain / avgLoss;
    return 100 - 100 / (1 + rs);
  }

  private calculateATR(highs: number[], lows: number[], closes: number[], period: number): number {
    if (highs.length < period + 1) return 0;

    const trueRanges: number[] = [];

    for (let i = 1; i < highs.length; i++) {
      const tr1 = highs[i] - lows[i];
      const tr2 = Math.abs(highs[i] - closes[i - 1]);
      const tr3 = Math.abs(lows[i] - closes[i - 1]);
      trueRanges.push(Math.max(tr1, tr2, tr3));
    }

    return trueRanges.slice(-period).reduce((sum, tr) => sum + tr, 0) / period;
  }

  private determineTrend(
    candlesticks: Candlestick[],
    indicators: TechnicalIndicators
  ): 'bullish' | 'bearish' | 'sideways' {
    const recentCandles = candlesticks.slice(-10);
    const priceChange =
      (recentCandles[recentCandles.length - 1].close - recentCandles[0].close) /
      recentCandles[0].close;

    // Trend determination based on multiple factors
    const emaTrend = indicators.ema20 > indicators.ema50 ? 1 : -1;
    const macdTrend = indicators.macd.macd > indicators.macd.signal ? 1 : -1;
    const priceTrend = priceChange > 0.02 ? 1 : priceChange < -0.02 ? -1 : 0;

    const trendScore = emaTrend + macdTrend + priceTrend;

    if (trendScore >= 2) return 'bullish';
    if (trendScore <= -2) return 'bearish';
    return 'sideways';
  }

  private calculateVolatility(candlesticks: Candlestick[]): 'low' | 'medium' | 'high' {
    if (candlesticks.length < 20) return 'medium';

    const recentCandles = candlesticks.slice(-20);
    const returns = [];

    for (let i = 1; i < recentCandles.length; i++) {
      const return_ =
        (recentCandles[i].close - recentCandles[i - 1].close) / recentCandles[i - 1].close;
      returns.push(Math.abs(return_));
    }

    const avgVolatility = returns.reduce((sum, ret) => sum + ret, 0) / returns.length;

    if (avgVolatility < 0.01) return 'low';
    if (avgVolatility > 0.03) return 'high';
    return 'medium';
  }
}

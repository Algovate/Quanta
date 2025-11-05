/**
 * Market Data Fetcher - Handles parallel and sequential market data fetching
 */

import chalk from 'chalk';
import type { MarketDataProvider, MarketData } from '../data/market.js';
import type { UnifiedLogger } from '../logging/index.js';
import { createTickerPriceGetter } from '../utils/ticker-cache.js';
import type { ExchangeSnapshotService } from './exchange-snapshot.js';
import { formatUTCTimeCompact, formatUTCLogTime } from '../utils/time.js';

export interface MarketDataFetchResult {
  marketData: MarketData[];
  successCount: number;
  failCount: number;
}

export interface MarketDataFetchOptions {
  coins: string[];
  timeframes: string[];
  tickerCache: Map<string, { price: number; timestamp: number }>;
  snapshotService: ExchangeSnapshotService;
  unifiedLogger: UnifiedLogger;
  loggerContext: string;
  parallel?: boolean;
}

/**
 * Format market data logs for display
 */
function formatMarketDataLogs(
  coin: string,
  marketData: MarketData[],
  coinMs: number,
  tickerPrice?: number,
  tickerTimestamp?: number,
  tickerError?: unknown
): string[] {
  const logs: string[] = [];
  const tfList = marketData.map(d => d.timeframe).join(', ');
  const base = marketData[0];
  const tf3m = marketData.find(d => d.timeframe === '3m');
  const tf4h = marketData.find(d => d.timeframe === '4h');
  const last3m = tf3m?.candlesticks?.at(-1);
  const last4h = tf4h?.candlesticks?.at(-1);
  const ema20 = base?.indicators?.ema20;
  const ema50 = base?.indicators?.ema50;
  const rsi14 = base?.indicators?.rsi14;
  const macdVal = base?.indicators?.macd?.macd;
  const macdSig = base?.indicators?.macd?.signal;

  logs.push(
    chalk.gray(`   • ${coin}: fetched ${marketData.length} frames (${tfList}) in ${coinMs}ms`)
  );

  if (last3m) {
    logs.push(
      chalk.gray(
        `       [3m] close=$${last3m.close.toFixed(2)} @ ${formatUTCTimeCompact(last3m.timestamp)}`
      )
    );
  }
  if (last4h) {
    logs.push(
      chalk.gray(
        `       [4h] close=$${last4h.close.toFixed(2)} @ ${formatUTCLogTime(last4h.timestamp)}`
      )
    );
  }
  if (base?.indicators) {
    logs.push(
      chalk.gray(
        `       ind: EMA20=${ema20?.toFixed?.(2)} EMA50=${ema50?.toFixed?.(2)} RSI14=${rsi14?.toFixed?.(2)} MACD=${macdVal?.toFixed?.(4)}/${macdSig?.toFixed?.(4)}`
      )
    );
  }

  if (tickerError) {
    logs.push(
      chalk.gray(
        `       ticker: unavailable (${(tickerError as Error)?.message || String(tickerError)})`
      )
    );
  } else if (tickerPrice !== undefined) {
    logs.push(
      chalk.gray(
        `       ticker: $${tickerPrice.toFixed(2)} @ ${formatUTCTimeCompact(tickerTimestamp ?? Date.now())}`
      )
    );
  }

  return logs;
}

/**
 * MarketDataFetcher - Handles fetching market data for multiple coins
 */
export class MarketDataFetcher {
  constructor(
    private marketDataProvider: MarketDataProvider,
    private emitLog: (level: 'info' | 'warn' | 'error' | 'success', message: string) => void
  ) {}

  /**
   * Fetch market data for all coins
   */
  async fetchMarketData(options: MarketDataFetchOptions): Promise<MarketDataFetchResult> {
    const getTickerPrice = createTickerPriceGetter(
      options.tickerCache,
      options.snapshotService,
      options.unifiedLogger,
      options.loggerContext
    );

    if (options.parallel !== false) {
      return this.fetchMarketDataParallel(
        options.coins,
        options.timeframes,
        options.tickerCache,
        getTickerPrice
      );
    } else {
      return this.fetchMarketDataSequential(
        options.coins,
        options.timeframes,
        options.tickerCache,
        getTickerPrice
      );
    }
  }

  /**
   * Fetch market data for all coins in parallel
   */
  private async fetchMarketDataParallel(
    coins: string[],
    timeframes: string[],
    tickerCache: Map<string, { price: number; timestamp: number }>,
    getTickerPrice: (symbol: string) => Promise<number>
  ): Promise<MarketDataFetchResult> {
    type CoinResult = {
      coin: string;
      ok: boolean;
      marketData?: MarketData[];
      logs: string[];
    };

    const tasks = coins.map(async coin => {
      const symbol = `${coin}/USDT`;
      const logs: string[] = [];
      try {
        const coinStart = Date.now();
        const marketData = await this.marketDataProvider.getMarketData(symbol, timeframes);
        const coinMs = Date.now() - coinStart;

        let tickerPrice: number | undefined;
        let tickerTimestamp: number | undefined;
        let tickerError: Error | unknown;
        try {
          const price = await getTickerPrice(symbol);
          tickerPrice = price;
          const cached = tickerCache.get(symbol);
          tickerTimestamp = cached?.timestamp;
        } catch (err) {
          tickerError = err;
        }

        const coinLogs = formatMarketDataLogs(
          coin,
          marketData,
          coinMs,
          tickerPrice,
          tickerTimestamp,
          tickerError
        );
        logs.push(...coinLogs);

        return { coin, ok: true, marketData, logs } as CoinResult;
      } catch (e) {
        logs.push(`   • ${coin}: failed to fetch market data (${(e as Error).message || e})`);
        return { coin, ok: false, logs } as CoinResult;
      }
    });

    const settled = await Promise.allSettled(tasks);
    const results: CoinResult[] = settled.map(s =>
      s.status === 'fulfilled' ? s.value : { coin: 'unknown', ok: false, logs: [String(s.reason)] }
    );

    const allMarketData: MarketData[] = [];
    let successCount = 0;
    let failCount = 0;

    // Emit logs per coin in configured order for stable output
    for (const coin of coins) {
      const r = results.find(x => x.coin === coin);
      if (!r) continue;
      if (r.ok && r.marketData) {
        successCount++;
        allMarketData.push(...r.marketData);
      } else {
        failCount++;
      }
      for (const line of r.logs) this.emitLog('info', line);
    }

    return { marketData: allMarketData, successCount, failCount };
  }

  /**
   * Fetch market data for all coins sequentially
   */
  private async fetchMarketDataSequential(
    coins: string[],
    timeframes: string[],
    tickerCache: Map<string, { price: number; timestamp: number }>,
    getTickerPrice: (symbol: string) => Promise<number>
  ): Promise<MarketDataFetchResult> {
    const allMarketData: MarketData[] = [];
    let successCount = 0;
    let failCount = 0;

    for (const coin of coins) {
      const symbol = `${coin}/USDT`;
      try {
        const coinStart = Date.now();
        const marketData = await this.marketDataProvider.getMarketData(symbol, timeframes);
        const coinMs = Date.now() - coinStart;
        allMarketData.push(...marketData);
        successCount++;

        let tickerPrice: number | undefined;
        let tickerTimestamp: number | undefined;
        let tickerError: Error | unknown;
        try {
          const price = await getTickerPrice(symbol);
          tickerPrice = price;
          const cached = tickerCache.get(symbol);
          tickerTimestamp = cached?.timestamp;
        } catch (err) {
          tickerError = err;
        }

        const logs = formatMarketDataLogs(
          coin,
          marketData,
          coinMs,
          tickerPrice,
          tickerTimestamp,
          tickerError
        );
        for (const line of logs) this.emitLog('info', line);
      } catch (e) {
        failCount++;
        this.emitLog(
          'warn',
          `   • ${coin}: failed to fetch market data (${(e as Error).message || e})`
        );
      }
    }

    return { marketData: allMarketData, successCount, failCount };
  }
}

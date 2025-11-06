import * as ccxt from 'ccxt';
import { Candlestick } from '../../types/index.js';
import { mapOHLCV } from '../../exchange/ccxt-helpers.js';
import { UnifiedLogger } from '../../logging/index.js';
import { normalizeTimeframe } from '../timeframes.js';
import { paginateOHLCV } from './pagination.js';
import type { IHistoricalProvider } from './base.js';

export interface BinanceProviderConfig {
  apiKey?: string;
  apiSecret?: string;
  testnet?: boolean;
}

/**
 * Binance historical data provider using CCXT
 */
export class BinanceHistoricalProvider implements IHistoricalProvider {
  private exchange: ccxt.binance;
  private logger = UnifiedLogger.getInstance();
  private readonly context = 'BinanceHistoricalProvider';

  constructor(config?: BinanceProviderConfig) {
    const exchangeOptions: Record<string, unknown> = {
      apiKey: config?.apiKey,
      secret: config?.apiSecret,
      enableRateLimit: true,
      options: {
        defaultType: 'future', // Binance futures
      },
    };

    if (config?.testnet) {
      (exchangeOptions.options as Record<string, unknown>).test = true;
    }

    this.exchange = new ccxt.binance(exchangeOptions);
  }

  async getHistoricalCandlesticks(
    symbol: string,
    timeframe: string,
    startDate: Date,
    endDate: Date
  ): Promise<Candlestick[]> {
    try {
      // Binance uses standard symbol format (BTC/USDT)
      const binanceSymbol = symbol;

      const startTimestamp = startDate.getTime();
      const endTimestamp = endDate.getTime();

      const tfNorm = normalizeTimeframe(timeframe);
      const candles = await paginateOHLCV(
        {
          startMs: startTimestamp,
          endMs: endTimestamp,
          limitPerPage: 1000,
          map: (raw: number[]) => mapOHLCV(raw),
          fetch: async (since: number, limit: number) =>
            this.exchange.fetchOHLCV(binanceSymbol, tfNorm as string, since, limit),
          log: (msg, extra) => this.logger.warn(msg, extra ?? {}, this.context),
        },
        tfNorm as string
      );

      this.logger.info(
        `Fetched ${candles.length} historical candles from Binance`,
        {
          symbol,
          timeframe,
          startDate: startDate.toISOString(),
          endDate: endDate.toISOString(),
        },
        this.context
      );

      return candles;
    } catch (error) {
      this.logger.error(
        `Failed to fetch historical data from Binance for ${symbol}`,
        error instanceof Error ? error : new Error(String(error)),
        this.context
      );
      throw error;
    }
  }
}

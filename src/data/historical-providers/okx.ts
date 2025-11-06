import * as ccxt from 'ccxt';
import { Candlestick } from '../../types/index.js';
import { mapOHLCV } from '../../exchange/ccxt-helpers.js';
import { UnifiedLogger } from '../../logging/index.js';
import { normalizeTimeframe } from '../timeframes.js';
import { paginateOHLCV } from './pagination.js';
import type { IHistoricalProvider } from './base.js';

export interface OKXProviderConfig {
  apiKey?: string;
  apiSecret?: string;
  passphrase?: string;
  testnet?: boolean;
}

/**
 * OKX historical data provider using CCXT
 */
export class OKXHistoricalProvider implements IHistoricalProvider {
  private exchange: ccxt.okx;
  private logger = UnifiedLogger.getInstance();
  private readonly context = 'OKXHistoricalProvider';

  constructor(config?: OKXProviderConfig) {
    const exchangeOptions: Record<string, unknown> = {
      apiKey: config?.apiKey,
      secret: config?.apiSecret,
      password: config?.passphrase,
      enableRateLimit: true,
      options: {
        defaultType: 'swap', // OKX perpetual futures
        test: config?.testnet ?? false,
      },
    };

    this.exchange = new ccxt.okx(exchangeOptions);
  }

  async getHistoricalCandlesticks(
    symbol: string,
    timeframe: string,
    startDate: Date,
    endDate: Date
  ): Promise<Candlestick[]> {
    try {
      // Convert symbol to OKX format (e.g., BTC/USDT -> BTC/USDT:USDT for perpetuals)
      const okxSymbol = this.toOKXSymbol(symbol);
      const startTimestamp = startDate.getTime();
      const endTimestamp = endDate.getTime();

      // Normalize timeframe using shared utility
      const tfNorm = normalizeTimeframe(timeframe);
      const candles = await paginateOHLCV(
        {
          startMs: startTimestamp,
          endMs: endTimestamp,
          limitPerPage: 300,
          map: (raw: number[]) => mapOHLCV(raw),
          fetch: async (since: number, limit: number) =>
            this.exchange.fetchOHLCV(okxSymbol, tfNorm as string, since, limit),
          log: (msg, extra) => this.logger.warn(msg, extra ?? {}, this.context),
        },
        tfNorm as string
      );

      this.logger.info(
        `Fetched ${candles.length} historical candles from OKX`,
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
        `Failed to fetch historical data from OKX for ${symbol}`,
        error instanceof Error ? error : new Error(String(error)),
        this.context
      );
      throw error;
    }
  }

  /**
   * Convert symbol to OKX CCXT format (BTC/USDT -> BTC/USDT:USDT for perpetuals)
   */
  private toOKXSymbol(symbol: string): string {
    // CCXT OKX format for perpetual futures is BTC/USDT:USDT
    if (symbol.includes('/USDT')) {
      return `${symbol}:USDT`;
    }
    // If just base coin (e.g., "BTC"), add /USDT:USDT
    return `${symbol}/USDT:USDT`;
  }
}

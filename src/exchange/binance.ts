import * as ccxt from 'ccxt';
import { Exchange, Account, Position, Candlestick, Order } from './types.js';
import { Logger } from '../utils/logger.js';
import { withRetry, createRetryConfig } from '../utils/retry.js';
import {
  supportsSandbox,
  ensureMarketsLoaded,
  mapOHLCV,
  mapAccountFromBalance,
  mapPositionsStandard,
  type MarketsState,
} from './ccxt-helpers.js';

export class BinanceExchange implements Exchange {
  private exchange: ccxt.binance;
  private isTestnet: boolean;
  private logger = Logger.getInstance('BinanceExchange');
  private marketsState: MarketsState = { promise: null };

  constructor(apiKey?: string, apiSecret?: string, testnet: boolean = true) {
    this.isTestnet = testnet;

    // Configure Binance exchange options
    const exchangeOptions: Record<string, unknown> = {
      apiKey,
      secret: apiSecret,
      options: {
        defaultType: 'future', // Binance uses futures
        adjustForTimeDifference: true,
      },
      enableRateLimit: true,
    };

    // Only set sandbox if the exchange supports it
    try {
      if (supportsSandbox(ccxt.binance as unknown as new () => ccxt.Exchange)) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (exchangeOptions as any).sandbox = testnet;
      }
    } catch {
      // If we can't determine sandbox support, don't set it
    }

    this.exchange = new ccxt.binance(exchangeOptions);
  }

  async getAccount(): Promise<Account> {
    if (!this.exchange.apiKey || this.exchange.apiKey === 'test') {
      throw new Error('Account information requires API credentials for Binance');
    }

    return withRetry(
      async () => {
        const balance = await this.exchange.fetchBalance();
        return mapAccountFromBalance(balance, 'USDT');
      },
      createRetryConfig({
        maxRetries: 3,
        baseDelay: 1000,
        maxDelay: 5000,
        onRetry: (attempt, error) => {
          this.logger.warn('Retrying Binance getAccount', {
            attempt,
            error: error instanceof Error ? error.message : String(error),
          });
        },
      })
    );
  }

  async getPositions(): Promise<Position[]> {
    if (!this.exchange.apiKey || this.exchange.apiKey === 'test') {
      return [];
    }

    return withRetry(
      async () => {
        await ensureMarketsLoaded(this.exchange, this.logger, this.marketsState);
        const positions = await this.exchange.fetchPositions();
        return mapPositionsStandard(positions as unknown[]);
      },
      createRetryConfig({
        maxRetries: 3,
        baseDelay: 1000,
        maxDelay: 5000,
        onRetry: (attempt, error) => {
          this.logger.warn('Retrying Binance getPositions', {
            attempt,
            error: error instanceof Error ? error.message : String(error),
          });
        },
      })
    ).catch(error => {
      this.logger.error('Error fetching positions from Binance after retries', error as Error);
      return [];
    });
  }

  async getCandlesticks(symbol: string, timeframe: string, limit: number): Promise<Candlestick[]> {
    return withRetry(
      async () => {
        await ensureMarketsLoaded(this.exchange, this.logger, this.marketsState);
        const ohlcv = await this.exchange.fetchOHLCV(symbol, timeframe, undefined, limit);
        return ohlcv.map(mapOHLCV);
      },
      createRetryConfig({
        maxRetries: 3,
        baseDelay: 1000,
        maxDelay: 5000,
        onRetry: (attempt, error) => {
          this.logger.warn('Retrying Binance getCandlesticks', {
            attempt,
            symbol,
            timeframe,
            error: error instanceof Error ? error.message : String(error),
          });
        },
      })
    );
  }

  async getSnapshot(): Promise<{ account: Account; positions: Position[] }> {
    const [account, positions] = await Promise.all([this.getAccount(), this.getPositions()]);
    return { account, positions };
  }

  async placeOrder(
    symbol: string,
    side: 'buy' | 'sell',
    amount: number,
    price?: number
  ): Promise<Order> {
    try {
      if (!this.exchange.apiKey || this.exchange.apiKey === 'test') {
        throw new Error('Trading operations require API credentials for Binance');
      }

      const order = await this.exchange.createOrder(
        symbol,
        'market',
        side as 'buy' | 'sell',
        amount,
        price
      );

      return {
        id: order.id,
        symbol: order.symbol,
        side: order.side as 'buy' | 'sell',
        amount: order.amount,
        price: order.price || 0,
        status: order.status,
        timestamp: Date.now(),
      };
    } catch (error) {
      console.error('Error placing order on Binance:', error);
      throw error;
    }
  }

  async cancelOrder(orderId: string, symbol: string): Promise<boolean> {
    try {
      if (!this.exchange.apiKey || this.exchange.apiKey === 'test') {
        throw new Error('Trading operations require API credentials for Binance');
      }

      await this.exchange.cancelOrder(orderId, symbol);
      return true;
    } catch (error) {
      console.error('Error canceling order on Binance:', error);
      return false;
    }
  }

  async getTicker(symbol: string): Promise<{ price: number; timestamp: number }> {
    return withRetry(
      async () => {
        const ticker = await this.exchange.fetchTicker(symbol);
        return {
          price: ticker.last || ticker.close || 0,
          timestamp: ticker.timestamp || Date.now(),
        };
      },
      createRetryConfig({
        maxRetries: 3,
        baseDelay: 500,
        maxDelay: 2000,
        onRetry: (attempt, error) => {
          this.logger.warn('Retrying Binance getTicker', {
            attempt,
            symbol,
            error: error instanceof Error ? error.message : String(error),
          });
        },
      })
    );
  }

  getExchangeName(): string {
    return 'binance';
  }

  isTestnetMode(): boolean {
    return this.isTestnet;
  }
}

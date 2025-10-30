import * as ccxt from 'ccxt';
import { Exchange, Account, Position, Candlestick, Order } from './types.js';
import { Logger } from '../utils/logger.js';

export class OKXExchange implements Exchange {
  private exchange: ccxt.okx;
  private isTestnet: boolean;
  private marketsLoaded: Promise<void> | null = null;
  private logger = Logger.getInstance('OKXExchange');

  constructor(
    apiKey?: string,
    apiSecret?: string,
    testnet: boolean = true,
    okxCtor?: new (options: Record<string, unknown>) => ccxt.okx
  ) {
    this.isTestnet = testnet;

    // Configure OKX exchange options
    const exchangeOptions: Record<string, unknown> = {
      apiKey,
      secret: apiSecret,
      password: process.env.OKX_PASSPHRASE, // OKX requires passphrase
      options: {
        defaultType: 'swap',
        adjustForTimeDifference: true,
      },
      enableRateLimit: true,
      timeout: 30000, // 30 second timeout
    };

    const OkxImpl = okxCtor ?? ccxt.okx;
    this.exchange = new OkxImpl(exchangeOptions);
    // Ensure sandbox/testnet mode is configured via ccxt API (more reliable than vendor options)
    try {
      // Some exchanges require explicit sandbox mode toggle
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (this.exchange as any).setSandboxMode?.(testnet);
    } catch (_e) {
      void _e;
      // Non-fatal: not all versions expose setSandboxMode
    }
  }

  private async ensureMarketsLoaded(): Promise<void> {
    if (!this.marketsLoaded) {
      this.marketsLoaded = (async () => {
        try {
          await this.exchange.loadMarkets();
        } catch (error) {
          // Reset so future calls can retry
          this.marketsLoaded = null;
          this.logger.error('Failed to load markets', error as Error);
          throw error;
        }
      })();
    }
    return this.marketsLoaded;
  }

  async getAccount(): Promise<Account> {
    if (!this.exchange.apiKey || this.exchange.apiKey === 'test') {
      throw new Error('Account information requires API credentials for OKX');
    }

    try {
      const balance = await this.exchange.fetchBalance();
      return {
        balance: (balance.total as unknown as Record<string, number>)?.USDT || 0,
        equity: (balance.total as unknown as Record<string, number>)?.USDT || 0,
        availableMargin: (balance.free as unknown as Record<string, number>)?.USDT || 0,
        usedMargin: (balance.used as unknown as Record<string, number>)?.USDT || 0,
        marginRatio: 0,
        timestamp: Date.now(),
      };
    } catch (error) {
      this.logger.error('Error fetching account from OKX', error as Error);
      throw error;
    }
  }

  async getPositions(): Promise<Position[]> {
    try {
      if (!this.exchange.apiKey || this.exchange.apiKey === 'test') {
        return [];
      }

      await this.ensureMarketsLoaded();
      const positions = await this.exchange.fetchPositions();
      return (positions as unknown[]).map((pos: Record<string, unknown>) => {
        const size = pos.contracts as number;
        const markPrice = (pos.markPrice as number) || 0;
        const leverage = (pos.leverage as number) || 1;
        return {
          symbol: pos.symbol as string,
          side: pos.side as 'long' | 'short',
          size,
          entryPrice: (pos.entryPrice as number) || 0,
          markPrice,
          unrealizedPnl: (pos.unrealizedPnl as number) || 0,
          marginUsed: (pos.marginUsed as number) || 0,
          notional: size * markPrice * leverage,
          leverage,
          timestamp: Date.now(),
        };
      });
    } catch (error) {
      this.logger.error('Error fetching positions from OKX', error as Error);
      return [];
    }
  }

  async getCandlesticks(symbol: string, timeframe: string, limit: number): Promise<Candlestick[]> {
    try {
      await this.ensureMarketsLoaded();
      const ohlcv = await this.exchange.fetchOHLCV(symbol, timeframe, undefined, limit);
      return ohlcv.map((candle: number[]) => ({
        timestamp: candle[0],
        open: candle[1],
        high: candle[2],
        low: candle[3],
        close: candle[4],
        volume: candle[5],
      }));
    } catch (error) {
      console.error('Error fetching candlesticks from OKX:', error);
      throw error;
    }
  }

  async placeOrder(
    symbol: string,
    side: 'buy' | 'sell',
    amount: number,
    price?: number
  ): Promise<Order> {
    try {
      if (!this.exchange.apiKey || this.exchange.apiKey === 'test') {
        throw new Error('Trading operations require API credentials for OKX');
      }

      await this.ensureMarketsLoaded();
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
      this.logger.error('Error placing order on OKX', error as Error);
      throw error;
    }
  }

  async cancelOrder(orderId: string, symbol: string): Promise<boolean> {
    try {
      if (!this.exchange.apiKey || this.exchange.apiKey === 'test') {
        throw new Error('Trading operations require API credentials for OKX');
      }
      await this.ensureMarketsLoaded();
      await this.exchange.cancelOrder(orderId, symbol);
      return true;
    } catch (error) {
      this.logger.error('Error canceling order on OKX', error as Error);
      return false;
    }
  }

  async getTicker(symbol: string): Promise<{ price: number; timestamp: number }> {
    try {
      await this.ensureMarketsLoaded();
      const ticker = await this.exchange.fetchTicker(symbol);
      return {
        price: ticker.last || ticker.close || 0,
        timestamp: ticker.timestamp || Date.now(),
      };
    } catch (error) {
      this.logger.error('Error fetching ticker from OKX', error as Error);
      throw error;
    }
  }

  getExchangeName(): string {
    return 'okx';
  }

  isTestnetMode(): boolean {
    return this.isTestnet;
  }
}

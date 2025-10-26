import * as ccxt from 'ccxt';
import { Exchange, Account, Position, Candlestick, Order } from './types';

// Generic exchange wrapper that can work with any CCXT-supported exchange
export class GenericExchange implements Exchange {
  private exchange: ccxt.Exchange;
  private exchangeName: string;
  private isTestnet: boolean;

  constructor(exchangeName: string, apiKey?: string, apiSecret?: string, testnet: boolean = true) {
    this.exchangeName = exchangeName;
    this.isTestnet = testnet;

    // Create exchange instance dynamically
    const ExchangeClass = ccxt[exchangeName as keyof typeof ccxt] as typeof ccxt.Exchange;
    if (!ExchangeClass) {
      throw new Error(`Exchange ${exchangeName} is not supported by CCXT`);
    }

    // Configure exchange options based on exchange type
    const exchangeOptions: Record<string, unknown> = {
      options: {
        defaultType: exchangeName.toLowerCase() === 'binance' ? 'future' : 'spot', // Binance uses futures, others use spot
        adjustForTimeDifference: true,
      },
      enableRateLimit: true,
    };

    // Coinbase-specific configuration
    if (exchangeName.toLowerCase() === 'coinbase') {
      // Enable automatic granularity conversion for Coinbase
      (exchangeOptions.options as Record<string, unknown>).fetchOHLCVMethod =
        'publicGetProductsProductCandles';
    }

    // Only set sandbox if the exchange supports it
    try {
      const tempExchange = new ExchangeClass();
      if (tempExchange.urls && (tempExchange.urls as Record<string, unknown>).sandbox) {
        exchangeOptions.sandbox = testnet;
      }
    } catch {
      // If we can't determine sandbox support, don't set it
    }

    // Only add API credentials if provided
    if (apiKey && apiSecret) {
      exchangeOptions.apiKey = apiKey;
      exchangeOptions.secret = apiSecret;

      // For OKX, we need to handle passphrase
      if (exchangeName.toLowerCase() === 'okx' && process.env.OKX_PASSPHRASE) {
        exchangeOptions.password = process.env.OKX_PASSPHRASE;
      }
    }

    this.exchange = new ExchangeClass(exchangeOptions);
  }

  /**
   * Maps timeframe for exchanges that need special handling
   * CCXT handles most conversions automatically, but some exchanges may need custom mapping
   */
  private mapTimeframe(timeframe: string): string {
    const exchangeName = this.exchangeName.toLowerCase();

    // For Coinbase, we need to use a timeframe that maps to valid granularity
    // CCXT supports '1m', '5m', '15m', '1h', '6h', '1d' for Coinbase
    if (exchangeName === 'coinbase') {
      const coinbaseTimeframes: { [key: string]: string } = {
        '1m': '1m', // 60 seconds
        '3m': '5m', // Map 3m to 5m (nearest supported)
        '5m': '5m', // 300 seconds
        '15m': '15m', // 900 seconds
        '1h': '1h', // 3600 seconds
        '4h': '6h', // Map 4h to 6h (nearest supported)
        '6h': '6h', // 21600 seconds
        '1d': '1d', // 86400 seconds
      };

      return coinbaseTimeframes[timeframe] || timeframe;
    }

    // For other exchanges, use the timeframe as-is
    return timeframe;
  }

  async getAccount(): Promise<Account> {
    try {
      // If no API credentials, return a mock account for public data access
      if (!this.exchange.apiKey || this.exchange.apiKey === 'test') {
        return {
          balance: 10000,
          equity: 10000,
          availableMargin: 10000,
          usedMargin: 0,
          marginRatio: 0,
          timestamp: Date.now(),
        };
      }

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
      console.error(`Error fetching account from ${this.exchangeName}:`, error);
      // Return mock account if API call fails
      return {
        balance: 10000,
        equity: 10000,
        availableMargin: 10000,
        usedMargin: 0,
        marginRatio: 0,
        timestamp: Date.now(),
      };
    }
  }

  async getPositions(): Promise<Position[]> {
    try {
      // If no API credentials, return empty positions for public data access
      if (!this.exchange.apiKey || this.exchange.apiKey === 'test') {
        return [];
      }

      const positions = await this.exchange.fetchPositions();

      return (positions as unknown[]).map((pos: Record<string, unknown>) => ({
        symbol: pos.symbol as string,
        side: pos.side as 'long' | 'short',
        size: pos.contracts as number,
        entryPrice: (pos.entryPrice as number) || 0,
        markPrice: (pos.markPrice as number) || 0,
        unrealizedPnl: (pos.unrealizedPnl as number) || 0,
        marginUsed: (pos.marginUsed as number) || 0,
        leverage: (pos.leverage as number) || 1,
        timestamp: Date.now(),
      }));
    } catch (error) {
      console.error(`Error fetching positions from ${this.exchangeName}:`, error);
      return [];
    }
  }

  async getCandlesticks(symbol: string, timeframe: string, limit: number): Promise<Candlestick[]> {
    try {
      // Map timeframe to exchange-specific format
      const mappedTimeframe = this.mapTimeframe(timeframe);
      const ohlcv = await this.exchange.fetchOHLCV(symbol, mappedTimeframe, undefined, limit);

      return ohlcv.map((candle: number[]) => ({
        timestamp: candle[0],
        open: candle[1],
        high: candle[2],
        low: candle[3],
        close: candle[4],
        volume: candle[5],
      }));
    } catch (error) {
      console.error(`Error fetching candlesticks from ${this.exchangeName}:`, error);
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
      // If no API credentials, throw error for trading operations
      if (!this.exchange.apiKey || this.exchange.apiKey === 'test') {
        throw new Error(`Trading operations require API credentials for ${this.exchangeName}`);
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
      console.error(`Error placing order on ${this.exchangeName}:`, error);
      throw error;
    }
  }

  async cancelOrder(orderId: string, symbol: string): Promise<boolean> {
    try {
      // If no API credentials, throw error for trading operations
      if (!this.exchange.apiKey || this.exchange.apiKey === 'test') {
        throw new Error(`Trading operations require API credentials for ${this.exchangeName}`);
      }

      await this.exchange.cancelOrder(orderId, symbol);
      return true;
    } catch (error) {
      console.error(`Error canceling order on ${this.exchangeName}:`, error);
      return false;
    }
  }

  async getTicker(symbol: string): Promise<{ price: number; [key: string]: unknown }> {
    try {
      const ticker = await this.exchange.fetchTicker(symbol);
      return {
        price: ticker.last || ticker.close || 0,
        ...ticker,
      };
    } catch (error) {
      console.error(`Error fetching ticker from ${this.exchangeName}:`, error);
      throw error;
    }
  }

  getExchangeName(): string {
    return this.exchangeName;
  }

  isTestnetMode(): boolean {
    return this.isTestnet;
  }
}

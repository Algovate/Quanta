import * as ccxt from 'ccxt';
import { Exchange, Account, Position, Candlestick, Order } from './types.js';

export class CoinbaseExchange implements Exchange {
  private exchange: ccxt.coinbase;
  private isTestnet: boolean;

  constructor(apiKey?: string, apiSecret?: string, testnet: boolean = true) {
    this.isTestnet = testnet;

    // Configure Coinbase exchange options
    const exchangeOptions: Record<string, unknown> = {
      apiKey,
      secret: apiSecret,
      options: {
        defaultType: 'spot',
        adjustForTimeDifference: true,
        fetchOHLCVMethod: 'publicGetProductsProductCandles', // Enable automatic granularity conversion
      },
      enableRateLimit: true,
    };

    // Only set sandbox if the exchange supports it
    try {
      const tempExchange = new ccxt.coinbase();
      if (tempExchange.urls && (tempExchange.urls as Record<string, unknown>).sandbox) {
        exchangeOptions.sandbox = testnet;
      }
    } catch {
      // If we can't determine sandbox support, don't set it
    }

    this.exchange = new ccxt.coinbase(exchangeOptions);
  }

  /**
   * Maps timeframe for Coinbase, which has specific granularity requirements
   * CCXT supports '1m', '5m', '15m', '1h', '6h', '1d' for Coinbase
   */
  private mapTimeframe(timeframe: string): string {
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

  async getAccount(): Promise<Account> {
    if (!this.exchange.apiKey || this.exchange.apiKey === 'test') {
      throw new Error('Account information requires API credentials for Coinbase');
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
      console.error('Error fetching account from Coinbase:', error);
      throw error;
    }
  }

  async getPositions(): Promise<Position[]> {
    try {
      if (!this.exchange.apiKey || this.exchange.apiKey === 'test') {
        return [];
      }

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
      console.error('Error fetching positions from Coinbase:', error);
      return [];
    }
  }

  async getCandlesticks(symbol: string, timeframe: string, limit: number): Promise<Candlestick[]> {
    try {
      // Map timeframe to Coinbase-specific format
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
      console.error('Error fetching candlesticks from Coinbase:', error);
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
        throw new Error('Trading operations require API credentials for Coinbase');
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
      console.error('Error placing order on Coinbase:', error);
      throw error;
    }
  }

  async cancelOrder(orderId: string, symbol: string): Promise<boolean> {
    try {
      if (!this.exchange.apiKey || this.exchange.apiKey === 'test') {
        throw new Error('Trading operations require API credentials for Coinbase');
      }

      await this.exchange.cancelOrder(orderId, symbol);
      return true;
    } catch (error) {
      console.error('Error canceling order on Coinbase:', error);
      return false;
    }
  }

  async getTicker(symbol: string): Promise<{ price: number; timestamp: number }> {
    try {
      const ticker = await this.exchange.fetchTicker(symbol);
      return {
        price: ticker.last || ticker.close || 0,
        timestamp: ticker.timestamp || Date.now(),
      };
    } catch (error) {
      console.error('Error fetching ticker from Coinbase:', error);
      throw error;
    }
  }

  getExchangeName(): string {
    return 'coinbase';
  }

  isTestnetMode(): boolean {
    return this.isTestnet;
  }
}

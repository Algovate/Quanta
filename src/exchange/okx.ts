import * as ccxt from 'ccxt';
import { Exchange, Account, Position, Candlestick, Order } from './types';

export class OKXExchange implements Exchange {
  private exchange: ccxt.okx;
  private isTestnet: boolean;

  constructor(apiKey?: string, apiSecret?: string, testnet: boolean = true) {
    this.isTestnet = testnet;

    // Configure OKX exchange options
    const exchangeOptions: Record<string, unknown> = {
      apiKey,
      secret: apiSecret,
      password: process.env.OKX_PASSPHRASE, // OKX requires passphrase
      options: {
        defaultType: 'future',
        adjustForTimeDifference: true,
      },
      enableRateLimit: true,
      sandbox: testnet,
    };

    this.exchange = new ccxt.okx(exchangeOptions);
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
      console.error('Error fetching account from OKX:', error);
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
      console.error('Error fetching positions from OKX:', error);
      return [];
    }
  }

  async getCandlesticks(symbol: string, timeframe: string, limit: number): Promise<Candlestick[]> {
    try {
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
      console.error('Error placing order on OKX:', error);
      throw error;
    }
  }

  async cancelOrder(orderId: string, symbol: string): Promise<boolean> {
    try {
      if (!this.exchange.apiKey || this.exchange.apiKey === 'test') {
        throw new Error('Trading operations require API credentials for OKX');
      }

      await this.exchange.cancelOrder(orderId, symbol);
      return true;
    } catch (error) {
      console.error('Error canceling order on OKX:', error);
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
      console.error('Error fetching ticker from OKX:', error);
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

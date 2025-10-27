import * as ccxt from 'ccxt';
import { Exchange, Account, Position, Candlestick, Order } from './types.js';

export class HyperliquidExchange implements Exchange {
  private exchange: ccxt.hyperliquid;
  private isTestnet: boolean;

  /**
   * Convert standard symbol format (e.g., BTC/USDT) to Hyperliquid perpetual format (e.g., BTC/USDC:USDC)
   * Hyperliquid uses USDC as quote currency and perpetual format
   */
  private convertSymbolToHyperliquid(symbol: string): string {
    // Convert BTC/USDT -> BTC/USDC:USDC
    if (symbol.endsWith('/USDT')) {
      return symbol.replace('/USDT', '/USDC:USDC');
    }
    // Already in Hyperliquid format
    return symbol;
  }

  /**
   * Check if API credentials are available
   */
  private requiresApiCredentials(): boolean {
    return !this.exchange.apiKey || this.exchange.apiKey === 'test';
  }

  /**
   * Get balance for USDC (Hyperliquid uses USDC, not USDT)
   */
  private extractBalanceValue(balance: ccxt.Balances): number {
    const total = balance.total as unknown as Record<string, number>;
    return total?.USDC || total?.USDT || 0;
  }

  constructor(apiKey?: string, apiSecret?: string, testnet: boolean = true) {
    this.isTestnet = testnet;

    // Configure Hyperliquid exchange options
    const exchangeOptions: Record<string, unknown> = {
      apiKey,
      secret: apiSecret,
      options: {
        defaultType: 'spot', // Hyperliquid supports both spot and perpetual
        adjustForTimeDifference: true,
      },
      enableRateLimit: true,
      sandbox: testnet,
    };

    try {
      this.exchange = new ccxt.hyperliquid(exchangeOptions);
    } catch (error) {
      console.error('Error initializing Hyperliquid:', error);
      throw new Error('Failed to initialize Hyperliquid exchange');
    }
  }

  async getAccount(): Promise<Account> {
    if (this.requiresApiCredentials()) {
      throw new Error('Account information requires API credentials for Hyperliquid');
    }

    try {
      const balance = await this.exchange.fetchBalance();
      const totalValue = this.extractBalanceValue(balance);
      const freeValue =
        (balance.free as unknown as Record<string, number>)?.USDC ||
        (balance.free as unknown as Record<string, number>)?.USDT ||
        0;
      const usedValue =
        (balance.used as unknown as Record<string, number>)?.USDC ||
        (balance.used as unknown as Record<string, number>)?.USDT ||
        0;

      return {
        balance: totalValue,
        equity: totalValue,
        availableMargin: freeValue,
        usedMargin: usedValue,
        marginRatio: 0,
        timestamp: Date.now(),
      };
    } catch (error) {
      console.error('Error fetching account from Hyperliquid:', error);
      throw error;
    }
  }

  async getPositions(): Promise<Position[]> {
    try {
      if (this.requiresApiCredentials()) {
        return [];
      }

      const positions = await this.exchange.fetchPositions();
      return this.mapPositions(positions);
    } catch (error) {
      console.error('Error fetching positions from Hyperliquid:', error);
      return [];
    }
  }

  /**
   * Map raw positions to standardized Position format
   */
  private mapPositions(positions: unknown[]): Position[] {
    return positions.map((pos: Record<string, unknown>) => {
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
  }

  async getCandlesticks(symbol: string, timeframe: string, limit: number): Promise<Candlestick[]> {
    try {
      // Convert to Hyperliquid format
      const hyperliquidSymbol = this.convertSymbolToHyperliquid(symbol);
      const ohlcv = await this.exchange.fetchOHLCV(hyperliquidSymbol, timeframe, undefined, limit);
      return ohlcv.map((candle: number[]) => ({
        timestamp: candle[0],
        open: candle[1],
        high: candle[2],
        low: candle[3],
        close: candle[4],
        volume: candle[5],
      }));
    } catch (error) {
      console.error('Error fetching candlesticks from Hyperliquid:', error);
      throw error;
    }
  }

  async placeOrder(
    symbol: string,
    side: 'buy' | 'sell',
    amount: number,
    price?: number
  ): Promise<Order> {
    if (this.requiresApiCredentials()) {
      throw new Error('Trading operations require API credentials for Hyperliquid');
    }

    try {
      const hyperliquidSymbol = this.convertSymbolToHyperliquid(symbol);
      const order = await this.exchange.createOrder(
        hyperliquidSymbol,
        'market',
        side as 'buy' | 'sell',
        amount,
        price
      );

      return this.mapOrder(order);
    } catch (error) {
      console.error('Error placing order on Hyperliquid:', error);
      throw error;
    }
  }

  /**
   * Map raw order to standardized Order format
   */
  private mapOrder(order: ccxt.Order): Order {
    return {
      id: order.id,
      symbol: order.symbol,
      side: order.side as 'buy' | 'sell',
      amount: order.amount,
      price: order.price || 0,
      status: order.status,
      timestamp: Date.now(),
    };
  }

  async cancelOrder(orderId: string, symbol: string): Promise<boolean> {
    if (this.requiresApiCredentials()) {
      throw new Error('Trading operations require API credentials for Hyperliquid');
    }

    try {
      const hyperliquidSymbol = this.convertSymbolToHyperliquid(symbol);
      await this.exchange.cancelOrder(orderId, hyperliquidSymbol);
      return true;
    } catch (error) {
      console.error('Error canceling order on Hyperliquid:', error);
      return false;
    }
  }

  async getTicker(symbol: string): Promise<{ price: number; timestamp: number }> {
    try {
      // Convert to Hyperliquid format
      const hyperliquidSymbol = this.convertSymbolToHyperliquid(symbol);
      const ticker = await this.exchange.fetchTicker(hyperliquidSymbol);
      return {
        price: ticker.last || ticker.close || 0,
        timestamp: Date.now(),
      };
    } catch (error) {
      console.error('Error fetching ticker from Hyperliquid:', error);
      throw error;
    }
  }

  getExchangeName(): string {
    return 'hyperliquid';
  }

  isTestnetMode(): boolean {
    return this.isTestnet;
  }
}

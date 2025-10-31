import * as ccxt from 'ccxt';
import { Exchange, Account, Position, Candlestick, Order } from './types.js';
import { getConfig } from '../config/settings.js';
import { mapAccountFromBalance, mapPositionsStandard, mapOHLCV } from './ccxt-helpers.js';

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

  // Removed legacy balance helpers; we now use mapAccountFromBalance

  /**
   * Resolve market type for Hyperliquid defaultType option.
   * Supports env overrides: HYPERLIQUID_DEFAULT_TYPE or EXCHANGE_MARKET_TYPE.
   */
  private resolveDefaultType(): 'spot' | 'swap' {
    // 1) Config value takes precedence if provided
    try {
      const cfg = getConfig();
      const mt = cfg.exchange?.marketType?.toLowerCase();
      if (mt === 'spot') return 'spot';
      if (mt === 'swap' || mt === 'perp' || mt === 'perpetual') return 'swap';
    } catch (_e) {
      void _e;
    }

    // 2) Environment variable fallback
    const envValue = process.env.HYPERLIQUID_DEFAULT_TYPE || process.env.EXCHANGE_MARKET_TYPE || '';
    const normalized = envValue.toLowerCase();
    if (normalized === 'spot') return 'spot';
    if (normalized === 'swap' || normalized === 'perp' || normalized === 'perpetual') return 'swap';
    // fallback to current behavior: spot
    return 'spot';
  }

  constructor(apiKey?: string, apiSecret?: string, testnet: boolean = true) {
    this.isTestnet = testnet;

    // Configure Hyperliquid exchange options
    const exchangeOptions: Record<string, unknown> = {
      apiKey,
      secret: apiSecret,
      options: {
        defaultType: this.resolveDefaultType(), // configurable via env
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
      // Prefer USDC for Hyperliquid
      return mapAccountFromBalance(balance, 'USDC');
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
      return mapPositionsStandard(positions as unknown[]);
    } catch (error) {
      console.error('Error fetching positions from Hyperliquid:', error);
      return [];
    }
  }

  /**
   * Map raw positions to standardized Position format
   */
  // Removed legacy mapper; using mapPositionsStandard directly

  async getCandlesticks(symbol: string, timeframe: string, limit: number): Promise<Candlestick[]> {
    try {
      // Convert to Hyperliquid format
      const hyperliquidSymbol = this.convertSymbolToHyperliquid(symbol);
      const ohlcv = await this.exchange.fetchOHLCV(hyperliquidSymbol, timeframe, undefined, limit);
      return ohlcv.map(mapOHLCV);
    } catch (error) {
      console.error('Error fetching candlesticks from Hyperliquid:', error);
      throw error;
    }
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

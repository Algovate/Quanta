import * as ccxt from 'ccxt';
import { Exchange, Account, Position, Candlestick, Order } from './types.js';
import { Logger } from '../utils/logger.js';
import { withRetry, createRetryConfig } from '../utils/retry.js';
import { ensureMarketsLoaded, mapOHLCV, type MarketsState } from './ccxt-helpers.js';

export class OKXExchange implements Exchange {
  private exchange: ccxt.okx;
  private isTestnet: boolean;
  private marketsState: MarketsState = { promise: null };
  private logger = Logger.getInstance('OKXExchange');

  constructor(
    apiKey?: string,
    apiSecret?: string,
    testnet: boolean = true,
    okxCtor?: new (options: Record<string, unknown>) => ccxt.okx
  ) {
    this.isTestnet = testnet;

    // Configure OKX exchange options
    // Note: adjustForTimeDifference: true ensures CCXT handles timezone adjustments
    // and returns timestamps in UTC milliseconds, ensuring consistent timezone handling
    const exchangeOptions: Record<string, unknown> = {
      apiKey,
      secret: apiSecret,
      password: process.env.OKX_PASSPHRASE, // OKX requires passphrase
      options: {
        defaultType: 'swap',
        adjustForTimeDifference: true, // Ensures UTC timestamps from CCXT
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

  /**
   * Resolve an input symbol/coin to a ccxt OKX symbol for the desired market type.
   * Examples:
   *  - resolveInstrument('BTC', 'perp') => 'BTC/USDT:USDT'
   *  - resolveInstrument('BTC/USDT', 'spot') => 'BTC/USDT'
   *  - resolveInstrument('BTC-USDT-SWAP', 'perp') => 'BTC/USDT:USDT'
   */
  public resolveInstrument(input: string, marketType: 'perp' | 'spot' = 'perp'): string {
    // Normalize common inputs
    const trimmed = input.trim();
    // If already a ccxt OKX perpetual symbol
    if (/^[A-Z0-9]+\/USDT:USDT$/.test(trimmed)) {
      return marketType === 'perp' ? trimmed : trimmed.replace(':USDT', '');
    }
    // If OKX id form 'BTC-USDT-SWAP'
    if (/^[A-Z0-9]+-USDT-SWAP$/.test(trimmed)) {
      return marketType === 'perp'
        ? trimmed.replace('-USDT-SWAP', '/USDT:USDT')
        : trimmed.replace('-USDT-SWAP', '/USDT');
    }
    // If standard spot symbol
    if (/^[A-Z0-9]+\/USDT$/.test(trimmed)) {
      return marketType === 'perp' ? `${trimmed}:USDT` : trimmed;
    }
    // If just the base coin symbol (e.g., 'BTC')
    if (/^[A-Z0-9]+$/.test(trimmed)) {
      return marketType === 'perp' ? `${trimmed}/USDT:USDT` : `${trimmed}/USDT`;
    }
    // Fallback: return as-is; caller must ensure correctness
    return trimmed;
  }

  /**
   * Fetch mark, bid, ask, mid prices for a given instrument using a unified source.
   * Prefers mark price (ticker.info.markPx) when available; falls back to last/close.
   *
   * Price type usage:
   * - Mark Price: Used for PnL calculations, position valuation, risk checks (derivatives)
   * - Mid Price: Used for order execution decisions, limit order price matching
   * - Last Price: Fallback when mark price unavailable
   */
  public async getMarkAndBestPrices(
    input: string,
    marketType: 'perp' | 'spot' = 'perp'
  ): Promise<{ symbol: string; mark: number; bid: number; ask: number; mid: number; ts: number }> {
    await this.ensureMarkets();
    const symbol = this.resolveInstrument(input, marketType);
    const ticker = await this.exchange.fetchTicker(symbol);
    // Extract mark price when exposed by OKX via ccxt .info.markPx
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const info = ticker.info as any;
    const markFromInfo = info?.markPx ? Number(info.markPx) : undefined;
    const bid = (ticker.bid as number) ?? 0;
    const ask = (ticker.ask as number) ?? 0;
    const lastLike = (ticker.last as number) ?? (ticker.close as number) ?? 0;

    // Mark price: prefer from exchange API, fallback to last/close
    const mark =
      Number.isFinite(markFromInfo) && markFromInfo! > 0
        ? (markFromInfo as number)
        : lastLike > 0
          ? lastLike
          : 0;

    // Mid price: (bid + ask) / 2, fallback to mark, then last
    const mid = bid > 0 && ask > 0 ? (bid + ask) / 2 : mark > 0 ? mark : lastLike;

    const ts = ticker.timestamp || Date.now();
    return { symbol, mark, bid: bid || 0, ask: ask || 0, mid, ts };
  }

  private async ensureMarkets(): Promise<void> {
    return ensureMarketsLoaded(this.exchange, this.logger, this.marketsState);
  }

  async getAccount(): Promise<Account> {
    if (!this.exchange.apiKey || this.exchange.apiKey === 'test') {
      throw new Error('Account information requires API credentials for OKX');
    }

    return withRetry(
      async () => {
        const balance = await this.exchange.fetchBalance();
        return {
          balance: (balance.total as unknown as Record<string, number>)?.USDT || 0,
          equity: (balance.total as unknown as Record<string, number>)?.USDT || 0,
          availableMargin: (balance.free as unknown as Record<string, number>)?.USDT || 0,
          usedMargin: (balance.used as unknown as Record<string, number>)?.USDT || 0,
          marginRatio: 0,
          timestamp: Date.now(),
        };
      },
      createRetryConfig({
        maxRetries: 3,
        baseDelay: 1000,
        maxDelay: 5000,
        onRetry: (attempt, error) => {
          this.logger.warn('Retrying OKX getAccount', {
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
        await this.ensureMarkets();
        const positions = await this.exchange.fetchPositions();
        return (positions as unknown[]).map((pos: Record<string, unknown>) => {
          const size = pos.contracts as number;
          const markPrice = (pos.markPrice as number) ?? 0;
          const leverage = (pos.leverage as number) || 1;
          // Validate markPrice - positions from exchange should always have valid markPrice
          // But handle gracefully if exchange returns invalid data
          if (markPrice <= 0 || !isFinite(markPrice)) {
            this.logger.warn(`Invalid markPrice from OKX position: ${markPrice}`, {
              symbol: pos.symbol as string,
              markPrice,
            });
            // Don't skip position - return with 0 but log warning
            // Caller should handle this appropriately
          }
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
      },
      createRetryConfig({
        maxRetries: 3,
        baseDelay: 1000,
        maxDelay: 5000,
        onRetry: (attempt, error) => {
          this.logger.warn('Retrying OKX getPositions', {
            attempt,
            error: error instanceof Error ? error.message : String(error),
          });
        },
      })
    ).catch(error => {
      this.logger.error('Error fetching positions from OKX after retries', error as Error);
      return [];
    });
  }

  async getCandlesticks(symbol: string, timeframe: string, limit: number): Promise<Candlestick[]> {
    return withRetry(
      async () => {
        await this.ensureMarkets();
        const perpSymbol = this.resolveInstrument(symbol, 'perp');
        const ohlcv = await this.exchange.fetchOHLCV(perpSymbol, timeframe, undefined, limit);
        return ohlcv.map(mapOHLCV);
      },
      createRetryConfig({
        maxRetries: 3,
        baseDelay: 1000,
        maxDelay: 5000,
        onRetry: (attempt, error) => {
          this.logger.warn('Retrying OKX getCandlesticks', {
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
    // For real exchanges, we cannot guarantee atomicity; fetch sequentially as best-effort
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
        throw new Error('Trading operations require API credentials for OKX');
      }

      await this.ensureMarkets();
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
        // For market orders, price may be 0 or undefined (executed by market)
        // For limit orders, price should be the limit price
        // Callers should handle 0 price appropriately (e.g., use ticker price for slippage calculation)
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
      await this.ensureMarkets();
      await this.exchange.cancelOrder(orderId, symbol);
      return true;
    } catch (error) {
      this.logger.error('Error canceling order on OKX', error as Error);
      return false;
    }
  }

  /**
   * Get ticker price for a symbol
   * CRITICAL: Returns mark price (not mid) for derivatives trading
   * Mark price is used for PnL calculations and position valuation
   * For order execution decisions, use getMarkAndBestPrices() to get mid price
   *
   * @param symbol - Symbol to get ticker for
   * @returns Ticker with mark price (critical for accurate PnL calculations)
   */
  async getTicker(symbol: string): Promise<{ price: number; timestamp: number }> {
    return withRetry(
      async () => {
        await this.ensureMarkets();
        const { mark, ts } = await this.getMarkAndBestPrices(symbol, 'perp');
        // Use mark price instead of mid - critical for derivatives PnL accuracy
        return { price: mark, timestamp: ts };
      },
      createRetryConfig({
        maxRetries: 3,
        baseDelay: 500, // Faster retry for ticker (less critical)
        maxDelay: 2000,
        onRetry: (attempt, error) => {
          this.logger.warn('Retrying OKX getTicker', {
            attempt,
            symbol,
            error: error instanceof Error ? error.message : String(error),
          });
        },
      })
    );
  }

  getExchangeName(): string {
    return 'okx';
  }

  isTestnetMode(): boolean {
    return this.isTestnet;
  }
}

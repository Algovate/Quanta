import type { Exchange } from './types.js';
import type { Account, Position, Candlestick, Order } from '../types/index.js';
import { withRetry, createRetryConfig, type RetryConfig } from '../utils/retry.js';
import { Logger } from '../utils/logger.js';

export interface IdempotentOptions {
  idempotencyKey?: string;
  retry?: Partial<RetryConfig>;
}

/**
 * IdempotentExchangeAdapter wraps an existing Exchange to provide
 * best-effort idempotency and retry for order placement without
 * changing the underlying Exchange interface.
 */
export class IdempotentExchangeAdapter implements Exchange {
  private readonly inner: Exchange;
  private readonly logger = Logger.getInstance('IdempotentExchangeAdapter');
  private readonly orderCache = new Map<string, Order>();

  constructor(inner: Exchange) {
    this.inner = inner;
  }

  // --- Exchange passthroughs ---
  async getAccount(): Promise<Account> {
    return this.inner.getAccount();
  }

  async getPositions(): Promise<Position[]> {
    return this.inner.getPositions();
  }

  async getSnapshot(): Promise<{ account: Account; positions: Position[] }> {
    return this.inner.getSnapshot();
  }

  async getCandlesticks(symbol: string, timeframe: string, limit: number): Promise<Candlestick[]> {
    return this.inner.getCandlesticks(symbol, timeframe, limit);
  }

  async placeOrder(
    symbol: string,
    side: 'buy' | 'sell',
    amount: number,
    price?: number,
    leverage?: number
  ): Promise<Order> {
    // Plain passthrough for compatibility
    return this.inner.placeOrder(symbol, side, amount, price, leverage);
  }

  async placeOrderIdempotent(
    symbol: string,
    side: 'buy' | 'sell',
    amount: number,
    options: IdempotentOptions = {},
    price?: number,
    leverage?: number
  ): Promise<Order> {
    const key = options.idempotencyKey;
    if (key && this.orderCache.has(key)) {
      return this.orderCache.get(key)!;
    }

    const retryCfg = createRetryConfig({
      maxRetries: 3,
      baseDelay: 500,
      maxDelay: 5_000,
      ...options.retry,
    });

    const order = await withRetry(
      () => this.inner.placeOrder(symbol, side, amount, price, leverage),
      retryCfg
    );

    if (key) {
      this.orderCache.set(key, order);
      this.logger.debug?.('Order cached by idempotencyKey', { key } as any);
    }
    return order;
  }

  async cancelOrder(orderId: string, symbol: string): Promise<boolean> {
    return this.inner.cancelOrder(orderId, symbol);
  }

  async getTicker(symbol: string): Promise<{ price: number; timestamp: number }> {
    return this.inner.getTicker(symbol);
  }

  getCompletedTrades?(): import('../types/index.js').CompletedTrade[] {
    return typeof this.inner.getCompletedTrades === 'function'
      ? this.inner.getCompletedTrades()
      : [];
  }

  getExchangeName(): string {
    return `adapter(${this.inner.getExchangeName()})`;
  }
}

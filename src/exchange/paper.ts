import { Exchange, Account, Position, Order } from './types.js';
import { PositionUpdateManager } from './position-manager.js';
import { Logger } from '../utils/logger.js';
import { roundToPrecision, EXCHANGE_PRECISION } from '../utils/precision.js';

/**
 * PaperExchange: wraps a real Exchange for market data, simulates execution locally.
 * - Delegates read-only data (ticker, klines) to the real exchange
 * - Manages account, positions, and executions in-memory via PositionUpdateManager
 */
export class PaperExchange implements Exchange {
  private readonly real: Exchange;
  private readonly logger = Logger.getInstance('PaperExchange');
  private readonly positionManager: PositionUpdateManager;
  private readonly account: Account;
  private readonly positions: Position[] = [];
  private readonly completedTrades: Array<{
    id: string;
    symbol: string;
    side: 'long' | 'short';
    size: number;
    entryPrice: number;
    exitPrice: number;
    pnl: number;
    timestamp: number;
  }> = [];

  constructor(real: Exchange, initialBalance: number = 10000) {
    this.real = real;
    this.account = {
      balance: initialBalance,
      equity: initialBalance,
      availableMargin: initialBalance,
      usedMargin: 0,
      marginRatio: 0,
      timestamp: Date.now(),
    };
    this.positionManager = new PositionUpdateManager({
      account: this.account,
      positions: this.positions,
      completedTrades: this.completedTrades as any,
      onAccountUpdate: () => {
        this.account.timestamp = Date.now();
      },
    });
  }

  // --- Metadata ---
  getExchangeName(): string {
    const name = (this.real as unknown as { getExchangeName?: () => string }).getExchangeName?.();
    return `paper(${name || 'exchange'})`;
  }

  isTestnetMode(): boolean {
    const fn = (this.real as unknown as { isTestnetMode?: () => boolean }).isTestnetMode;
    return Boolean(fn?.());
  }

  // --- Market Data (delegated) ---
  async getCandlesticks(symbol: string, timeframe: string, limit: number) {
    return this.real.getCandlesticks(symbol, timeframe, limit);
  }

  async getTicker(symbol: string): Promise<{ price: number; timestamp: number }> {
    return this.real.getTicker(symbol);
  }

  // --- Account & Positions (local state) ---
  async getAccount(): Promise<Account> {
    await this.refreshMarks();
    return { ...this.account };
  }

  async getPositions(): Promise<Position[]> {
    await this.refreshMarks();
    return this.positions.map(p => ({ ...p }));
  }

  async getSnapshot(): Promise<{ account: Account; positions: Position[] }> {
    await this.refreshMarks();
    return { account: { ...this.account }, positions: this.positions.map(p => ({ ...p })) };
  }

  getCompletedTrades?(): any[] {
    return [...this.completedTrades];
  }

  // --- Trading (simulated) ---
  async placeOrder(
    symbol: string,
    side: 'buy' | 'sell',
    amount: number,
    price?: number,
    leverage: number = 1
  ): Promise<Order> {
    // Fetch current mid (delegated ticker should already be mid/mark-consistent)
    let current: number;
    try {
      const t = await this.getTicker(symbol);
      current = t.price;
    } catch (e) {
      const err = e as Error;
      this.logger.warn(`Ticker failed for ${symbol}, using fallback price 0`, {
        error: err?.message || String(e),
      });
      current = 0;
    }

    // Determine execution price
    let executedPrice = current;
    if (price !== undefined) {
      const crosses = (side === 'buy' && price >= current) || (side === 'sell' && price <= current);
      if (!crosses) {
        // For MVP, treat non-crossing limit as open then immediately cancel (paper simplification)
        return {
          id: `${symbol}-${Date.now()}`,
          symbol,
          side,
          amount,
          price: roundToPrecision(price, EXCHANGE_PRECISION.USDT),
          status: 'open',
          timestamp: Date.now(),
        };
      }
      executedPrice = price;
    }

    // Update position state
    this.positionManager.updatePosition(symbol, side, amount, executedPrice, leverage);

    // Return filled order
    return {
      id: `${symbol}-${Date.now()}`,
      symbol,
      side,
      amount,
      price: roundToPrecision(executedPrice, EXCHANGE_PRECISION.USDT),
      status: 'filled',
      timestamp: Date.now(),
    };
  }

  async cancelOrder(_orderId: string, _symbol: string): Promise<boolean> {
    // No persistent open orders in MVP paper mode
    return true;
  }

  // --- Helpers ---
  /** Update markPrice/unrealizedPnl via PositionUpdateManager using real-time price lookup */
  private async refreshMarks(): Promise<void> {
    const priceCache = new Map<string, number>();
    const getPrice = (symbol: string) => priceCache.get(symbol) ?? 0;

    // Preload prices in parallel for current symbols
    const symbols = Array.from(new Set(this.positions.map(p => p.symbol)));
    if (symbols.length > 0) {
      const results = await Promise.all(
        symbols.map(async s => {
          try {
            const t = await this.real.getTicker(s);
            priceCache.set(s, t.price);
          } catch (e) {
            const err = e as Error;
            this.logger.warn(`Failed to fetch ticker for ${s}`, {
              error: err?.message || String(e),
            });
            priceCache.set(s, 0);
          }
        })
      );
      void results;
    }

    this.positionManager.updateAllPositions(getPrice);
  }
}

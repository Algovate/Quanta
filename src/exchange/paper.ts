import { Exchange, Account, Position, Order } from './types.js';
import { CompletedTrade } from '../types/index.js';
import { PositionUpdateManager } from './position-manager.js';
import { UnifiedLogger } from '../logging/index.js';
import { roundToPrecision, EXCHANGE_PRECISION } from '../utils/precision.js';
import { getValidPriceWithFallback, validatePrice } from '../utils/price-validation.js';

/**
 * PaperExchange: wraps a real Exchange for market data, simulates execution locally.
 * - Delegates read-only data (ticker, klines) to the real exchange
 * - Manages account, positions, and executions in-memory via PositionUpdateManager
 */
export class PaperExchange implements Exchange {
  private readonly real: Exchange;
  private readonly logger = UnifiedLogger.getInstance();
  private readonly context = 'PaperExchange';
  private readonly positionManager: PositionUpdateManager;
  private readonly account: Account;
  private readonly positions: Position[] = [];
  private readonly completedTrades: CompletedTrade[] = [];
  // Track last known valid prices per symbol to use as fallback
  private readonly lastKnownPrices = new Map<string, number>();

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
      completedTrades: this.completedTrades,
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
    // Fetch current price for execution decision (mid price for order matching)
    // Use mark price for PnL calculations later via refreshMarks()
    let current: number;
    try {
      const t = await this.getTicker(symbol);
      current = validatePrice(t.price, `placeOrder(${symbol})`);
      // Update last known price
      this.lastKnownPrices.set(symbol, current);
    } catch (e) {
      const err = e as Error;
      // Try to use last known valid price as fallback
      const lastKnown = this.lastKnownPrices.get(symbol);
      try {
        current = getValidPriceWithFallback(
          undefined,
          lastKnown,
          `placeOrder(${symbol}) - ticker fetch failed`
        );
        this.logger.warn(
          `Ticker failed for ${symbol}, using last known price ${current}`,
          {
            error: err?.message || String(e),
          },
          this.context
        );
      } catch (fallbackError) {
        // No valid price available - fail the order
        this.logger.error(
          `Cannot place order for ${symbol}: no valid price`,
          new Error(
            `Ticker error: ${err?.message || String(e)}, Fallback error: ${fallbackError instanceof Error ? fallbackError.message : String(fallbackError)}`
          ),
          this.context
        );
        throw new Error(
          `Cannot place order for ${symbol}: price fetch failed and no valid fallback price available`
        );
      }
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

    // Update position state using executed price
    this.positionManager.updatePosition(symbol, side, amount, executedPrice, leverage);

    // Immediately refresh marks so unrealized P&L reflects latest market price within the same cycle
    // NOTE: This may fetch a slightly different price than 'current' used for execution,
    // but this is intentional - executedPrice is the execution price, markPrice should reflect
    // current market value for accurate PnL calculation
    try {
      await this.refreshMarks();
    } catch (e) {
      const err = e as Error;
      this.logger.warn(`Failed to refresh marks after order for ${symbol}`, {
        error: err?.message || String(e),
      });
      // Don't throw - order was already executed, just log the warning
      // Position will keep its previous markPrice (initialized to executedPrice above)
    }

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
  /**
   * Update markPrice/unrealizedPnl via PositionUpdateManager using real-time price lookup
   * Uses mark price for PnL calculations (critical for accuracy in derivatives trading)
   *
   * NOTE: This relies on the underlying exchange's getTicker() returning mark price.
   * OKXExchange.getTicker() now returns mark price, ensuring correct PnL calculations.
   * For exchanges that don't support mark price, getTicker() should still return a
   * reasonable price for PnL calculation (last/mid price as fallback).
   */
  private async refreshMarks(): Promise<void> {
    const priceCache = new Map<string, number>();

    // Preload mark prices in parallel for current symbols
    // Use getTicker() which should return mark price (OKX) or appropriate fallback
    const symbols = Array.from(new Set(this.positions.map(p => p.symbol)));
    if (symbols.length > 0) {
      await Promise.all(
        symbols.map(async s => {
          try {
            const t = await this.real.getTicker(s);
            // getTicker() now returns mark price for OKX, or appropriate price for other exchanges
            const price = validatePrice(t.price, `refreshMarks(${s})`);
            priceCache.set(s, price);
            // Update last known valid price
            this.lastKnownPrices.set(s, price);
          } catch (e) {
            const err = e as Error;
            // Try to use last known valid price as fallback
            const lastKnown = this.lastKnownPrices.get(s);
            try {
              const price = getValidPriceWithFallback(
                undefined,
                lastKnown,
                `refreshMarks(${s}) - ticker fetch failed`
              );
              priceCache.set(s, price);
              this.logger.warn(
                `Failed to fetch ticker for ${s}, using last known price ${price}`,
                {
                  error: err?.message || String(e),
                },
                this.context
              );
            } catch (fallbackError) {
              // No valid price - log error but don't update this position
              // This is better than using 0 which would cause incorrect PnL
              this.logger.error(
                `Cannot refresh marks for ${s}: no valid price available`,
                new Error(
                  `Ticker error: ${err?.message || String(e)}, Fallback error: ${fallbackError instanceof Error ? fallbackError.message : String(fallbackError)}`
                ),
                this.context
              );
              // Don't set price to 0 - skip this position update
              // The position will keep its previous markPrice
            }
          }
        })
      );
    }

    // Only update positions with valid prices
    const getPrice = (symbol: string): number => {
      const price = priceCache.get(symbol);
      if (price !== undefined) {
        return price;
      }
      // If no valid price in cache, try last known price
      const lastKnown = this.lastKnownPrices.get(symbol);
      if (lastKnown !== undefined) {
        try {
          return validatePrice(lastKnown, `refreshMarks.getPrice(${symbol})`);
        } catch {
          // Invalid last known price - this position won't be updated
          return 0; // PositionUpdateManager will skip if price is 0
        }
      }
      // No price available - this should not happen if positions exist
      this.logger.error(
        `No price available for ${symbol} in refreshMarks`,
        new Error(`No price available for ${symbol}`),
        this.context
      );
      return 0; // PositionUpdateManager should handle this gracefully
    };

    // Filter positions to only update those with valid prices
    const positionsWithValidPrices = this.positions.filter(p => {
      const price = priceCache.get(p.symbol);
      return price !== undefined && price > 0;
    });

    if (positionsWithValidPrices.length > 0) {
      this.positionManager.updateAllPositions(getPrice);
    } else if (this.positions.length > 0) {
      this.logger.warn(
        `No valid prices available for any position during refreshMarks`,
        {},
        this.context
      );
    }
  }
}

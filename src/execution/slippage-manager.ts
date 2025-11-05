/**
 * Slippage management and monitoring
 * Tracks slippage, calculates expected slippage, and provides warnings
 */

import { UnifiedLogger } from '../logging/index.js';
import { TechnicalIndicators } from '../types/index.js';

export interface SlippageMetrics {
  expectedSlippage: number; // Expected slippage percentage (0-1)
  shouldUseLimitOrder: boolean; // Whether to use limit order instead of market order
  warning: string | null; // Warning message if slippage is high
  historicalAverage: number; // Historical average slippage for this symbol
  orderSizeImpact: number; // Order size impact factor (0-1)
}

export interface SlippageRecord {
  symbol: string;
  timestamp: number;
  expectedPrice: number;
  actualPrice: number;
  slippage: number; // Percentage (0-1)
  orderSize: number;
  side: 'buy' | 'sell';
}

export class SlippageManager {
  private logger: UnifiedLogger;
  private readonly context = 'SlippageManager';
  private slippageHistory: Map<string, SlippageRecord[]> = new Map();
  private readonly maxHistorySize = 100; // Keep last 100 records per symbol

  // Slippage thresholds
  private readonly HIGH_SLIPPAGE_THRESHOLD = 0.005; // 0.5%
  private readonly VERY_HIGH_SLIPPAGE_THRESHOLD = 0.01; // 1.0%
  private readonly LIMIT_ORDER_THRESHOLD = 0.003; // 0.3% - use limit order if expected > this

  constructor() {
    this.logger = UnifiedLogger.getInstance();
  }

  /**
   * Calculate expected slippage based on order size, market conditions, and volatility
   * @param symbol - Trading symbol
   * @param orderSize - Order size in units
   * @param currentPrice - Current market price
   * @param side - Order side (buy/sell)
   * @param indicators - Technical indicators (for volatility)
   * @returns Expected slippage metrics
   */
  calculateExpectedSlippage(
    symbol: string,
    orderSize: number,
    currentPrice: number,
    _side: 'buy' | 'sell',
    indicators?: TechnicalIndicators
  ): SlippageMetrics {
    // Base slippage (small orders have minimal slippage)
    const orderValue = orderSize * currentPrice;
    let baseSlippage = 0.0001; // 0.01% base slippage

    // Order size impact: larger orders have more slippage
    // Estimate market impact based on order size
    // Rough approximation: 0.01% per $10k of order value
    const sizeImpact = Math.min((orderValue / 10000) * 0.0001, 0.002); // Cap at 0.2%
    baseSlippage += sizeImpact;

    // Volatility impact: higher volatility = more slippage
    let volatilityFactor = 1.0;
    if (indicators?.atr14 && currentPrice > 0) {
      const atrPercent = indicators.atr14 / currentPrice;
      // Higher ATR% = more slippage
      volatilityFactor = 1.0 + Math.min(atrPercent * 10, 2.0); // Cap at 3x
    }

    // Volume impact: lower volume = more slippage
    let volumeFactor = 1.0;
    if (indicators?.volume) {
      const volumeRatio = indicators.volume.ratio;
      if (volumeRatio < 0.5) {
        volumeFactor = 1.5; // Low volume = 50% more slippage
      } else if (volumeRatio < 0.8) {
        volumeFactor = 1.2; // Below average volume = 20% more slippage
      } else if (volumeRatio > 1.5) {
        volumeFactor = 0.8; // High volume = 20% less slippage
      }
    }

    const expectedSlippage = baseSlippage * volatilityFactor * volumeFactor;

    // Get historical average for comparison
    const historicalAverage = this.getHistoricalAverage(symbol);

    // Determine if we should use limit order
    const shouldUseLimitOrder = expectedSlippage > this.LIMIT_ORDER_THRESHOLD;

    // Generate warning if slippage is high
    let warning: string | null = null;
    if (expectedSlippage > this.VERY_HIGH_SLIPPAGE_THRESHOLD) {
      warning = `Very high expected slippage: ${(expectedSlippage * 100).toFixed(2)}%`;
    } else if (expectedSlippage > this.HIGH_SLIPPAGE_THRESHOLD) {
      warning = `High expected slippage: ${(expectedSlippage * 100).toFixed(2)}%`;
    }

    return {
      expectedSlippage,
      shouldUseLimitOrder,
      warning,
      historicalAverage,
      orderSizeImpact: sizeImpact / baseSlippage,
    };
  }

  /**
   * Record actual slippage for tracking and analysis
   * @param record - Slippage record to add
   */
  recordSlippage(record: SlippageRecord): void {
    const symbol = record.symbol;
    if (!this.slippageHistory.has(symbol)) {
      this.slippageHistory.set(symbol, []);
    }

    const history = this.slippageHistory.get(symbol);
    if (history) {
      history.push(record);

      // Keep only recent history
      if (history.length > this.maxHistorySize) {
        history.shift();
      }

      // Log high slippage
      if (Math.abs(record.slippage) > this.HIGH_SLIPPAGE_THRESHOLD) {
        this.logger.warn(
          'High slippage detected',
          {
            symbol: record.symbol,
            slippage: (record.slippage * 100).toFixed(2) + '%',
            expectedPrice: record.expectedPrice,
            actualPrice: record.actualPrice,
            orderSize: record.orderSize,
            side: record.side,
          },
          this.context
        );
      }
    }
  }

  /**
   * Get historical average slippage for a symbol
   * @param symbol - Trading symbol
   * @returns Average slippage percentage (0-1)
   */
  getHistoricalAverage(symbol: string): number {
    const history = this.slippageHistory.get(symbol);
    if (!history || history.length === 0) {
      return 0.001; // Default 0.1% if no history
    }

    const avgSlippage = history.reduce((sum, r) => sum + Math.abs(r.slippage), 0) / history.length;
    return avgSlippage;
  }

  /**
   * Get slippage statistics for a symbol
   * @param symbol - Trading symbol
   * @returns Slippage statistics
   */
  getSlippageStats(symbol: string): {
    average: number;
    max: number;
    min: number;
    count: number;
    recentAverage: number; // Last 10 trades
  } {
    const history = this.slippageHistory.get(symbol);
    if (!history || history.length === 0) {
      return {
        average: 0,
        max: 0,
        min: 0,
        count: 0,
        recentAverage: 0,
      };
    }

    const slippages = history.map(r => Math.abs(r.slippage));
    const recentSlippages = history.slice(-10).map(r => Math.abs(r.slippage));

    return {
      average: slippages.reduce((a, b) => a + b, 0) / slippages.length,
      max: Math.max(...slippages),
      min: Math.min(...slippages),
      count: history.length,
      recentAverage: recentSlippages.reduce((a, b) => a + b, 0) / recentSlippages.length,
    };
  }

  /**
   * Get all tracked symbols
   * @returns Array of symbols with slippage history
   */
  getTrackedSymbols(): string[] {
    return Array.from(this.slippageHistory.keys());
  }

  /**
   * Clear slippage history for a symbol or all symbols
   * @param symbol - Optional symbol to clear, or clear all if omitted
   */
  clearHistory(symbol?: string): void {
    if (symbol) {
      this.slippageHistory.delete(symbol);
    } else {
      this.slippageHistory.clear();
    }
  }
}

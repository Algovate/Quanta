/**
 * Per-symbol performance tracking for adaptive parameters
 * Tracks win rate, average R-multiple, and adjusts leverage/confidence thresholds
 */

import { CompletedTrade } from '../types/index.js';
import { Logger } from '../utils/logger.js';

export interface SymbolStats {
  symbol: string;
  totalTrades: number;
  winningTrades: number;
  losingTrades: number;
  winRate: number; // 0-1
  avgRMultiple: number;
  avgWinR: number;
  avgLossR: number;
  lastUpdated: number;
}

export class SymbolPerformanceTracker {
  private stats: Map<string, SymbolStats> = new Map();
  private logger: Logger;
  private readonly lookbackPeriod: number; // Number of trades to consider (rolling window)

  constructor(lookbackPeriod: number = 50) {
    this.lookbackPeriod = lookbackPeriod;
    this.logger = Logger.getInstance('SymbolPerformance');
  }

  /**
   * Update stats from completed trades
   * Call this periodically with all completed trades
   */
  updateStats(completedTrades: CompletedTrade[]): void {
    // Group trades by symbol
    const tradesBySymbol = new Map<string, CompletedTrade[]>();
    for (const trade of completedTrades) {
      const symbol = trade.symbol.replace('/USDT', ''); // Normalize to coin name
      if (!tradesBySymbol.has(symbol)) {
        tradesBySymbol.set(symbol, []);
      }
      const symbolTrades = tradesBySymbol.get(symbol);
      if (symbolTrades) {
        symbolTrades.push(trade);
      }
    }

    // Update stats for each symbol
    for (const [symbol, trades] of tradesBySymbol.entries()) {
      // Use most recent N trades (rolling window)
      const recentTrades = trades.slice(-this.lookbackPeriod);
      this.updateSymbolStats(symbol, recentTrades);
    }
  }

  private updateSymbolStats(symbol: string, trades: CompletedTrade[]): void {
    if (trades.length === 0) return;

    const winningTrades = trades.filter(t => t.pnl > 0);
    const losingTrades = trades.filter(t => t.pnl < 0);

    // Calculate win rate
    const winRate = trades.length > 0 ? winningTrades.length / trades.length : 0;

    // Estimate R-multiples from PnL percentage (simplified)
    // Assuming standard 5% stop loss, R = pnlPercent / 5
    const rMultiples = trades.map(t => t.pnlPercent / 5);
    const avgRMultiple =
      rMultiples.length > 0 ? rMultiples.reduce((sum, r) => sum + r, 0) / rMultiples.length : 0;

    const avgWinR =
      winningTrades.length > 0
        ? winningTrades.reduce((sum, t) => sum + t.pnlPercent / 5, 0) / winningTrades.length
        : 0;

    const avgLossR =
      losingTrades.length > 0
        ? losingTrades.reduce((sum, t) => sum + t.pnlPercent / 5, 0) / losingTrades.length
        : 0;

    const stats: SymbolStats = {
      symbol,
      totalTrades: trades.length,
      winningTrades: winningTrades.length,
      losingTrades: losingTrades.length,
      winRate,
      avgRMultiple,
      avgWinR,
      avgLossR,
      lastUpdated: Date.now(),
    };

    this.stats.set(symbol, stats);

    if (trades.length >= 10) {
      // Only log after we have meaningful sample size
      this.logger.debug('Symbol performance updated', {
        symbol,
        winRate: (winRate * 100).toFixed(1) + '%',
        avgR: avgRMultiple.toFixed(2),
        trades: trades.length,
      });
    }
  }

  /**
   * Get performance stats for a symbol
   */
  getStats(symbol: string): SymbolStats | undefined {
    const normalizedSymbol = symbol.replace('/USDT', '');
    return this.stats.get(normalizedSymbol);
  }

  /**
   * Calculate leverage adjustment factor based on symbol performance
   * Returns multiplier: < 1.0 reduces leverage, > 1.0 increases leverage
   */
  getLeverageAdjustment(symbol: string): number {
    const stats = this.getStats(symbol);
    if (!stats || stats.totalTrades < 10) {
      // Not enough data, use default (1.0)
      return 1.0;
    }

    // Adjust leverage based on win rate and avg R-multiple
    let adjustment = 1.0;

    // Win rate factor: reduce leverage if win rate < 45%
    if (stats.winRate < 0.45) {
      const penalty = (0.45 - stats.winRate) / 0.45; // 0 to 1 penalty scale
      adjustment -= penalty * 0.3; // Reduce up to 30% for poor win rate
    } else if (stats.winRate > 0.55) {
      const bonus = (stats.winRate - 0.55) / 0.45; // 0 to 1 bonus scale
      adjustment += bonus * 0.2; // Increase up to 20% for good win rate
    }

    // R-multiple factor: reduce leverage if avg R < 0.5
    if (stats.avgRMultiple < 0.5) {
      const penalty = (0.5 - stats.avgRMultiple) / 0.5;
      adjustment -= penalty * 0.2; // Additional reduction for poor R
    } else if (stats.avgRMultiple > 1.0) {
      const bonus = (stats.avgRMultiple - 1.0) / 1.0;
      adjustment += bonus * 0.15; // Additional increase for good R
    }

    // Clamp between 0.5 and 1.5 (don't adjust too aggressively)
    return Math.max(0.5, Math.min(1.5, adjustment));
  }

  /**
   * Calculate confidence threshold adjustment for a symbol
   * Returns adjusted minimum confidence (higher = more conservative)
   */
  getConfidenceThreshold(symbol: string, defaultThreshold: number): number {
    const stats = this.getStats(symbol);
    if (!stats || stats.totalTrades < 10) {
      return defaultThreshold;
    }

    // Increase confidence threshold if performance is poor
    let adjustment = defaultThreshold;

    if (stats.winRate < 0.45 || stats.avgRMultiple < 0.5) {
      // Poor performance: require higher confidence
      adjustment += 0.05; // Add 5% to confidence requirement
    } else if (stats.winRate > 0.55 && stats.avgRMultiple > 1.0) {
      // Good performance: allow slightly lower confidence
      adjustment = Math.max(defaultThreshold - 0.02, 0.52); // Reduce by 2%, min 52%
    }

    return adjustment;
  }

  /**
   * Get all tracked symbols
   */
  getTrackedSymbols(): string[] {
    return Array.from(this.stats.keys());
  }

  /**
   * Clear all stats (useful for testing or reset)
   */
  clear(): void {
    this.stats.clear();
  }
}

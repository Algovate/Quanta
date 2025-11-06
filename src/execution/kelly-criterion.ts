/**
 * Kelly Criterion Calculator
 * Calculates optimal position sizing based on win rate and R-multiples
 */

import type { SymbolPerformanceTracker } from './symbol-performance.js';
import { UnifiedLogger } from '../logging/index.js';

export interface KellyResult {
  kellyFraction: number; // Optimal fraction of capital (0-1)
  recommendedFraction: number; // Conservative Kelly (typically 0.25-0.5 of full Kelly)
  positionSizeMultiplier: number; // Multiplier to apply to base position size
}

/**
 * Kelly Criterion Calculator
 *
 * Formula: f = (p * b - q) / b
 * where:
 * - f = fraction of capital to bet
 * - p = probability of winning
 * - q = probability of losing (1 - p)
 * - b = odds (win amount / loss amount) = avg win R / avg loss R
 */
export class KellyCriterionCalculator {
  private logger: UnifiedLogger;
  private readonly context = 'KellyCriterion';

  constructor(
    private performanceTracker: SymbolPerformanceTracker,
    private conservativeFactor: number = 0.25 // Use 25% of full Kelly for safety
  ) {
    this.logger = UnifiedLogger.getInstance();
  }

  /**
   * Calculate Kelly-optimal position sizing for a symbol
   */
  calculateKellySizing(symbol: string): KellyResult | null {
    const stats = this.performanceTracker.getStats(symbol);

    if (!stats || stats.totalTrades < 10) {
      // Need minimum sample size for reliable Kelly calculation
      return null;
    }

    const winRate = stats.winRate;
    const loseRate = 1 - winRate;

    // Calculate odds (b): average win R / average loss R
    const avgWinR = stats.avgWinR;
    const avgLossR = Math.abs(stats.avgLossR);

    if (avgLossR === 0 || avgWinR <= 0) {
      // Invalid data for Kelly calculation
      return null;
    }

    const odds = avgWinR / avgLossR;

    // Kelly Criterion formula: f = (p * b - q) / b
    // Simplified: f = p - q / b
    const kellyFraction = (winRate * odds - loseRate) / odds;

    // Kelly fraction must be positive
    if (kellyFraction <= 0) {
      // Kelly suggests not betting (negative edge)
      return {
        kellyFraction: 0,
        recommendedFraction: 0,
        positionSizeMultiplier: 0,
      };
    }

    // Cap Kelly at 25% of capital for safety (full Kelly can be too aggressive)
    const cappedKelly = Math.min(kellyFraction, 0.25);

    // Apply conservative factor
    const recommendedFraction = cappedKelly * this.conservativeFactor;

    // Calculate position size multiplier
    // If recommended fraction is 0.05 (5%), and base risk is 2%, multiplier = 2.5
    // We'll apply this as a multiplier to the base position size
    const baseRiskFraction = 0.02; // Assume 2% base risk
    const positionSizeMultiplier = recommendedFraction / baseRiskFraction;

    this.logger.debug(
      'Kelly Criterion calculated',
      {
        symbol,
        winRate: (winRate * 100).toFixed(1) + '%',
        avgWinR: avgWinR.toFixed(2),
        avgLossR: avgLossR.toFixed(2),
        odds: odds.toFixed(2),
        kellyFraction: (kellyFraction * 100).toFixed(2) + '%',
        recommendedFraction: (recommendedFraction * 100).toFixed(2) + '%',
        positionSizeMultiplier: positionSizeMultiplier.toFixed(2),
      },
      this.context
    );

    return {
      kellyFraction,
      recommendedFraction,
      positionSizeMultiplier: Math.max(0, Math.min(positionSizeMultiplier, 2.5)), // Cap at 2.5x
    };
  }

  /**
   * Get Kelly-optimal position size multiplier for a symbol
   * Returns 1.0 if Kelly cannot be calculated (fallback to base sizing)
   */
  getPositionSizeMultiplier(symbol: string): number {
    const kellyResult = this.calculateKellySizing(symbol);
    return kellyResult?.positionSizeMultiplier ?? 1.0;
  }
}

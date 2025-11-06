/**
 * Strategy Evolution System
 * A/B tests different parameter sets and adopts best performers
 */

import type { CompletedTrade } from '../types/index.js';
import { UnifiedLogger } from '../logging/index.js';

export interface StrategyVariant {
  id: string;
  name: string;
  params: {
    stopLoss: number;
    leverage: number;
    confidenceThreshold: number;
    maxRiskPerTrade: number;
  };
  performance: {
    totalTrades: number;
    winRate: number;
    avgRMultiple: number;
    profitFactor: number;
    sharpeRatio: number;
    totalReturn: number;
  };
  active: boolean;
  createdAt: number;
  lastUpdated: number;
}

export interface StrategyEvolutionResult {
  bestVariant: StrategyVariant | null;
  recommendedChange: {
    variant: StrategyVariant;
    reason: string;
    confidence: number;
  } | null;
}

/**
 * Strategy Evolution Manager
 * Tracks and evolves trading strategies
 */
export class StrategyEvolutionManager {
  private logger: UnifiedLogger;
  private readonly context = 'StrategyEvolution';
  private variants: Map<string, StrategyVariant> = new Map();
  private minTradesForEvolution: number = 20;

  constructor() {
    this.logger = UnifiedLogger.getInstance();
  }

  /**
   * Register a strategy variant
   */
  registerVariant(variant: StrategyVariant): void {
    this.variants.set(variant.id, variant);
    this.logger.info(
      `Registered strategy variant: ${variant.name} (${variant.id})`,
      {
        variantId: variant.id,
        params: variant.params,
      },
      this.context
    );
  }

  /**
   * Update variant performance
   */
  updateVariantPerformance(variantId: string, trades: CompletedTrade[]): void {
    const variant = this.variants.get(variantId);
    if (!variant) {
      return;
    }

    if (trades.length === 0) {
      return;
    }

    const winningTrades = trades.filter(t => t.pnl > 0);
    const losingTrades = trades.filter(t => t.pnl < 0);
    const winRate = trades.length > 0 ? winningTrades.length / trades.length : 0;

    const rMultiples = trades.map(t => t.pnlPercent / 5); // Assuming 5% stop loss
    const avgRMultiple =
      rMultiples.length > 0 ? rMultiples.reduce((sum, r) => sum + r, 0) / rMultiples.length : 0;

    const grossProfit = winningTrades.reduce((sum, t) => sum + t.pnl, 0);
    const grossLoss = Math.abs(losingTrades.reduce((sum, t) => sum + t.pnl, 0));
    const profitFactor = grossLoss > 0 ? grossProfit / grossLoss : grossProfit > 0 ? Infinity : 0;

    // Calculate Sharpe ratio (simplified)
    const returns = trades.map(t => t.pnlPercent / 100);
    const meanReturn = returns.length > 0 ? returns.reduce((a, b) => a + b, 0) / returns.length : 0;
    const variance =
      returns.length > 0
        ? returns.reduce((sum, r) => sum + Math.pow(r - meanReturn, 2), 0) / returns.length
        : 0;
    const stdDev = Math.sqrt(variance);
    const sharpeRatio = stdDev > 0 ? meanReturn / stdDev : 0;

    // Calculate total return (simplified)
    const totalReturn = trades.reduce((sum, t) => sum + t.pnlPercent, 0);

    variant.performance = {
      totalTrades: trades.length,
      winRate,
      avgRMultiple,
      profitFactor,
      sharpeRatio,
      totalReturn,
    };
    variant.lastUpdated = Date.now();

    this.variants.set(variantId, variant);
  }

  /**
   * Evaluate strategy variants and recommend best performer
   */
  evaluateStrategies(): StrategyEvolutionResult {
    const activeVariants = Array.from(this.variants.values()).filter(v => v.active);

    if (activeVariants.length === 0) {
      return {
        bestVariant: null,
        recommendedChange: null,
      };
    }

    // Filter variants with sufficient sample size
    const validVariants = activeVariants.filter(
      v => v.performance.totalTrades >= this.minTradesForEvolution
    );

    if (validVariants.length === 0) {
      return {
        bestVariant: null,
        recommendedChange: null,
      };
    }

    // Score variants based on multiple metrics
    const scoredVariants = validVariants.map(variant => {
      // Composite score: win rate (30%), R-multiple (30%), profit factor (20%), Sharpe (20%)
      const score =
        variant.performance.winRate * 0.3 +
        (variant.performance.avgRMultiple / 5) * 0.3 + // Normalize R-multiple
        Math.min(variant.performance.profitFactor / 3, 1) * 0.2 + // Cap profit factor at 3
        Math.max(0, Math.min(variant.performance.sharpeRatio / 2, 1)) * 0.2; // Normalize Sharpe

      return {
        variant,
        score,
      };
    });

    // Sort by score
    scoredVariants.sort((a, b) => b.score - a.score);
    const bestVariant = scoredVariants[0]?.variant || null;

    // Check if best variant is significantly better than current active variants
    const currentBest = scoredVariants[0];
    const secondBest = scoredVariants[1];

    let recommendedChange = null;
    if (currentBest && secondBest) {
      const scoreDifference = currentBest.score - secondBest.score;
      const improvementThreshold = 0.1; // 10% improvement threshold

      if (scoreDifference > improvementThreshold) {
        recommendedChange = {
          variant: currentBest.variant,
          reason: `Best performer: ${(scoreDifference * 100).toFixed(1)}% better than next best`,
          confidence: Math.min(1.0, scoreDifference * 2), // Confidence based on score difference
        };
      }
    }

    if (bestVariant) {
      this.logger.info(
        `Strategy evaluation complete: ${bestVariant.name} is best performer`,
        {
          bestVariant: bestVariant.id,
          score: scoredVariants[0]?.score.toFixed(3),
          performance: bestVariant.performance,
          recommendedChange: recommendedChange !== null,
        },
        this.context
      );
    }

    return {
      bestVariant,
      recommendedChange,
    };
  }

  /**
   * Get all variants
   */
  getVariants(): StrategyVariant[] {
    return Array.from(this.variants.values());
  }

  /**
   * Get best performing variant
   */
  getBestVariant(): StrategyVariant | null {
    const result = this.evaluateStrategies();
    return result.bestVariant;
  }
}

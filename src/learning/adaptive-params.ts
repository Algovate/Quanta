/**
 * Adaptive Parameter Adjustment
 * Learns optimal parameters from trade outcomes
 */

import type { CompletedTrade } from '../types/index.js';
import type { SymbolPerformanceTracker } from '../execution/symbol-performance.js';
import { UnifiedLogger } from '../logging/index.js';

export interface AdaptiveParams {
  stopLoss: number;
  leverage: number;
  confidenceThreshold: number;
  positionSizeMultiplier: number;
}

export interface LearningResult {
  params: AdaptiveParams;
  confidence: number; // 0-1, confidence in learned parameters
  sampleSize: number;
  performance: {
    winRate: number;
    avgRMultiple: number;
    profitFactor: number;
  };
}

/**
 * Adaptive Parameter Learner
 * Learns optimal parameters from historical trade outcomes
 */
export class AdaptiveParameterLearner {
  private logger: UnifiedLogger;
  private readonly context = 'AdaptiveParams';
  private minSampleSize: number = 10; // Minimum trades needed for learning

  constructor(private performanceTracker: SymbolPerformanceTracker) {
    this.logger = UnifiedLogger.getInstance();
  }

  /**
   * Learn optimal parameters for a symbol
   */
  learnOptimalParams(symbol: string, trades: CompletedTrade[]): LearningResult | null {
    if (trades.length < this.minSampleSize) {
      // Not enough data for learning
      return null;
    }

    // Get performance stats
    const stats = this.performanceTracker.getStats(symbol);
    if (!stats) {
      return null;
    }

    // Analyze trade outcomes
    const winningTrades = trades.filter(t => t.pnl > 0);
    const losingTrades = trades.filter(t => t.pnl < 0);
    const winRate = stats.winRate;
    const avgRMultiple = stats.avgRMultiple;
    const avgWinR = stats.avgWinR;
    const avgLossR = Math.abs(stats.avgLossR);

    // Calculate profit factor
    const grossProfit = winningTrades.reduce((sum, t) => sum + t.pnl, 0);
    const grossLoss = Math.abs(losingTrades.reduce((sum, t) => sum + t.pnl, 0));
    const profitFactor = grossLoss > 0 ? grossProfit / grossLoss : grossProfit > 0 ? Infinity : 0;

    // Learn optimal stop loss
    // If avg loss R is high, we need wider stops
    // If avg loss R is low, we can use tighter stops
    const baseStopLoss = 0.03; // 3% base
    const optimalStopLoss =
      avgLossR > 0
        ? Math.min(Math.max(baseStopLoss * (avgLossR / 1.0), 0.01), 0.1) // Between 1% and 10%
        : baseStopLoss;

    // Learn optimal leverage
    // Higher win rate and R-multiple = higher leverage
    // Lower win rate and R-multiple = lower leverage
    const baseLeverage = 5.0;
    let leverageMultiplier = 1.0;

    if (winRate > 0.6 && avgRMultiple > 1.0) {
      leverageMultiplier = 1.3; // Increase leverage for good performance
    } else if (winRate < 0.4 || avgRMultiple < 0.5) {
      leverageMultiplier = 0.7; // Decrease leverage for poor performance
    }

    const optimalLeverage = baseLeverage * leverageMultiplier;

    // Learn optimal confidence threshold
    // Higher win rate = lower threshold (more signals)
    // Lower win rate = higher threshold (fewer, better signals)
    const baseConfidence = 0.7;
    const confidenceAdjustment =
      winRate > 0.6
        ? -0.1 // Lower threshold for good performance
        : winRate < 0.4
          ? +0.1 // Higher threshold for poor performance
          : 0;

    const optimalConfidence = Math.max(0.5, Math.min(0.9, baseConfidence + confidenceAdjustment));

    // Learn position size multiplier
    // Based on Kelly Criterion: higher edge = larger positions
    const edge = winRate * avgWinR - (1 - winRate) * avgLossR;
    const positionSizeMultiplier =
      edge > 0
        ? Math.min(Math.max(1.0 + edge * 0.5, 0.5), 2.0) // Between 0.5x and 2.0x
        : 1.0;

    // Calculate confidence in learned parameters
    const sampleSizeConfidence = Math.min(1.0, trades.length / 30); // 30+ trades = full confidence
    const performanceConfidence = winRate > 0.5 ? 0.8 : 0.5; // Higher confidence if positive edge
    const confidence = sampleSizeConfidence * 0.6 + performanceConfidence * 0.4;

    const params: AdaptiveParams = {
      stopLoss: optimalStopLoss,
      leverage: optimalLeverage,
      confidenceThreshold: optimalConfidence,
      positionSizeMultiplier,
    };

    this.logger.info(
      `Learned optimal parameters for ${symbol}`,
      {
        symbol,
        sampleSize: trades.length,
        winRate: (winRate * 100).toFixed(1) + '%',
        avgRMultiple: avgRMultiple.toFixed(2),
        profitFactor: profitFactor.toFixed(2),
        optimalStopLoss: (optimalStopLoss * 100).toFixed(2) + '%',
        optimalLeverage: optimalLeverage.toFixed(1) + 'x',
        optimalConfidence: (optimalConfidence * 100).toFixed(1) + '%',
        positionSizeMultiplier: positionSizeMultiplier.toFixed(2) + 'x',
        confidence: (confidence * 100).toFixed(1) + '%',
      },
      this.context
    );

    return {
      params,
      confidence,
      sampleSize: trades.length,
      performance: {
        winRate,
        avgRMultiple,
        profitFactor,
      },
    };
  }

  /**
   * Get learned parameters for a symbol
   */
  getLearnedParams(symbol: string, trades: CompletedTrade[]): AdaptiveParams | null {
    const result = this.learnOptimalParams(symbol, trades);
    return result?.params || null;
  }
}

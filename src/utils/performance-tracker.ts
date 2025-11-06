/**
 * Performance Tracker Utility
 * Tracks and reports performance improvements
 */

import { UnifiedLogger } from '../logging/index.js';
import type { CompletedTrade } from '../types/index.js';
import type { Account } from '../exchange/types.js';

export interface PerformanceSnapshot {
  timestamp: number;
  metrics: {
    totalTrades: number;
    winRate: number;
    avgRMultiple: number;
    profitFactor: number;
    sharpeRatio: number;
    maxDrawdown: number;
    totalReturn: number;
  };
  improvements: {
    winRateChange: number;
    rMultipleChange: number;
    profitFactorChange: number;
    drawdownChange: number;
  };
}

/**
 * Performance Tracker
 * Tracks performance improvements over time
 */
export class PerformanceTracker {
  private logger: UnifiedLogger;
  private readonly context = 'PerformanceTracker';
  private snapshots: PerformanceSnapshot[] = [];
  private baseline: PerformanceSnapshot | null = null;

  constructor() {
    this.logger = UnifiedLogger.getInstance();
  }

  /**
   * Set baseline performance
   */
  setBaseline(snapshot: PerformanceSnapshot): void {
    this.baseline = snapshot;
    this.logger.info(
      'Performance baseline set',
      {
        timestamp: snapshot.timestamp,
        winRate: snapshot.metrics.winRate,
        avgRMultiple: snapshot.metrics.avgRMultiple,
        profitFactor: snapshot.metrics.profitFactor,
      },
      this.context
    );
  }

  /**
   * Record performance snapshot
   */
  recordSnapshot(trades: CompletedTrade[], account: Account): PerformanceSnapshot {
    const metrics = this.calculateMetrics(trades, account);
    const improvements = this.baseline
      ? this.calculateImprovements(metrics, this.baseline.metrics)
      : {
          winRateChange: 0,
          rMultipleChange: 0,
          profitFactorChange: 0,
          drawdownChange: 0,
        };

    const snapshot: PerformanceSnapshot = {
      timestamp: Date.now(),
      metrics,
      improvements,
    };

    this.snapshots.push(snapshot);

    // Keep only last 100 snapshots
    if (this.snapshots.length > 100) {
      this.snapshots.shift();
    }

    // Log improvements if significant
    if (this.baseline && this.hasSignificantImprovements(improvements)) {
      this.logger.info(
        'Performance improvements detected',
        {
          winRateChange: (improvements.winRateChange * 100).toFixed(1) + '%',
          rMultipleChange: (improvements.rMultipleChange * 100).toFixed(1) + '%',
          profitFactorChange: (improvements.profitFactorChange * 100).toFixed(1) + '%',
          drawdownChange: (improvements.drawdownChange * 100).toFixed(1) + '%',
        },
        this.context
      );
    }

    return snapshot;
  }

  /**
   * Calculate performance metrics
   */
  private calculateMetrics(trades: CompletedTrade[], account: Account) {
    if (trades.length === 0) {
      return {
        totalTrades: 0,
        winRate: 0,
        avgRMultiple: 0,
        profitFactor: 0,
        sharpeRatio: 0,
        maxDrawdown: 0,
        totalReturn: 0,
      };
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

    // Calculate Sharpe ratio
    const returns = trades.map(t => t.pnlPercent / 100);
    const meanReturn = returns.length > 0 ? returns.reduce((a, b) => a + b, 0) / returns.length : 0;
    const variance =
      returns.length > 0
        ? returns.reduce((sum, r) => sum + Math.pow(r - meanReturn, 2), 0) / returns.length
        : 0;
    const stdDev = Math.sqrt(variance);
    const sharpeRatio = stdDev > 0 ? meanReturn / stdDev : 0;

    // Calculate max drawdown
    let maxDrawdown = 0;
    let peakEquity = account.equity;
    let runningEquity = account.equity;

    for (const trade of trades) {
      runningEquity += trade.pnl;
      if (runningEquity > peakEquity) {
        peakEquity = runningEquity;
      }
      const drawdown = peakEquity > 0 ? ((peakEquity - runningEquity) / peakEquity) * 100 : 0;
      if (drawdown > maxDrawdown) {
        maxDrawdown = drawdown;
      }
    }

    const totalReturn =
      account.equity > 0 ? ((account.equity - account.balance) / account.balance) * 100 : 0;

    return {
      totalTrades: trades.length,
      winRate,
      avgRMultiple,
      profitFactor,
      sharpeRatio,
      maxDrawdown,
      totalReturn,
    };
  }

  /**
   * Calculate improvements vs baseline
   */
  private calculateImprovements(
    current: PerformanceSnapshot['metrics'],
    baseline: PerformanceSnapshot['metrics']
  ): PerformanceSnapshot['improvements'] {
    return {
      winRateChange: current.winRate - baseline.winRate,
      rMultipleChange: current.avgRMultiple - baseline.avgRMultiple,
      profitFactorChange: current.profitFactor - baseline.profitFactor,
      drawdownChange: baseline.maxDrawdown - current.maxDrawdown, // Negative is better
    };
  }

  /**
   * Check if improvements are significant
   */
  private hasSignificantImprovements(improvements: PerformanceSnapshot['improvements']): boolean {
    return (
      Math.abs(improvements.winRateChange) > 0.05 || // 5% change
      Math.abs(improvements.rMultipleChange) > 0.1 || // 0.1 R-multiple change
      Math.abs(improvements.profitFactorChange) > 0.2 || // 0.2 profit factor change
      improvements.drawdownChange > 5 // 5% drawdown reduction
    );
  }

  /**
   * Get performance trend
   */
  getTrend(windowSize: number = 10): {
    winRateTrend: number[];
    rMultipleTrend: number[];
    profitFactorTrend: number[];
    drawdownTrend: number[];
  } {
    const recent = this.snapshots.slice(-windowSize);

    return {
      winRateTrend: recent.map(s => s.metrics.winRate),
      rMultipleTrend: recent.map(s => s.metrics.avgRMultiple),
      profitFactorTrend: recent.map(s => s.metrics.profitFactor),
      drawdownTrend: recent.map(s => s.metrics.maxDrawdown),
    };
  }

  /**
   * Get latest snapshot
   */
  getLatestSnapshot(): PerformanceSnapshot | null {
    return this.snapshots.length > 0 ? this.snapshots[this.snapshots.length - 1] : null;
  }

  /**
   * Get all snapshots
   */
  getAllSnapshots(): PerformanceSnapshot[] {
    return [...this.snapshots];
  }
}

/**
 * Advanced Analytics & Feedback Loop
 * Continuous learning from trade outcomes
 */

import type { CompletedTrade } from '../types/index.js';
import type { Account } from '../exchange/types.js';
import type { AdaptiveParameterLearner } from '../learning/adaptive-params.js';
import type { StrategyEvolutionManager } from '../learning/strategy-evolution.js';

export interface PerformanceReport {
  period: {
    start: number;
    end: number;
    duration: number;
  };
  metrics: {
    totalTrades: number;
    winningTrades: number;
    losingTrades: number;
    winRate: number;
    totalPnl: number;
    totalReturn: number;
    avgRMultiple: number;
    profitFactor: number;
    sharpeRatio: number;
    maxDrawdown: number;
    avgWin: number;
    avgLoss: number;
    bestTrade: number;
    worstTrade: number;
  };
  bySymbol: Map<
    string,
    {
      trades: number;
      winRate: number;
      avgRMultiple: number;
      totalPnl: number;
    }
  >;
  recommendations: {
    parameterAdjustments: Array<{
      symbol: string;
      parameter: string;
      currentValue: number;
      recommendedValue: number;
      reason: string;
    }>;
    strategyChanges: Array<{
      strategy: string;
      action: 'increase_weight' | 'decrease_weight' | 'disable' | 'enable';
      reason: string;
    }>;
  };
}

/**
 * Advanced Analytics Engine
 * Performs comprehensive analysis and generates feedback
 */
export class AdvancedAnalyticsEngine {
  private tradeHistory: CompletedTrade[] = [];
  private performanceHistory: PerformanceReport[] = [];

  constructor(
    private adaptiveLearner: AdaptiveParameterLearner,
    private strategyEvolution: StrategyEvolutionManager
  ) {
    // No logger needed - using adaptiveLearner and strategyEvolution loggers
  }

  /**
   * Record a completed trade
   */
  recordTrade(trade: CompletedTrade): void {
    this.tradeHistory.push(trade);

    // Keep only last 1000 trades in memory
    if (this.tradeHistory.length > 1000) {
      this.tradeHistory.shift();
    }
  }

  /**
   * Generate comprehensive performance report
   */
  generatePerformanceReport(
    account: Account,
    startTime: number,
    endTime: number = Date.now()
  ): PerformanceReport {
    const periodTrades = this.tradeHistory.filter(
      t => t.entryTime >= startTime && t.exitTime <= endTime
    );

    if (periodTrades.length === 0) {
      return this.createEmptyReport(startTime, endTime);
    }

    const winningTrades = periodTrades.filter(t => t.pnl > 0);
    const losingTrades = periodTrades.filter(t => t.pnl < 0);
    const winRate = periodTrades.length > 0 ? winningTrades.length / periodTrades.length : 0;

    // Calculate R-multiples (assuming 5% stop loss)
    const rMultiples = periodTrades.map(t => t.pnlPercent / 5);
    const avgRMultiple =
      rMultiples.length > 0 ? rMultiples.reduce((sum, r) => sum + r, 0) / rMultiples.length : 0;

    // Calculate profit factor
    const grossProfit = winningTrades.reduce((sum, t) => sum + t.pnl, 0);
    const grossLoss = Math.abs(losingTrades.reduce((sum, t) => sum + t.pnl, 0));
    const profitFactor = grossLoss > 0 ? grossProfit / grossLoss : grossProfit > 0 ? Infinity : 0;

    // Calculate Sharpe ratio
    const returns = periodTrades.map(t => t.pnlPercent / 100);
    const meanReturn = returns.length > 0 ? returns.reduce((a, b) => a + b, 0) / returns.length : 0;
    const variance =
      returns.length > 0
        ? returns.reduce((sum, r) => sum + Math.pow(r - meanReturn, 2), 0) / returns.length
        : 0;
    const stdDev = Math.sqrt(variance);
    const sharpeRatio = stdDev > 0 ? meanReturn / stdDev : 0;

    // Calculate max drawdown (simplified)
    let maxDrawdown = 0;
    let peakEquity = account.equity;
    let runningEquity = account.equity;

    for (const trade of periodTrades) {
      runningEquity += trade.pnl;
      if (runningEquity > peakEquity) {
        peakEquity = runningEquity;
      }
      const drawdown = peakEquity > 0 ? ((peakEquity - runningEquity) / peakEquity) * 100 : 0;
      if (drawdown > maxDrawdown) {
        maxDrawdown = drawdown;
      }
    }

    const avgWin =
      winningTrades.length > 0
        ? winningTrades.reduce((sum, t) => sum + t.pnl, 0) / winningTrades.length
        : 0;

    const avgLoss =
      losingTrades.length > 0
        ? losingTrades.reduce((sum, t) => sum + t.pnl, 0) / losingTrades.length
        : 0;

    const bestTrade = periodTrades.length > 0 ? Math.max(...periodTrades.map(t => t.pnl)) : 0;

    const worstTrade = periodTrades.length > 0 ? Math.min(...periodTrades.map(t => t.pnl)) : 0;

    const totalPnl = periodTrades.reduce((sum, t) => sum + t.pnl, 0);
    const totalReturn = account.equity > 0 ? (totalPnl / account.balance) * 100 : 0;

    // Analyze by symbol
    const bySymbol = new Map<
      string,
      {
        trades: number;
        winRate: number;
        avgRMultiple: number;
        totalPnl: number;
      }
    >();

    const tradesBySymbol = new Map<string, CompletedTrade[]>();
    for (const trade of periodTrades) {
      const symbol = trade.symbol.replace('/USDT', '');
      if (!tradesBySymbol.has(symbol)) {
        tradesBySymbol.set(symbol, []);
      }
      tradesBySymbol.get(symbol)!.push(trade);
    }

    for (const [symbol, trades] of tradesBySymbol.entries()) {
      const symbolWins = trades.filter(t => t.pnl > 0).length;
      const symbolWinRate = trades.length > 0 ? symbolWins / trades.length : 0;
      const symbolRMultiples = trades.map(t => t.pnlPercent / 5);
      const symbolAvgR =
        symbolRMultiples.length > 0
          ? symbolRMultiples.reduce((sum, r) => sum + r, 0) / symbolRMultiples.length
          : 0;
      const symbolPnl = trades.reduce((sum, t) => sum + t.pnl, 0);

      bySymbol.set(symbol, {
        trades: trades.length,
        winRate: symbolWinRate,
        avgRMultiple: symbolAvgR,
        totalPnl: symbolPnl,
      });
    }

    // Generate recommendations
    const recommendations = this.generateRecommendations(periodTrades, bySymbol);

    const report: PerformanceReport = {
      period: {
        start: startTime,
        end: endTime,
        duration: endTime - startTime,
      },
      metrics: {
        totalTrades: periodTrades.length,
        winningTrades: winningTrades.length,
        losingTrades: losingTrades.length,
        winRate,
        totalPnl,
        totalReturn,
        avgRMultiple,
        profitFactor,
        sharpeRatio,
        maxDrawdown,
        avgWin,
        avgLoss,
        bestTrade,
        worstTrade,
      },
      bySymbol,
      recommendations,
    };

    // Store report in history
    this.performanceHistory.push(report);
    if (this.performanceHistory.length > 50) {
      this.performanceHistory.shift();
    }

    return report;
  }

  /**
   * Generate recommendations based on performance
   */
  private generateRecommendations(
    trades: CompletedTrade[],
    bySymbol: Map<
      string,
      { trades: number; winRate: number; avgRMultiple: number; totalPnl: number }
    >
  ): PerformanceReport['recommendations'] {
    const parameterAdjustments: PerformanceReport['recommendations']['parameterAdjustments'] = [];
    const strategyChanges: PerformanceReport['recommendations']['strategyChanges'] = [];

    // Analyze symbol performance for parameter adjustments
    for (const [symbol, stats] of bySymbol.entries()) {
      if (stats.trades >= 10) {
        // Learn optimal parameters for this symbol
        const symbolTrades = trades.filter(t => t.symbol.replace('/USDT', '') === symbol);
        const learnedParams = this.adaptiveLearner.getLearnedParams(symbol, symbolTrades);

        if (learnedParams) {
          // Recommend stop loss adjustment
          if (learnedParams.stopLoss !== 0.03) {
            parameterAdjustments.push({
              symbol,
              parameter: 'stopLoss',
              currentValue: 0.03,
              recommendedValue: learnedParams.stopLoss,
              reason: `Optimal stop loss based on ${stats.trades} trades: ${(learnedParams.stopLoss * 100).toFixed(1)}%`,
            });
          }

          // Recommend leverage adjustment
          if (learnedParams.leverage !== 5.0) {
            parameterAdjustments.push({
              symbol,
              parameter: 'leverage',
              currentValue: 5.0,
              recommendedValue: learnedParams.leverage,
              reason: `Optimal leverage based on performance: ${learnedParams.leverage.toFixed(1)}x`,
            });
          }

          // Recommend confidence threshold adjustment
          if (learnedParams.confidenceThreshold !== 0.7) {
            parameterAdjustments.push({
              symbol,
              parameter: 'confidenceThreshold',
              currentValue: 0.7,
              recommendedValue: learnedParams.confidenceThreshold,
              reason: `Optimal confidence threshold: ${(learnedParams.confidenceThreshold * 100).toFixed(1)}%`,
            });
          }
        }
      }
    }

    // Analyze strategy performance
    const evolutionResult = this.strategyEvolution.evaluateStrategies();
    if (evolutionResult.recommendedChange) {
      strategyChanges.push({
        strategy: evolutionResult.recommendedChange.variant.name,
        action: 'increase_weight',
        reason: evolutionResult.recommendedChange.reason,
      });
    }

    return {
      parameterAdjustments,
      strategyChanges,
    };
  }

  /**
   * Create empty report
   */
  private createEmptyReport(startTime: number, endTime: number): PerformanceReport {
    return {
      period: {
        start: startTime,
        end: endTime,
        duration: endTime - startTime,
      },
      metrics: {
        totalTrades: 0,
        winningTrades: 0,
        losingTrades: 0,
        winRate: 0,
        totalPnl: 0,
        totalReturn: 0,
        avgRMultiple: 0,
        profitFactor: 0,
        sharpeRatio: 0,
        maxDrawdown: 0,
        avgWin: 0,
        avgLoss: 0,
        bestTrade: 0,
        worstTrade: 0,
      },
      bySymbol: new Map(),
      recommendations: {
        parameterAdjustments: [],
        strategyChanges: [],
      },
    };
  }

  /**
   * Get performance trends over time
   */
  getPerformanceTrends(windowSize: number = 10): {
    winRateTrend: number[];
    rMultipleTrend: number[];
    profitFactorTrend: number[];
  } {
    const recentReports = this.performanceHistory.slice(-windowSize);

    return {
      winRateTrend: recentReports.map(r => r.metrics.winRate),
      rMultipleTrend: recentReports.map(r => r.metrics.avgRMultiple),
      profitFactorTrend: recentReports.map(r => r.metrics.profitFactor),
    };
  }
}

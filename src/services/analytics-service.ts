/**
 * Analytics Service Implementation
 * Business logic for performance analytics
 */

import type { AnalyticsService, PerformanceMetrics } from './interfaces/analytics-service.js';
import type { CompletedTrade } from '../types/index.js';
import type { Account } from '../exchange/types.js';

export class AnalyticsServiceImpl implements AnalyticsService {
  calculateMetrics(trades: CompletedTrade[], account: Account): PerformanceMetrics {
    if (trades.length === 0) {
      return {
        totalReturn: 0,
        sharpeRatio: 0,
        maxDrawdown: 0,
        winRate: 0,
        profitFactor: 0,
        avgRMultiple: 0,
      };
    }

    const winningTrades = trades.filter(t => t.pnl > 0);
    const losingTrades = trades.filter(t => t.pnl < 0);
    const winRate = trades.length > 0 ? winningTrades.length / trades.length : 0;

    const grossProfit = winningTrades.reduce((sum, t) => sum + t.pnl, 0);
    const grossLoss = Math.abs(losingTrades.reduce((sum, t) => sum + t.pnl, 0));
    const profitFactor = grossLoss > 0 ? grossProfit / grossLoss : grossProfit > 0 ? Infinity : 0;

    // Calculate R-multiples (assuming 5% stop loss)
    const rMultiples = trades.map(t => t.pnlPercent / 5);
    const avgRMultiple =
      rMultiples.length > 0 ? rMultiples.reduce((sum, r) => sum + r, 0) / rMultiples.length : 0;

    // Calculate Sharpe ratio (simplified)
    const returns = trades.map(t => t.pnlPercent / 100);
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
      totalReturn,
      sharpeRatio,
      maxDrawdown,
      winRate,
      profitFactor,
      avgRMultiple,
    };
  }

  analyzeTradeOutcomes(trades: CompletedTrade[]): {
    winningTrades: CompletedTrade[];
    losingTrades: CompletedTrade[];
    avgWin: number;
    avgLoss: number;
    bestTrade: CompletedTrade | null;
    worstTrade: CompletedTrade | null;
  } {
    const winningTrades = trades.filter(t => t.pnl > 0);
    const losingTrades = trades.filter(t => t.pnl < 0);

    const avgWin =
      winningTrades.length > 0
        ? winningTrades.reduce((sum, t) => sum + t.pnl, 0) / winningTrades.length
        : 0;

    const avgLoss =
      losingTrades.length > 0
        ? losingTrades.reduce((sum, t) => sum + t.pnl, 0) / losingTrades.length
        : 0;

    const bestTrade =
      trades.length > 0
        ? trades.reduce((best, t) => (t.pnl > best.pnl ? t : best), trades[0])
        : null;

    const worstTrade =
      trades.length > 0
        ? trades.reduce((worst, t) => (t.pnl < worst.pnl ? t : worst), trades[0])
        : null;

    return {
      winningTrades,
      losingTrades,
      avgWin,
      avgLoss,
      bestTrade,
      worstTrade,
    };
  }

  calculateRMultiples(trades: CompletedTrade[]): {
    avgRMultiple: number;
    positiveRMultiples: number[];
    negativeRMultiples: number[];
    distribution: Map<number, number>;
  } {
    // Assuming 5% stop loss for R-multiple calculation
    const rMultiples = trades.map(t => t.pnlPercent / 5);
    const avgRMultiple =
      rMultiples.length > 0 ? rMultiples.reduce((sum, r) => sum + r, 0) / rMultiples.length : 0;

    const positiveRMultiples = rMultiples.filter(r => r > 0);
    const negativeRMultiples = rMultiples.filter(r => r < 0);

    // Create distribution buckets
    const distribution = new Map<number, number>();
    for (const r of rMultiples) {
      const bucket = Math.floor(r);
      distribution.set(bucket, (distribution.get(bucket) || 0) + 1);
    }

    return {
      avgRMultiple,
      positiveRMultiples,
      negativeRMultiples,
      distribution,
    };
  }
}

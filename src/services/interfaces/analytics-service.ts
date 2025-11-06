/**
 * Analytics Service Interface
 * Business logic for performance analytics
 */

import type { CompletedTrade } from '../../types/index.js';
import type { Account } from '../../exchange/types.js';

export interface PerformanceMetrics {
  totalReturn: number;
  sharpeRatio: number;
  maxDrawdown: number;
  winRate: number;
  profitFactor: number;
  avgRMultiple: number;
}

export interface AnalyticsService {
  /**
   * Calculate performance metrics from trades
   */
  calculateMetrics(trades: CompletedTrade[], account: Account): PerformanceMetrics;

  /**
   * Analyze trade outcomes
   */
  analyzeTradeOutcomes(trades: CompletedTrade[]): {
    winningTrades: CompletedTrade[];
    losingTrades: CompletedTrade[];
    avgWin: number;
    avgLoss: number;
    bestTrade: CompletedTrade | null;
    worstTrade: CompletedTrade | null;
  };

  /**
   * Calculate R-multiples distribution
   */
  calculateRMultiples(trades: CompletedTrade[]): {
    avgRMultiple: number;
    positiveRMultiples: number[];
    negativeRMultiples: number[];
    distribution: Map<number, number>;
  };
}

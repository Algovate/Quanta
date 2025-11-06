/**
 * Base Strategy Interface
 * Strategy pattern for trading strategies
 */

import type { TradingSignal, MarketData } from '../types/index.js';
import type { Account, Position } from '../exchange/types.js';

export interface StrategyConfig {
  name: string;
  description: string;
  enabled: boolean;
  params: Record<string, any>;
}

export interface StrategyContext {
  account: Account;
  positions: Position[];
  marketData: MarketData[];
  cycleCount: number;
  timestamp: number;
}

export interface StrategyResult {
  signals: TradingSignal[];
  metadata: {
    strategy: string;
    confidence: number;
    reasoning: string;
  };
}

/**
 * Base Strategy Interface
 * All trading strategies must implement this interface
 */
export interface IStrategy {
  /**
   * Get strategy configuration
   */
  getConfig(): StrategyConfig;

  /**
   * Generate trading signals
   */
  generateSignals(context: StrategyContext): Promise<StrategyResult>;

  /**
   * Validate strategy configuration
   */
  validateConfig(config: StrategyConfig): boolean;

  /**
   * Update strategy parameters
   */
  updateParams(params: Record<string, any>): void;

  /**
   * Get strategy performance metrics
   */
  getPerformance(): {
    totalSignals: number;
    winRate: number;
    avgRMultiple: number;
    profitFactor: number;
  };
}

/**
 * Base Strategy Implementation
 * Provides common functionality for strategies
 */
export abstract class BaseStrategy implements IStrategy {
  protected config: StrategyConfig;
  protected performance: {
    totalSignals: number;
    winningSignals: number;
    totalRMultiple: number;
    totalProfitFactor: number;
  } = {
    totalSignals: 0,
    winningSignals: 0,
    totalRMultiple: 0,
    totalProfitFactor: 0,
  };

  constructor(config: StrategyConfig) {
    this.config = config;
  }

  getConfig(): StrategyConfig {
    return { ...this.config };
  }

  abstract generateSignals(context: StrategyContext): Promise<StrategyResult>;

  validateConfig(config: StrategyConfig): boolean {
    return config.name !== undefined && config.name.length > 0;
  }

  updateParams(params: Record<string, any>): void {
    this.config.params = { ...this.config.params, ...params };
  }

  getPerformance(): {
    totalSignals: number;
    winRate: number;
    avgRMultiple: number;
    profitFactor: number;
  } {
    const winRate =
      this.performance.totalSignals > 0
        ? this.performance.winningSignals / this.performance.totalSignals
        : 0;

    const avgRMultiple =
      this.performance.totalSignals > 0
        ? this.performance.totalRMultiple / this.performance.totalSignals
        : 0;

    const profitFactor =
      this.performance.totalSignals > 0
        ? this.performance.totalProfitFactor / this.performance.totalSignals
        : 0;

    return {
      totalSignals: this.performance.totalSignals,
      winRate,
      avgRMultiple,
      profitFactor,
    };
  }

  /**
   * Update performance metrics
   */
  protected updatePerformance(
    _signal: TradingSignal,
    outcome?: { pnl: number; rMultiple: number }
  ): void {
    this.performance.totalSignals++;

    if (outcome) {
      if (outcome.pnl > 0) {
        this.performance.winningSignals++;
      }
      this.performance.totalRMultiple += outcome.rMultiple;

      // Simplified profit factor calculation
      const profitFactor = outcome.pnl > 0 ? 2.0 : 0.5;
      this.performance.totalProfitFactor += profitFactor;
    }
  }
}

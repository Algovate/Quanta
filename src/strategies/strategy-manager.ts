/**
 * Strategy Manager
 * Manages multiple trading strategies
 */

import type { IStrategy, StrategyContext, StrategyResult } from './base-strategy.js';
import { UnifiedLogger } from '../logging/index.js';

export interface StrategyManagerConfig {
  defaultStrategy?: string;
  enableStrategySelection?: boolean;
  strategyWeights?: Map<string, number>;
}

/**
 * Strategy Manager
 * Orchestrates multiple strategies and combines their signals
 */
export class StrategyManager {
  private logger: UnifiedLogger;
  private readonly context = 'StrategyManager';
  private strategies: Map<string, IStrategy> = new Map();
  private config: StrategyManagerConfig;

  constructor(config: StrategyManagerConfig = {}) {
    this.logger = UnifiedLogger.getInstance();
    this.config = {
      enableStrategySelection: true,
      ...config,
    };
  }

  /**
   * Register a strategy
   */
  registerStrategy(strategy: IStrategy): void {
    const config = strategy.getConfig();
    if (!strategy.validateConfig(config)) {
      throw new Error(`Invalid strategy configuration: ${config.name}`);
    }

    this.strategies.set(config.name, strategy);
    this.logger.info(
      `Registered strategy: ${config.name}`,
      {
        strategy: config.name,
        description: config.description,
        enabled: config.enabled,
      },
      this.context
    );
  }

  /**
   * Unregister a strategy
   */
  unregisterStrategy(strategyName: string): boolean {
    const removed = this.strategies.delete(strategyName);
    if (removed) {
      this.logger.info(`Unregistered strategy: ${strategyName}`, {}, this.context);
    }
    return removed;
  }

  /**
   * Get all registered strategies
   */
  getStrategies(): IStrategy[] {
    return Array.from(this.strategies.values());
  }

  /**
   * Get a specific strategy
   */
  getStrategy(strategyName: string): IStrategy | undefined {
    return this.strategies.get(strategyName);
  }

  /**
   * Generate signals from all enabled strategies
   */
  async generateSignals(context: StrategyContext): Promise<StrategyResult[]> {
    const enabledStrategies = Array.from(this.strategies.values()).filter(
      s => s.getConfig().enabled
    );

    if (enabledStrategies.length === 0) {
      this.logger.warn('No enabled strategies found', {}, this.context);
      return [];
    }

    const results: StrategyResult[] = [];

    // Generate signals from each strategy in parallel
    const strategyPromises = enabledStrategies.map(async strategy => {
      try {
        const result = await strategy.generateSignals(context);
        return result;
      } catch (error) {
        this.logger.error(
          `Strategy ${strategy.getConfig().name} failed`,
          error instanceof Error ? error : new Error(String(error)),
          this.context
        );
        return null;
      }
    });

    const strategyResults = await Promise.all(strategyPromises);

    // Filter out null results and collect
    for (const result of strategyResults) {
      if (result) {
        results.push(result);
      }
    }

    return results;
  }

  /**
   * Combine signals from multiple strategies
   */
  combineSignals(strategyResults: StrategyResult[]): StrategyResult {
    if (strategyResults.length === 0) {
      return {
        signals: [],
        metadata: {
          strategy: 'combined',
          confidence: 0,
          reasoning: 'No strategy results',
        },
      };
    }

    // Combine all signals
    const allSignals = strategyResults.flatMap(result => result.signals);

    // Weight signals by strategy confidence and weight
    const weightedSignals = allSignals.map(signal => {
      const strategyResult = strategyResults.find(r => r.signals.includes(signal));
      const strategyWeight = strategyResult
        ? this.config.strategyWeights?.get(strategyResult.metadata.strategy) || 1.0
        : 1.0;

      const weightedConfidence = signal.confidence * strategyWeight;

      return {
        ...signal,
        confidence: Math.min(1.0, weightedConfidence),
      };
    });

    // Average confidence across all strategies
    const avgConfidence =
      strategyResults.length > 0
        ? strategyResults.reduce((sum, r) => sum + r.metadata.confidence, 0) /
          strategyResults.length
        : 0;

    return {
      signals: weightedSignals,
      metadata: {
        strategy: 'combined',
        confidence: avgConfidence,
        reasoning: `Combined signals from ${strategyResults.length} strategies`,
      },
    };
  }

  /**
   * Get strategy performance summary
   */
  getPerformanceSummary(): Array<{
    strategy: string;
    performance: {
      totalSignals: number;
      winRate: number;
      avgRMultiple: number;
      profitFactor: number;
    };
  }> {
    return Array.from(this.strategies.values()).map(strategy => ({
      strategy: strategy.getConfig().name,
      performance: strategy.getPerformance(),
    }));
  }
}

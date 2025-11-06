/**
 * Ensemble Signal System
 * Combines multiple signal sources for improved accuracy
 */

import type { TradingSignal, MarketData } from '../types/index.js';
import type { Account, Position } from '../exchange/types.js';
import type { OpenRouterClient } from './agent.js';
import { UnifiedLogger } from '../logging/index.js';

export interface SignalSource {
  name: string;
  weight: number; // 0-1, contribution to final signal
  generateSignal(
    marketData: MarketData[],
    account: Account,
    positions: Position[]
  ): Promise<TradingSignal[]>;
}

export interface EnsembleSignalResult {
  signals: TradingSignal[];
  sourceContributions: Map<string, TradingSignal[]>;
  aggregatedConfidence: Map<string, number>;
}

/**
 * Ensemble Signal Aggregator
 * Combines signals from multiple sources
 */
export class EnsembleSignalAggregator {
  private logger: UnifiedLogger;
  private readonly context = 'EnsembleSignal';
  private sources: SignalSource[] = [];

  constructor() {
    this.logger = UnifiedLogger.getInstance();
  }

  /**
   * Add a signal source
   */
  addSource(source: SignalSource): void {
    this.sources.push(source);
    this.logger.debug(
      `Added signal source: ${source.name} (weight: ${source.weight})`,
      {},
      this.context
    );
  }

  /**
   * Generate ensemble signals from all sources
   */
  async generateEnsembleSignals(
    marketData: MarketData[],
    account: Account,
    positions: Position[]
  ): Promise<EnsembleSignalResult> {
    const sourceContributions = new Map<string, TradingSignal[]>();
    const aggregatedSignals = new Map<
      string,
      {
        coin: string;
        signals: TradingSignal[];
        totalWeight: number;
      }
    >();

    // Generate signals from all sources
    for (const source of this.sources) {
      try {
        const signals = await source.generateSignal(marketData, account, positions);
        sourceContributions.set(source.name, signals);

        // Aggregate signals by coin
        for (const signal of signals) {
          if (!aggregatedSignals.has(signal.coin)) {
            aggregatedSignals.set(signal.coin, {
              coin: signal.coin,
              signals: [],
              totalWeight: 0,
            });
          }

          const aggregated = aggregatedSignals.get(signal.coin)!;
          aggregated.signals.push(signal);
          aggregated.totalWeight += source.weight;
        }
      } catch (error) {
        this.logger.warn(
          `Signal source ${source.name} failed`,
          { error: error instanceof Error ? error.message : String(error) },
          this.context
        );
        // Continue with other sources
      }
    }

    // Combine signals for each coin
    const finalSignals: TradingSignal[] = [];
    const aggregatedConfidence = new Map<string, number>();

    for (const [coin, aggregated] of aggregatedSignals.entries()) {
      // Aggregate signals for this coin
      const combinedSignal = this.combineSignalsForCoin(aggregated.signals, aggregated.totalWeight);

      if (combinedSignal) {
        finalSignals.push(combinedSignal);
        aggregatedConfidence.set(coin, combinedSignal.confidence);
      }
    }

    return {
      signals: finalSignals,
      sourceContributions,
      aggregatedConfidence,
    };
  }

  /**
   * Combine multiple signals for a single coin into one signal
   */
  private combineSignalsForCoin(
    signals: TradingSignal[],
    _totalWeight: number
  ): TradingSignal | null {
    if (signals.length === 0) {
      return null;
    }

    if (signals.length === 1) {
      return signals[0];
    }

    // Group signals by action
    const byAction = new Map<string, TradingSignal[]>();
    for (const signal of signals) {
      if (!byAction.has(signal.action)) {
        byAction.set(signal.action, []);
      }
      byAction.get(signal.action)!.push(signal);
    }

    // Find the action with highest weighted confidence
    let bestAction = '';
    let bestWeightedConfidence = 0;
    let bestSignals: TradingSignal[] = [];

    for (const [action, actionSignals] of byAction.entries()) {
      // Calculate weighted average confidence
      let weightedConfidence = 0;
      let totalWeightForAction = 0;

      for (const signal of actionSignals) {
        // Estimate weight from source (simplified - would need source tracking)
        const estimatedWeight = 1.0 / signals.length; // Equal weight for now
        weightedConfidence += signal.confidence * estimatedWeight;
        totalWeightForAction += estimatedWeight;
      }

      const avgConfidence =
        totalWeightForAction > 0 ? weightedConfidence / totalWeightForAction : 0;

      if (avgConfidence > bestWeightedConfidence) {
        bestWeightedConfidence = avgConfidence;
        bestAction = action;
        bestSignals = actionSignals;
      }
    }

    if (bestSignals.length === 0) {
      return null;
    }

    // Combine best signals into one
    const firstSignal = bestSignals[0];

    // Average entry price, position size, stop loss, profit target
    const avgEntryPrice =
      bestSignals.reduce((sum, s) => sum + (s.entry_price || 0), 0) / bestSignals.length;
    const avgPositionSize =
      bestSignals.reduce((sum, s) => sum + (s.position_size || 0), 0) / bestSignals.length;
    const avgStopLoss =
      bestSignals.reduce((sum, s) => sum + (s.stop_loss || 0), 0) / bestSignals.length;
    const avgProfitTarget =
      bestSignals.reduce((sum, s) => sum + (s.profit_target || 0), 0) / bestSignals.length;
    // Leverage is not part of TradingSignal, remove this calculation

    // Combine reasoning
    const combinedReasoning = bestSignals
      .map(s => s.reasoning)
      .filter(Boolean)
      .join('; ');

    return {
      coin: firstSignal.coin,
      action: bestAction as TradingSignal['action'],
      confidence: bestWeightedConfidence,
      reasoning: combinedReasoning || firstSignal.reasoning,
      entry_price: avgEntryPrice || undefined,
      position_size: avgPositionSize || undefined,
      stop_loss: avgStopLoss || undefined,
      profit_target: avgProfitTarget || undefined,
      invalidation_condition: firstSignal.invalidation_condition,
    };
  }
}

/**
 * AI Signal Source
 * Wraps existing AI agent as a signal source
 */
export class AISignalSource implements SignalSource {
  constructor(
    public name: string,
    public weight: number,
    private aiAgent: OpenRouterClient
  ) {}

  async generateSignal(
    marketData: MarketData[],
    account: Account,
    positions: Position[]
  ): Promise<TradingSignal[]> {
    const context = {
      startTime: Date.now(),
      currentTime: Date.now(),
      invokeCount: 0,
      tradableCoins: Array.from(new Set(marketData.map(md => md.coin))),
      maxPositions: 6,
      maxRiskPerTrade: 0.05,
      maxLeverage: 40,
      minLeverage: 5,
      defaultStopLoss: 0.05,
      promptOptions: {
        candles3m: 10,
        candles4h: 5,
        sections: {
          candlesTA: true,
          sentiment: true,
          technicalState: true,
        },
      },
    } as any;

    // Cast to MarketData from data/market.ts (has additional indicator fields)
    return await this.aiAgent.generateTradingSignal(marketData as any, account, positions, context);
  }
}

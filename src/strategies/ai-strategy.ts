/**
 * AI Strategy Implementation
 * Wraps AI agent as a strategy with configuration-driven behavior
 */

import {
  BaseStrategy,
  type StrategyConfig,
  type StrategyContext,
  type StrategyResult,
} from './base-strategy.js';
import type { IAIClient } from '../ai/types.js';
import type { AIContext } from '../ai/types.js';
import type { WorkflowConfig } from '../core/workflow.js';

export class AIStrategy extends BaseStrategy {
  constructor(
    config: StrategyConfig,
    private aiAgent: IAIClient,
    private workflowConfig: WorkflowConfig
  ) {
    super(config);
  }

  async generateSignals(context: StrategyContext): Promise<StrategyResult> {
    // Build AI context from workflow configuration
    const aiContext: AIContext = {
      startTime: context.timestamp,
      currentTime: context.timestamp,
      invokeCount: context.cycleCount,
      tradableCoins: context.marketData.map(md => md.coin),
      maxPositions: this.workflowConfig.maxPositions,
      maxRiskPerTrade: this.workflowConfig.riskParams.maxRiskPerTrade,
      maxLeverage: this.workflowConfig.riskParams.maxLeverage,
      minLeverage: this.workflowConfig.riskParams.minLeverage,
      defaultStopLoss: this.workflowConfig.riskParams.defaultStopLoss,
      promptOptions: {
        candles3m: this.workflowConfig.ai?.prompt?.candles?.m3 ?? 10,
        candles1h: this.workflowConfig.ai?.prompt?.candles?.h1 ?? 8,
        candles4h: this.workflowConfig.ai?.prompt?.candles?.h4 ?? 5,
        sections: {
          candlesTA: this.workflowConfig.ai?.prompt?.sections?.candlesTA ?? true,
          sentiment: this.workflowConfig.ai?.prompt?.sections?.sentiment ?? true,
          technicalState: this.workflowConfig.ai?.prompt?.sections?.technicalState ?? true,
        },
      },
    };

    // Type compatibility: StrategyContext uses MarketData from types/index.ts,
    // while generateTradingSignal expects MarketData from data/market.ts.
    // Both types share the same core structure, so this cast is safe.
    const signals = await this.aiAgent.generateTradingSignal(
      context.marketData as Parameters<IAIClient['generateTradingSignal']>[0],
      context.account,
      context.positions,
      aiContext
    );

    return {
      signals,
      metadata: {
        strategy: this.config.name,
        confidence:
          signals.length > 0
            ? signals.reduce((sum, s) => sum + s.confidence, 0) / signals.length
            : 0,
        reasoning: `AI-generated signals using ${this.config.name}`,
      },
    };
  }
}

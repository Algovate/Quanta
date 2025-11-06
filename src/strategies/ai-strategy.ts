/**
 * AI Strategy Implementation
 * Wraps AI agent as a strategy
 */

import {
  BaseStrategy,
  type StrategyConfig,
  type StrategyContext,
  type StrategyResult,
} from './base-strategy.js';
import type { OpenRouterClient } from '../ai/agent.js';

export class AIStrategy extends BaseStrategy {
  constructor(
    config: StrategyConfig,
    private aiAgent: OpenRouterClient
  ) {
    super(config);
  }

  async generateSignals(context: StrategyContext): Promise<StrategyResult> {
    const aiContext = {
      startTime: context.timestamp,
      currentTime: context.timestamp,
      invokeCount: context.cycleCount,
      tradableCoins: context.marketData.map(md => md.coin),
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

    const signals = await this.aiAgent.generateTradingSignal(
      context.marketData as any, // MarketData type mismatch between types/index.ts and data/market.ts
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

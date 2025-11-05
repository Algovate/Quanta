/**
 * Drone AI Agent - Wrapper for OpenRouterClient with cost tracking and queue support
 *
 * Uses composition to wrap OpenRouterClient and add:
 * - Cost tracking per drone
 * - Token usage tracking
 * - Integration with AICallQueue for rate limiting
 */

import { OpenRouterClient } from '../ai/agent.js';
import type { AIContext, EnrichedPositionInfo } from '../ai/agent.js';
import type { MarketData } from '../data/market.js';
import type { Account, Position, TradingSignal } from '../types/index.js';
import { AICallQueue } from './ai-call-queue.js';
import { UnifiedLogger } from '../logging/index.js';

export interface CostMetrics {
  totalCost: number;
  totalTokens: number;
  callCount: number;
}

/**
 * Model pricing (rough estimates, in USD per 1M tokens)
 * TODO: Make this configurable or fetch from OpenRouter API
 */
const MODEL_PRICING: Record<string, { input: number; output: number }> = {
  'deepseek/deepseek-chat': { input: 0.14, output: 0.28 },
  'openai/gpt-4o': { input: 2.5, output: 10.0 },
  'openai/gpt-4o-mini': { input: 0.15, output: 0.6 },
  'anthropic/claude-3.5-sonnet': { input: 3.0, output: 15.0 },
  'anthropic/claude-3-haiku': { input: 0.25, output: 1.25 },
  'meta-llama/llama-3.3-70b-instruct': { input: 0.59, output: 0.79 },
};

/**
 * Estimate token count for a prompt
 * Very rough approximation: ~4 characters per token for English text
 */
function estimateTokens(prompt: string): number {
  return Math.ceil(prompt.length / 4);
}

/**
 * Estimate cost based on model and tokens
 */
function estimateCost(model: string, inputTokens: number, outputTokens: number): number {
  const pricing = MODEL_PRICING[model] || MODEL_PRICING['deepseek/deepseek-chat'];
  const inputCost = (inputTokens / 1_000_000) * pricing.input;
  const outputCost = (outputTokens / 1_000_000) * pricing.output;
  return inputCost + outputCost;
}

export class DroneAIAgent {
  private client: OpenRouterClient;
  private costTracker: CostMetrics = {
    totalCost: 0,
    totalTokens: 0,
    callCount: 0,
  };

  private readonly logger = UnifiedLogger.getInstance();
  private readonly context: string;

  constructor(
    apiKey: string,
    model: string,
    temperature: number,
    private droneId: string,
    private aiCallQueue: AICallQueue,
    promptGroupName?: string,
    baseUrl?: string
  ) {
    this.client = new OpenRouterClient(apiKey, model, temperature, promptGroupName, baseUrl);
    this.context = `DroneAIAgent:${droneId}`;
    this.logger.info(`DroneAIAgent initialized for drone ${droneId}`, { droneId }, this.context);
  }

  async generateTradingSignal(
    marketData: MarketData[],
    account: Account,
    existingPositions: Position[],
    context: AIContext,
    enrichedPositions?: EnrichedPositionInfo[]
  ): Promise<TradingSignal[]> {
    const startTime = Date.now();

    // Queue the API call for rate limiting
    return this.aiCallQueue.enqueue(async () => {
      try {
        const result = await this.client.generateTradingSignal(
          marketData,
          account,
          existingPositions,
          context,
          enrichedPositions
        );

        const duration = Date.now() - startTime;

        // Track usage (rough estimates since we don't have actual token counts)
        this.costTracker.callCount++;

        // Estimate tokens from response
        const estimatedTokens = result.reduce((total, signal) => {
          return total + estimateTokens(JSON.stringify(signal));
        }, 0);

        // Estimate with 10:1 output ratio (rough for trading signals)
        const inputTokens = estimatedTokens * 10;
        const outputTokens = estimatedTokens;

        // Estimate cost - using model from client (we'll need to store it)
        const model = 'deepseek/deepseek-chat'; // Default, TODO: get from client
        const cost = estimateCost(model, inputTokens, outputTokens);
        this.costTracker.totalTokens += inputTokens + outputTokens;
        this.costTracker.totalCost += cost;

        this.logger.debug(
          `AI call completed for drone ${this.droneId}`,
          {
            droneId: this.droneId,
            duration,
            estimatedTokens: inputTokens + outputTokens,
            estimatedCost: cost,
            callCount: this.costTracker.callCount,
          },
          this.context
        );

        return result;
      } catch (error) {
        this.logger.error(
          `AI call failed for drone ${this.droneId}`,
          error instanceof Error ? error : new Error(String(error)),
          this.context
        );
        throw error;
      }
    });
  }

  getCostMetrics(): CostMetrics {
    return { ...this.costTracker };
  }

  resetCostMetrics(): void {
    this.costTracker = { totalCost: 0, totalTokens: 0, callCount: 0 };
    this.logger.debug(`Cost metrics reset for drone ${this.droneId}`, {}, this.context);
  }
}

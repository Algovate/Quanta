/**
 * AI Client Interface and Types
 * Defines the common interface for all AI providers
 */

import type { MarketData } from '../data/market.js';
import type { Account, Position, TradingSignal } from '../types/index.js';

/**
 * AI Provider Type
 */
export type AIClientType = 'openrouter' | 'openai' | 'dashscope' | 'deepseek' | 'ollama';

/**
 * AI Context for signal generation
 */
export interface AIContext {
  startTime: number;
  currentTime: number;
  invokeCount: number;
  tradableCoins: string[];
  maxPositions: number;
  maxRiskPerTrade: number;
  maxLeverage: number;
  minLeverage: number;
  defaultStopLoss: number;
  promptOptions?: {
    candles3m: number;
    candles1h?: number;
    candles4h: number;
    sections: {
      candlesTA: boolean;
      sentiment: boolean;
      technicalState: boolean;
    };
  };
}

/**
 * Enriched position information for AI context
 */
export interface EnrichedPositionInfo {
  position: Position;
  effectiveStopLoss: number;
  effectiveTakeProfit: number;
  currentPrice: number;
  distanceToStopLoss: number; // Percentage: positive = safe, negative = triggered
  distanceToTakeProfit: number; // Percentage: positive = not reached, negative = exceeded
  hasTrailingStop: boolean;
  hasCustomStopLoss: boolean;
  hasCustomTakeProfit: boolean;
  tp1Executed: boolean; // Whether TP1 (partial close) has been executed
  rMultiple: number; // Current R-multiple relative to initial risk
}

/**
 * Common interface for all AI clients
 */
export interface IAIClient {
  /**
   * Generate trading signals based on market data, account state, and positions
   */
  generateTradingSignal(
    marketData: MarketData[],
    account: Account,
    existingPositions: Position[],
    context: AIContext,
    enrichedPositions?: EnrichedPositionInfo[]
  ): Promise<TradingSignal[]>;
}

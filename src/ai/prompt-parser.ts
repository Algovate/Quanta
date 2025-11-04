/**
 * Parsing utilities for AI trading signal responses
 * Handles both enhanced format (<output> tags) and legacy format
 */

import { TradingSignal } from '../types/index.js';
import { AIResponse } from './agent.js';

/**
 * Regex patterns for extracting JSON from AI responses
 */
export const OUTPUT_TAG_PATTERN = /<output>([\s\S]*?)<\/output>/;
export const JSON_OBJECT_PATTERN = /\{[\s\S]*\}/;

/**
 * Extract JSON source from AI response
 * Tries enhanced format (<output> tags) first, falls back to raw response
 */
export function extractJsonSource(response: string): string {
  const outputMatch = response.match(OUTPUT_TAG_PATTERN);
  return outputMatch ? outputMatch[1].trim() : response;
}

/**
 * Parse JSON object from text
 */
export function parseJsonObject(text: string): any {
  const jsonMatch = text.match(JSON_OBJECT_PATTERN);
  if (!jsonMatch) {
    throw new Error('No JSON found in response');
  }
  return JSON.parse(jsonMatch[0]);
}

/**
 * Validate parsed response has expected structure
 */
export function validateParsedResponse(parsed: any): void {
  if (!parsed.signals || !Array.isArray(parsed.signals)) {
    throw new Error('Invalid response format: missing signals array');
  }
}

/**
 * Convert AIResponse to TradingSignal
 * AIResponse uses snake_case, TradingSignal also uses snake_case
 */
export function convertToTradingSignal(signal: AIResponse): TradingSignal {
  return {
    coin: signal.coin,
    action: signal.action,
    confidence: signal.confidence,
    reasoning: signal.reasoning,
    entry_price: signal.entry_price,
    position_size: signal.position_size,
    stop_loss: signal.stop_loss,
    profit_target: signal.profit_target,
    invalidation_condition: signal.invalidation_condition,
  };
}

/**
 * Parse AI response into array of TradingSignals
 * Handles enhanced format with <output> tags and legacy format
 */
export function parseAiResponse(response: string): TradingSignal[] {
  try {
    const jsonSource = extractJsonSource(response);
    const parsed = parseJsonObject(jsonSource);
    validateParsedResponse(parsed);

    return parsed.signals.map(convertToTradingSignal);
  } catch {
    // Return empty array on any parsing error
    // Error logging should be done by caller with context
    return [];
  }
}

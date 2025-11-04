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
 * Result of parsing AI response with error details
 */
export interface ParseResult {
  signals: TradingSignal[];
  error?: {
    message: string;
    step: 'extraction' | 'parsing' | 'validation' | 'conversion';
    originalError: Error;
  };
}

/**
 * Parse AI response into array of TradingSignals with error details
 * Handles enhanced format with <output> tags and legacy format
 */
export function parseAiResponseWithDetails(response: string): ParseResult {
  try {
    let jsonSource: string;
    try {
      jsonSource = extractJsonSource(response);
    } catch (error) {
      return {
        signals: [],
        error: {
          message: 'Failed to extract JSON from response',
          step: 'extraction',
          originalError: error instanceof Error ? error : new Error(String(error)),
        },
      };
    }

    let parsed: any;
    try {
      parsed = parseJsonObject(jsonSource);
    } catch (error) {
      return {
        signals: [],
        error: {
          message: error instanceof Error ? error.message : String(error),
          step: 'parsing',
          originalError: error instanceof Error ? error : new Error(String(error)),
        },
      };
    }

    try {
      validateParsedResponse(parsed);
    } catch (error) {
      return {
        signals: [],
        error: {
          message: error instanceof Error ? error.message : String(error),
          step: 'validation',
          originalError: error instanceof Error ? error : new Error(String(error)),
        },
      };
    }

    try {
      const signals = parsed.signals.map(convertToTradingSignal);
      return { signals };
    } catch (error) {
      return {
        signals: [],
        error: {
          message: 'Failed to convert signals',
          step: 'conversion',
          originalError: error instanceof Error ? error : new Error(String(error)),
        },
      };
    }
  } catch (error) {
    // Catch-all for any unexpected errors
    return {
      signals: [],
      error: {
        message: 'Unexpected parsing error',
        step: 'parsing',
        originalError: error instanceof Error ? error : new Error(String(error)),
      },
    };
  }
}

/**
 * Parse AI response into array of TradingSignals
 * Handles enhanced format with <output> tags and legacy format
 * @deprecated Use parseAiResponseWithDetails for better error handling
 */
export function parseAiResponse(response: string): TradingSignal[] {
  const result = parseAiResponseWithDetails(response);
  return result.signals;
}

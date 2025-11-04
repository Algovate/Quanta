/**
 * CLI Option Validation - Zod schemas for CLI command options
 */

import { z } from 'zod';

/**
 * Environment enum: simulate, paper, live
 */
export const EnvSchema = z.enum(['simulate', 'paper', 'live'], {
  errorMap: () => ({
    message: 'Invalid environment. Must be one of: simulate, paper, live',
  }),
});

export type Env = z.infer<typeof EnvSchema>;

/**
 * Coins string: comma-separated list, transformed to uppercase array
 */
export const CoinsSchema = z
  .string()
  .min(1, 'At least one coin is required')
  .transform(s =>
    s
      .split(',')
      .map(c => c.trim().toUpperCase())
      .filter(c => c.length > 0)
  );

/**
 * Date string: YYYY-MM-DD format
 */
export const DateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, {
  message: 'Date must be in YYYY-MM-DD format',
});

/**
 * Positive number
 */
export const PositiveNumberSchema = z
  .string()
  .transform(v => parseFloat(v))
  .refine(v => !isNaN(v) && v > 0, {
    message: 'Must be a positive number',
  });

/**
 * Non-negative integer
 */
export const NonNegativeIntSchema = z
  .string()
  .transform(v => parseInt(v, 10))
  .refine(v => !isNaN(v) && v >= 0, {
    message: 'Must be a non-negative integer',
  });

/**
 * Positive integer
 */
export const PositiveIntSchema = z
  .string()
  .transform(v => parseInt(v, 10))
  .refine(v => !isNaN(v) && v > 0, {
    message: 'Must be a positive integer',
  });

/**
 * AI type: mock or real
 */
export const AITypeSchema = z.enum(['mock', 'real'], {
  errorMap: () => ({
    message: 'Invalid AI type. Must be "mock" or "real"',
  }),
});

/**
 * Boolean flag (optional, defaults to false)
 */
export const BooleanFlagSchema = z
  .union([z.boolean(), z.string()])
  .transform(v => v === true || v === 'true');

/**
 * Validate and parse environment option
 */
export function validateEnv(env?: string): Env {
  if (!env) {
    return 'simulate';
  }
  return EnvSchema.parse(env);
}

/**
 * Validate and parse coins option
 */
export function validateCoins(coins?: string): string[] {
  if (!coins) {
    return ['BTC', 'ETH', 'SOL'];
  }
  return CoinsSchema.parse(coins);
}

/**
 * Validate and parse date option
 */
export function validateDate(date: string): string {
  return DateSchema.parse(date);
}

/**
 * Validate and parse positive number
 */
export function validatePositiveNumber(value: string | undefined, defaultValue: number): number {
  if (!value || value.trim() === '') {
    return defaultValue;
  }
  try {
    const parsed = PositiveNumberSchema.parse(value);
    return parsed;
  } catch {
    return defaultValue;
  }
}

/**
 * Validate and parse positive integer
 */
export function validatePositiveInt(value: string | undefined, defaultValue: number): number {
  if (!value || value.trim() === '') {
    return defaultValue;
  }
  try {
    const parsed = PositiveIntSchema.parse(value);
    return parsed;
  } catch {
    return defaultValue;
  }
}

/**
 * Validate and parse AI type
 */
export function validateAIType(ai?: string): 'mock' | 'real' {
  if (!ai) {
    return 'mock';
  }
  return AITypeSchema.parse(ai.toLowerCase());
}

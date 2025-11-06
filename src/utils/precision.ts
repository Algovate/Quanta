/**
 * Precision utilities for financial calculations
 * Uses decimal.js to prevent floating-point precision errors
 */

import Decimal from 'decimal.js';
import type { Decimal as DecimalNamespace } from 'decimal.js';

// Type for numeric values that can be converted to Decimal
// Decimal.js exports Decimal.Instance as the instance type
type NumericValue = number | DecimalNamespace.Instance | { toNumber(): number };

// Type assertion helper for Decimal constructor
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const DecimalConstructor = Decimal as any;

/**
 * Exchange-specific precision constants (decimal places)
 */
export const EXCHANGE_PRECISION = {
  BTC: 8,
  ETH: 5,
  USDT: 2,
  SOL: 4,
  // Default precision for unknown symbols
  DEFAULT: 8,
} as const;

/**
 * Get precision for a trading symbol
 */
export function getSymbolPrecision(symbol: string): number {
  const upperSymbol = symbol.toUpperCase().replace('/USDT', '').replace('USDT', '').trim();

  // Check exact match
  if (upperSymbol in EXCHANGE_PRECISION) {
    return EXCHANGE_PRECISION[upperSymbol as keyof typeof EXCHANGE_PRECISION];
  }

  return EXCHANGE_PRECISION.DEFAULT;
}

/**
 * Round a value to a specific number of decimal places
 */
export function roundToPrecision(value: NumericValue, decimals: number): number {
  // Check if value is already a Decimal by checking for toNumber method

  const decimal =
    typeof value === 'object' && value !== null && 'toNumber' in value
      ? value
      : new DecimalConstructor(value);

  return decimal.toDecimalPlaces(decimals).toNumber();
}

/**
 * Round a value to exchange-specific precision
 */
export function roundToSymbolPrecision(value: NumericValue, symbol: string): number {
  const precision = getSymbolPrecision(symbol);
  return roundToPrecision(value, precision);
}

/**
 * Safe division with precision handling
 * Returns Decimal instance for chaining, or number if decimals specified
 */
export function safeDivide(
  a: NumericValue,
  b: NumericValue,
  decimals?: number
): DecimalNamespace.Instance {
  // Check if values are already Decimal instances

  const decimalA =
    typeof a === 'object' && a !== null && 'toNumber' in a ? a : new DecimalConstructor(a);
  const decimalB =
    typeof b === 'object' && b !== null && 'toNumber' in b ? b : new DecimalConstructor(b);

  if (decimalB.isZero()) {
    throw new Error('Division by zero');
  }

  const result = decimalA.div(decimalB);

  if (decimals !== undefined) {
    return result.toDecimalPlaces(decimals);
  }

  return result;
}

/**
 * Safe division returning number
 */
export function safeDivideNum(a: NumericValue, b: NumericValue, decimals?: number): number {
  return safeDivide(a, b, decimals).toNumber();
}

/**
 * Safe multiplication with precision handling
 * Returns Decimal instance for chaining, or number if decimals specified
 */
export function safeMultiply(
  a: NumericValue,
  b: NumericValue,
  decimals?: number
): DecimalNamespace.Instance {
  // Check if values are already Decimal instances

  const decimalA =
    typeof a === 'object' && a !== null && 'toNumber' in a ? a : new DecimalConstructor(a);
  const decimalB =
    typeof b === 'object' && b !== null && 'toNumber' in b ? b : new DecimalConstructor(b);

  const result = decimalA.mul(decimalB);

  if (decimals !== undefined) {
    return result.toDecimalPlaces(decimals);
  }

  return result;
}

/**
 * Safe multiplication returning number
 */
export function safeMultiplyNum(a: NumericValue, b: NumericValue, decimals?: number): number {
  return safeMultiply(a, b, decimals).toNumber();
}

/**
 * Safe addition with precision handling
 * Returns Decimal instance for chaining, or number if decimals specified
 */
export function safeAdd(
  a: NumericValue,
  b: NumericValue,
  decimals?: number
): DecimalNamespace.Instance {
  // Check if values are already Decimal instances

  const decimalA =
    typeof a === 'object' && a !== null && 'toNumber' in a ? a : new DecimalConstructor(a);
  const decimalB =
    typeof b === 'object' && b !== null && 'toNumber' in b ? b : new DecimalConstructor(b);

  const result = decimalA.add(decimalB);

  if (decimals !== undefined) {
    return result.toDecimalPlaces(decimals);
  }

  return result;
}

/**
 * Safe addition returning number
 */
export function safeAddNum(a: NumericValue, b: NumericValue, decimals?: number): number {
  return safeAdd(a, b, decimals).toNumber();
}

/**
 * Safe subtraction with precision handling
 * Returns Decimal instance for chaining, or number if decimals specified
 */
export function safeSubtract(
  a: NumericValue,
  b: NumericValue,
  decimals?: number
): DecimalNamespace.Instance {
  // Check if values are already Decimal instances

  const decimalA =
    typeof a === 'object' && a !== null && 'toNumber' in a ? a : new DecimalConstructor(a);
  const decimalB =
    typeof b === 'object' && b !== null && 'toNumber' in b ? b : new DecimalConstructor(b);

  const result = decimalA.sub(decimalB);

  if (decimals !== undefined) {
    return result.toDecimalPlaces(decimals);
  }

  return result;
}

/**
 * Safe subtraction returning number
 */
export function safeSubtractNum(a: NumericValue, b: NumericValue, decimals?: number): number {
  return safeSubtract(a, b, decimals).toNumber();
}

/**
 * Calculate percentage with precision
 */

export function safePercentage(
  value: NumericValue,
  percentage: NumericValue,
  decimals?: number
): DecimalNamespace.Instance {
  const decimalValue =
    typeof value === 'object' && value !== null && 'toNumber' in value
      ? value
      : new DecimalConstructor(value);
  const decimalPercentage =
    typeof percentage === 'object' && percentage !== null && 'toNumber' in percentage
      ? percentage
      : new DecimalConstructor(percentage);

  // percentage is typically 0.05 for 5%, etc.

  const result = decimalValue.mul(decimalPercentage);

  if (decimals !== undefined) {
    return result.toDecimalPlaces(decimals);
  }

  return result;
}

/**
 * Calculate percentage returning number
 */

export function safePercentageNum(
  value: NumericValue,
  percentage: NumericValue,
  decimals?: number
): number {
  return safePercentage(value, percentage, decimals).toNumber();
}

/**
 * Validate that a number is finite and valid
 */
export function validateNumber(value: NumericValue): boolean {
  try {
    const decimal =
      typeof value === 'object' && value !== null && 'toNumber' in value
        ? value
        : new DecimalConstructor(value);

    return decimal.isFinite() && !decimal.isNaN();
  } catch {
    return false;
  }
}

/**
 * Convert Decimal to number with validation
 */
export function toNumber(value: NumericValue, decimals?: number): number {
  if (!validateNumber(value)) {
    throw new Error('Invalid number value');
  }

  // Convert to Decimal instance if not already
  const decimal =
    typeof value === 'object' && value !== null && 'toNumber' in value
      ? value
      : new DecimalConstructor(value);

  if (decimals !== undefined) {
    return decimal.toDecimalPlaces(decimals).toNumber();
  }

  return decimal.toNumber();
}

/**
 * Tolerance constants for validation and calculations
 * Centralized values to improve maintainability and consistency
 */

export const TOLERANCES = {
  /** Tolerance for equity calculation validation (0.01 USD) */
  EQUITY_DRIFT: 0.01,
  /** Tolerance for margin calculation validation (0.01 USD) */
  MARGIN_DRIFT: 0.01,
  /** Tolerance for slippage validation (5%) */
  SLIPPAGE_MAX_PERCENT: 5,
  /** Tolerance for floating-point comparisons */
  FLOATING_POINT_EPSILON: 0.0001,
} as const;

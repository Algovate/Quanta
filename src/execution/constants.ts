/**
 * Constants for execution module
 * Centralized values to reduce magic numbers and improve maintainability
 */

/**
 * Position sizing and capital management thresholds
 */
export const POSITION_SIZING = {
  /** Maximum percentage of available capital to use per trade */
  MAX_CAPITAL_PERCENT: 0.3,
  /** Minimum percentage of capital to reserve for other trades */
  MIN_RESERVE_PERCENT: 0.4,
  /** Minimum position value as percentage of account equity */
  MIN_POSITION_PERCENT: 0.01,
  /** Absolute minimum position value in USD */
  MIN_POSITION_VALUE_USD: 200,
} as const;

/**
 * Signal validation thresholds
 */
export const SIGNAL_VALIDATION = {
  /** Minimum confidence required to execute a signal */
  MIN_CONFIDENCE: 0.55,
  /** Minimum allowed stop loss percentage */
  MIN_STOP_LOSS: 0.01,
  /** Maximum allowed stop loss percentage */
  MAX_STOP_LOSS: 0.1,
  /** Minimum risk/reward ratio required */
  MIN_RISK_REWARD_RATIO: 1.5,
} as const;

/**
 * Position monitoring and risk thresholds
 */
export const POSITION_MONITORING = {
  /** Emergency stop loss threshold (percentage) */
  EMERGENCY_STOP_LOSS_THRESHOLD: 0.1,
  /** Medium risk level threshold */
  MEDIUM_RISK_THRESHOLD: 0.05,
  /** High risk level threshold */
  HIGH_RISK_THRESHOLD: 0.1,
} as const;

/**
 * Order execution defaults
 */
export const ORDER_EXECUTION = {
  /** Default risk/reward ratio for take profit */
  DEFAULT_RISK_REWARD_RATIO: 2,
} as const;

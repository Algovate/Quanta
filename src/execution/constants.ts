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

/**
 * Position closing and update thresholds
 */
export const POSITION_CLOSING = {
  /**
   * Tolerance for full position close (as percentage of position size)
   * Used to handle floating point errors when comparing order amount to position size
   */
  CLOSE_TOLERANCE_PERCENT: 0.01, // 1%

  /**
   * Threshold for creating new position after closing opposite position (as percentage of closed size)
   * Very strict threshold to prevent CLOSE orders from accidentally creating new positions
   */
  NEW_POSITION_THRESHOLD_PERCENT: 0.001, // 0.1%

  /**
   * Minimum absolute threshold for new position creation (to handle very small positions)
   */
  NEW_POSITION_MIN_THRESHOLD: 0.000001,

  /**
   * Threshold for logging small remainders after position close (as percentage)
   * Only log if remainder is significant enough to avoid spam
   */
  LOG_REMAINDER_THRESHOLD_PERCENT: 0.0001, // 0.01%
} as const;

/**
 * Account validation thresholds
 */
export const ACCOUNT_VALIDATION = {
  /** Maximum allowed difference for equity calculation validation (in USD) */
  EQUITY_TOLERANCE: 0.01,

  /** Maximum allowed difference for margin calculation validation (in USD) */
  MARGIN_TOLERANCE: 0.01,
} as const;

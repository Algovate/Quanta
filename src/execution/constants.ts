/**
 * Constants for execution module
 * Centralized values to reduce magic numbers and improve maintainability
 */

// Re-export constants from sub-modules
export * from './constants/timeouts.js';
export * from './constants/retries.js';
export * from './constants/tolerances.js';

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
  /** Minimum stop loss to prevent division issues (0.1%) */
  MIN_STOP_LOSS_THRESHOLD: 0.001,
  /** Minimum utilization factor even at max positions */
  MIN_UTILIZATION_FACTOR: 0.3,
  /** Maximum position size as percentage of equity (safety cap) */
  MAX_POSITION_SIZE_PERCENT: 0.25,
  /** ATR multiplier for stop loss (e.g., 1.5x ATR) */
  ATR_STOP_LOSS_MULTIPLIER: 1.5,
  /** High volatility ATR multiplier (2.0x ATR for wider stops) */
  ATR_MULTIPLIER_HIGH_VOLATILITY: 2.0,
  /** Low volatility ATR multiplier (1.2x ATR for tighter stops) */
  ATR_MULTIPLIER_LOW_VOLATILITY: 1.2,
  /** High volatility threshold (ATR as percentage of price) */
  HIGH_VOLATILITY_THRESHOLD: 0.03, // 3%
  /** Low volatility threshold (ATR as percentage of price) */
  LOW_VOLATILITY_THRESHOLD: 0.01, // 1%
  /** Maximum ATR percentage of price before scaling down position size */
  MAX_ATR_PERCENT_OF_PRICE: 0.02, // 2%
  /** Trending market stop loss multiplier (33% wider) */
  TRENDING_STOP_MULTIPLIER: 1.33,
  /** Ranging market stop loss multiplier (25% tighter) */
  RANGING_STOP_MULTIPLIER: 0.75,
  /** Maximum same-side positions before rejecting correlated entries */
  MAX_SAME_SIDE_POSITIONS: 3,
  /** Maximum pairwise correlation threshold (0-1) */
  MAX_PAIRWISE_CORRELATION: 0.8,
  /** Maximum portfolio correlation threshold (0-1) */
  MAX_PORTFOLIO_CORRELATION: 0.9,
  /** ADX threshold for trend detection (we'll use EMA slope method instead) */
  TREND_REGIME_THRESHOLD: 0.015, // 1.5% EMA slope change over 10 periods
  /** Bollinger bandwidth threshold for ranging (narrow = ranging) */
  RANGING_BANDWIDTH_THRESHOLD: 0.02, // 2% bandwidth
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
  /** Epsilon tolerance for floating-point precision in confidence comparisons */
  CONFIDENCE_EPSILON: 0.0001,
} as const;

/**
 * Position monitoring and risk thresholds
 */
export const POSITION_MONITORING = {
  /** Emergency stop loss threshold (percentage of margin used) */
  EMERGENCY_STOP_LOSS_THRESHOLD: 0.1,
  /** Medium risk level threshold (margin ratio) */
  MEDIUM_RISK_THRESHOLD: 0.15,
  /** High risk level threshold (margin ratio) */
  HIGH_RISK_THRESHOLD: 0.25,
  /** Maximum portfolio drawdown before emergency close */
  MAX_PORTFOLIO_DRAWDOWN: 0.15,
  /** Maximum daily loss limit (percentage of initial balance) */
  MAX_DAILY_LOSS: 0.05,
} as const;

/**
 * Order execution defaults
 */
export const ORDER_EXECUTION = {
  /** Default risk/reward ratio for take profit */
  DEFAULT_RISK_REWARD_RATIO: 2,
  /** Trailing stop activation threshold (percentage profit) */
  TRAILING_STOP_ACTIVATION: 0.02,
  /** Trailing stop distance from peak (percentage) */
  TRAILING_STOP_DISTANCE: 0.02,
  /** Minimum trailing stop distance (percentage) */
  MIN_TRAILING_STOP_DISTANCE: 0.01, // 1%
  /** Maximum trailing stop distance (percentage) */
  MAX_TRAILING_STOP_DISTANCE: 0.05, // 5%
  /** ATR-based trailing distance multiplier */
  ATR_TRAILING_DISTANCE_MULTIPLIER: 1.5,
  /** High profit trailing stop distance (at +10% profit) */
  HIGH_PROFIT_TRAILING_DISTANCE: 0.015, // 1.5%
  /** Medium profit trailing stop distance (at +7.5% profit) */
  MEDIUM_PROFIT_TRAILING_DISTANCE: 0.0175, // 1.75%
  /** High profit threshold (percentage) */
  HIGH_PROFIT_THRESHOLD: 0.1, // 10%
  /** Medium profit threshold (percentage) */
  MEDIUM_PROFIT_THRESHOLD: 0.075, // 7.5%
  /** Trailing stop tightening factor at high profit */
  HIGH_PROFIT_TIGHTENING_FACTOR: 0.75,
  /** Trailing stop tightening factor at medium profit */
  MEDIUM_PROFIT_TIGHTENING_FACTOR: 0.875,
  /** Breakeven threshold (percentage profit) */
  BREAKEVEN_THRESHOLD: 0.02,
  /** R-multiple threshold for flat detection (±0.25R) */
  FLAT_R_MULTIPLE_THRESHOLD: 0.25,
  /** Number of cycles position must be flat before tightening stop to breakeven */
  FLAT_CYCLES_BEFORE_BREAKEVEN: 3,
  /** Number of cycles position must be flat before auto-closing */
  FLAT_CYCLES_BEFORE_AUTO_CLOSE: 8,
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

  /** Minimum equity to allow trading (in USD) */
  MIN_EQUITY: 100,

  /** Minimum price value to be considered valid */
  MIN_VALID_PRICE: 0.000001,
} as const;

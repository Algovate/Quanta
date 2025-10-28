/**
 * Constants for AI module
 * Centralized values for AI signal generation
 */

/**
 * Mock AI signal parameters
 */
export const MOCK_AI_SIGNALS = {
  /** Default stop loss percentage */
  DEFAULT_STOP_LOSS: 0.03,
  /** Default profit target percentage (2:1 risk/reward) */
  DEFAULT_PROFIT_TARGET: 0.06,
  /** Default position size as percentage of account */
  DEFAULT_POSITION_SIZE: 0.05,
  /** Price variation range for entry price */
  PRICE_VARIATION_RANGE: 0.001,
} as const;

/**
 * Technical indicator thresholds for signal generation
 */
export const TECHNICAL_THRESHOLDS = {
  /** RSI lower bound for valid signals */
  RSI_LOWER_BOUND: 25,
  /** RSI upper bound for valid signals */
  RSI_UPPER_BOUND: 75,
  /** RSI overbought threshold */
  RSI_OVERBOUGHT: 70,
  /** RSI oversold threshold */
  RSI_OVERSOLD: 30,
  /** Weak MACD momentum threshold */
  MACD_WEAK_MOMENTUM_THRESHOLD: 5,
} as const;

/**
 * Confidence calculation adjustments
 */
export const CONFIDENCE_ADJUSTMENTS = {
  BASE_CONFIDENCE: 0.5,
  RSI_CONFIDENCE_BOOST: 0.2,
  RSI_CONFIDENCE_PENALTY: -0.2,
  MACD_CONFIDENCE_BOOST: 0.15,
  TREND_ALIGNMENT_BOOST: 0.1,
  VOLATILITY_MEDIUM_BOOST: 0.05,
  VOLATILITY_HIGH_PENALTY: -0.05,
  MIN_CONFIDENCE: 0.3,
  MAX_CONFIDENCE: 0.95,
} as const;

/**
 * RSI ranges for bullish/bearish signals
 */
export const RSI_RANGES = {
  BULLISH_LOWER: 40,
  BULLISH_UPPER: 65,
  BEARISH_LOWER: 35,
  BEARISH_UPPER: 60,
} as const;

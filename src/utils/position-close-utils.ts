/**
 * Utilities for handling position closing logic
 * Prevents CLOSE orders from accidentally creating new positions
 */

import { POSITION_CLOSING } from '../execution/constants.js';

/**
 * Result of checking if a new position should be created after closing
 */
export interface PositionCloseCheckResult {
  /** Whether a new position should be created */
  shouldCreatePosition: boolean;
  /** Whether the remainder is significant enough to log */
  shouldLogRemainder: boolean;
  /** Warning message if position creation might be a logic error */
  warningMessage?: string;
}

/**
 * Determines if a new position should be created after closing an opposite position.
 * Uses strict thresholds to prevent CLOSE orders from accidentally creating new positions.
 *
 * @param remainingAmount - Remaining order amount after closing opposite position
 * @param closedSize - Size of the position that was closed
 * @param symbol - Trading symbol for logging
 * @param positionSide - Side of the potential new position ('long' or 'short')
 * @returns Result indicating whether to create position and what to log
 */
export function shouldCreatePositionAfterClose(
  remainingAmount: number,
  closedSize: number,
  symbol: string,
  positionSide: 'long' | 'short'
): PositionCloseCheckResult {
  // For CLOSE orders, we use exact position size, so remainingAmount should be 0 or very small
  // Use a very strict threshold to prevent accidental reverse positions
  const significantThreshold = Math.max(
    closedSize * POSITION_CLOSING.NEW_POSITION_THRESHOLD_PERCENT,
    POSITION_CLOSING.NEW_POSITION_MIN_THRESHOLD
  );

  if (remainingAmount > significantThreshold) {
    // Significant remainder - might indicate logic error, but allow position creation with warning
    return {
      shouldCreatePosition: true,
      shouldLogRemainder: true,
      warningMessage:
        `Warning: Creating new ${positionSide} position for ${symbol} after closing opposite position. ` +
        `This may indicate a logic error. Remaining amount: ${remainingAmount}, Closed size: ${closedSize}`,
    };
  }

  if (remainingAmount > 0) {
    // Small remainder - likely floating point precision, don't create position
    const logThreshold = closedSize * POSITION_CLOSING.LOG_REMAINDER_THRESHOLD_PERCENT;
    return {
      shouldCreatePosition: false,
      shouldLogRemainder: remainingAmount > logThreshold,
    };
  }

  // No remainder - clean close
  return {
    shouldCreatePosition: false,
    shouldLogRemainder: false,
  };
}

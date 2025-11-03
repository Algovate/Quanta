/**
 * Signal validation logic for RiskManager
 * Extracted from RiskManager to improve modularity
 */

import { TradingSignal, Account, Position } from '../../exchange/types.js';
import { SIGNAL_VALIDATION, POSITION_SIZING } from '../constants.js';
import { UnifiedLogger } from '../../logging/index.js';
import { SymbolPerformanceTracker } from '../symbol-performance.js';

export interface SignalValidationResult {
  valid: boolean;
  reason?: string;
}

/**
 * Validates trading signals for correctness and safety
 */
export class SignalValidator {
  private logger: UnifiedLogger;
  private readonly context = 'SignalValidator';
  private performanceTracker: SymbolPerformanceTracker;

  constructor(performanceTracker: SymbolPerformanceTracker) {
    this.logger = UnifiedLogger.getInstance();
    this.performanceTracker = performanceTracker;
  }

  validateSignal(
    signal: TradingSignal,
    _account: Account,
    currentPositions: Position[]
  ): SignalValidationResult {
    try {
      // Check signal format
      if (!signal.coin || !signal.action || !signal.confidence) {
        const missingFields: string[] = [];
        if (!signal.coin) missingFields.push('coin');
        if (!signal.action) missingFields.push('action');
        if (!signal.confidence) missingFields.push('confidence');

        const reason = `Missing required fields: ${missingFields.join(', ')}`;
        this.logger.warn(`Signal validation failed: ${reason}`, {}, this.context);
        return { valid: false, reason };
      }

      // Check confidence threshold with adaptive adjustment based on symbol performance
      const adaptiveThreshold = this.performanceTracker.getConfidenceThreshold(
        signal.coin,
        SIGNAL_VALIDATION.MIN_CONFIDENCE
      );
      if (adaptiveThreshold !== SIGNAL_VALIDATION.MIN_CONFIDENCE) {
        this.logger.debug(
          'Adaptive confidence threshold applied',
          {
            coin: signal.coin,
            default: (SIGNAL_VALIDATION.MIN_CONFIDENCE * 100).toFixed(1) + '%',
            adjusted: (adaptiveThreshold * 100).toFixed(1) + '%',
          },
          this.context
        );
      }

      // Check with epsilon tolerance for floating-point precision
      // (e.g., 0.54999999 should be accepted when threshold is 0.55)
      if (signal.confidence < adaptiveThreshold - SIGNAL_VALIDATION.CONFIDENCE_EPSILON) {
        const reason = `Confidence too low: ${(signal.confidence * 100).toFixed(1)}% < ${(adaptiveThreshold * 100).toFixed(1)}% required (adaptive threshold based on ${signal.coin} performance)`;
        // Log signal validation rejection
        this.logger.debug(
          `Signal validation rejected for ${signal.coin} ${signal.action}: ${reason}`,
          {},
          this.context
        );
        return { valid: false, reason };
      }

      // Check if we already have a position in this coin
      // Normalize symbol comparison (e.g., "BTC/USDT" vs "BTC")
      const positionSymbol = `${signal.coin}/USDT`;
      const existingPosition = currentPositions.find(p => p.symbol === positionSymbol);
      if (existingPosition && (signal.action === 'LONG' || signal.action === 'SHORT')) {
        const reason = `Position already exists for ${signal.coin} (${existingPosition.side} ${existingPosition.size} ${signal.coin})`;
        this.logger.debug(
          `Signal validation rejected for ${signal.coin} ${signal.action}: ${reason}`,
          {},
          this.context
        );
        return { valid: false, reason };
      }

      // Check stop loss validity
      if (
        signal.stop_loss &&
        (signal.stop_loss < SIGNAL_VALIDATION.MIN_STOP_LOSS ||
          signal.stop_loss > SIGNAL_VALIDATION.MAX_STOP_LOSS)
      ) {
        const reason = `Invalid stop loss: ${(signal.stop_loss * 100).toFixed(1)}% not in range ${(SIGNAL_VALIDATION.MIN_STOP_LOSS * 100).toFixed(1)}%-${(SIGNAL_VALIDATION.MAX_STOP_LOSS * 100).toFixed(1)}%`;
        this.logger.debug(
          `Signal validation rejected for ${signal.coin} ${signal.action}: ${reason}`,
          {},
          this.context
        );
        return { valid: false, reason };
      }

      // Check profit target validity
      if (
        signal.profit_target &&
        signal.stop_loss &&
        signal.profit_target < signal.stop_loss * SIGNAL_VALIDATION.MIN_RISK_REWARD_RATIO
      ) {
        const reason = `Invalid risk/reward ratio: ${(signal.profit_target / signal.stop_loss).toFixed(2)} < ${SIGNAL_VALIDATION.MIN_RISK_REWARD_RATIO} required`;
        this.logger.debug(
          `Signal validation rejected for ${signal.coin} ${signal.action}: ${reason}`,
          {},
          this.context
        );
        return { valid: false, reason };
      }

      // Correlation check: prevent over-concentration of same-side positions
      if (signal.action === 'LONG' || signal.action === 'SHORT') {
        const targetSide = signal.action.toLowerCase() as 'long' | 'short';
        const sameSidePositions = currentPositions.filter(p => p.side === targetSide);
        if (sameSidePositions.length >= POSITION_SIZING.MAX_SAME_SIDE_POSITIONS) {
          const reason = `Too many ${targetSide} positions (${sameSidePositions.length} >= ${POSITION_SIZING.MAX_SAME_SIDE_POSITIONS}), rejecting to reduce correlation`;
          this.logger.debug(
            `Signal validation rejected for ${signal.coin} ${signal.action}: ${reason}`,
            {},
            this.context
          );
          return { valid: false, reason };
        }
      }

      return { valid: true };
    } catch (error) {
      const reason = `Validation error: ${error instanceof Error ? error.message : 'Unknown error'}`;
      this.logger.error(
        'Error validating signal',
        error instanceof Error ? error : new Error(String(error)),
        this.context
      );
      return { valid: false, reason };
    }
  }
}

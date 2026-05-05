/**
 * Dynamic Reserve Calculator
 * Calculates reserve percentage based on market conditions and portfolio state
 */

import { Position } from '../../exchange/types.js';
import { POSITION_SIZING } from '../constants.js';
import { safeDivide } from '../../utils/precision.js';

export interface DynamicReserveConfig {
  enabled?: boolean;
  minReservePercent?: number;
  maxReservePercent?: number;
  baseReservePercent?: number;
}

export interface ReserveAdjustmentContext {
  positions: Position[];
  positionCount: number;
  maxPositions: number;
  drawdownState?: 'normal' | 'reduced' | 'paused';
  atr14?: number;
  currentPrice?: number;
}

export interface ReserveAdjustment {
  amount: number;
  reason: string;
}

export interface ReserveCalculationResult {
  reserve: number;
  reasons: string[];
  wasClamped: boolean;
}

/**
 * Calculate dynamic reserve percentage based on market conditions
 */
export class DynamicReserveCalculator {
  private readonly config: DynamicReserveConfig;
  private readonly minReserve: number;
  private readonly maxReserve: number;
  private readonly baseReserve: number;

  constructor(config: DynamicReserveConfig = {}) {
    this.config = config;
    this.minReserve = config.minReservePercent ?? POSITION_SIZING.MIN_DYNAMIC_RESERVE_PERCENT;
    this.maxReserve = config.maxReservePercent ?? POSITION_SIZING.MAX_DYNAMIC_RESERVE_PERCENT;
    this.baseReserve = config.baseReservePercent ?? POSITION_SIZING.BASE_RESERVE_PERCENT;
  }

  /**
   * Calculate reserve percentage based on context
   * Returns both the reserve value and adjustment reasons in a single pass
   */
  calculate(context: ReserveAdjustmentContext): ReserveCalculationResult {
    const enabled = this.config.enabled ?? POSITION_SIZING.DYNAMIC_RESERVE_ENABLED;
    if (!enabled) {
      return { reserve: POSITION_SIZING.MIN_RESERVE_PERCENT, reasons: [], wasClamped: false };
    }

    let reserve: number = this.baseReserve;
    const reasons: string[] = [];

    // Apply adjustments in order
    const drawdownAdjustment = this.adjustForDrawdown(context.drawdownState);
    if (drawdownAdjustment) {
      reserve = this.applyAdjustment(reserve, drawdownAdjustment);
      reasons.push('drawdown');
    }

    const positionAdjustment = this.adjustForPositionCount(
      context.positionCount,
      context.maxPositions
    );
    if (positionAdjustment) {
      reserve = this.applyAdjustment(reserve, positionAdjustment);
      reasons.push('position_count');
    }

    const volatilityAdjustment = this.adjustForVolatility(context.atr14, context.currentPrice);
    if (volatilityAdjustment) {
      reserve = this.applyAdjustment(reserve, volatilityAdjustment);
      reasons.push('volatility');
    }

    // Clamp to min/max bounds and track if clamping occurred
    const unclamped = reserve;
    reserve = Math.max(this.minReserve, Math.min(this.maxReserve, reserve));
    const wasClamped = reserve !== unclamped;

    return { reserve, reasons, wasClamped };
  }

  /**
   * Get min reserve for logging
   */
  getMinReserve(): number {
    return this.minReserve;
  }

  /**
   * Get max reserve for logging
   */
  getMaxReserve(): number {
    return this.maxReserve;
  }

  /**
   * Adjust reserve based on drawdown state
   */
  private adjustForDrawdown(
    drawdownState?: 'normal' | 'reduced' | 'paused'
  ): ReserveAdjustment | null {
    if (drawdownState === 'reduced') {
      return {
        amount: POSITION_SIZING.DRAWDOWN_RESERVE_INCREASE,
        reason: 'drawdown_reduced',
      };
    }
    if (drawdownState === 'paused') {
      return {
        amount: this.maxReserve - this.baseReserve,
        reason: 'drawdown_paused',
      };
    }
    return null;
  }

  /**
   * Adjust reserve based on position count
   */
  private adjustForPositionCount(
    positionCount: number,
    maxPositions: number
  ): ReserveAdjustment | null {
    if (maxPositions <= 0) {
      return null;
    }

    const positionRatio = positionCount / maxPositions;
    if (positionRatio >= POSITION_SIZING.HIGH_POSITION_COUNT_THRESHOLD) {
      return {
        amount: POSITION_SIZING.HIGH_POSITION_COUNT_RESERVE_INCREASE,
        reason: 'high_position_count',
      };
    }
    return null;
  }

  /**
   * Adjust reserve based on volatility (ATR)
   */
  private adjustForVolatility(atr14?: number, currentPrice?: number): ReserveAdjustment | null {
    if (!atr14 || !currentPrice || currentPrice <= 0) {
      return null;
    }

    const atrPercent = safeDivide(atr14, currentPrice, 6).toNumber();
    if (atrPercent > POSITION_SIZING.HIGH_VOLATILITY_THRESHOLD) {
      return {
        amount: POSITION_SIZING.HIGH_VOLATILITY_RESERVE_INCREASE,
        reason: 'high_volatility',
      };
    }
    if (atrPercent < POSITION_SIZING.LOW_VOLATILITY_THRESHOLD) {
      return {
        amount: -POSITION_SIZING.LOW_VOLATILITY_RESERVE_REDUCTION,
        reason: 'low_volatility',
      };
    }
    return null;
  }

  /**
   * Apply adjustment to reserve value
   */
  private applyAdjustment(reserve: number, adjustment: ReserveAdjustment): number {
    if (adjustment.reason === 'drawdown_paused') {
      return this.maxReserve;
    }
    return reserve + adjustment.amount;
  }
}

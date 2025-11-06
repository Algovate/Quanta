/**
 * Advanced Exit Strategies
 * Enhanced position management with breakeven plus, pyramiding, and adaptive exits
 */

import type { Position } from '../exchange/types.js';
import type { TechnicalIndicators } from '../types/index.js';

export interface ExitStrategy {
  /**
   * Calculate exit price or decision
   */
  evaluate(
    position: Position,
    currentPrice: number,
    rMultiple: number,
    indicators?: TechnicalIndicators
  ): ExitDecision;
}

export interface ExitDecision {
  action: 'hold' | 'close' | 'partial_close' | 'move_stop' | 'add_to_position';
  details?: {
    closePercent?: number;
    newStopPrice?: number;
    addSize?: number;
    reason: string;
  };
}

/**
 * Breakeven Plus Strategy
 * Moves stop to breakeven + small profit after reaching R-multiple threshold
 */
export class BreakevenPlusStrategy implements ExitStrategy {
  private readonly rMultipleThreshold: number;
  private readonly profitBuffer: number; // Additional profit to lock in (e.g., 0.5% = 0.005)

  constructor(rMultipleThreshold: number = 1.5, profitBuffer: number = 0.005) {
    this.rMultipleThreshold = rMultipleThreshold;
    this.profitBuffer = profitBuffer;
  }

  evaluate(
    position: Position,
    _currentPrice: number,
    rMultiple: number,
    _indicators?: TechnicalIndicators
  ): ExitDecision {
    if (rMultiple < this.rMultipleThreshold) {
      return { action: 'hold' };
    }

    // Check if already at breakeven plus
    const isLong = position.side === 'long';
    const entryPrice = position.entryPrice;
    const breakevenPlusPrice = isLong
      ? entryPrice * (1 + this.profitBuffer)
      : entryPrice * (1 - this.profitBuffer);

    // If current stop is already at or better than breakeven plus, hold
    if (position.trailingStopPrice) {
      const currentStop = position.trailingStopPrice;
      const isAlreadyBetter = isLong
        ? currentStop >= breakevenPlusPrice
        : currentStop <= breakevenPlusPrice;

      if (isAlreadyBetter) {
        return { action: 'hold' };
      }
    }

    // Move stop to breakeven plus
    return {
      action: 'move_stop',
      details: {
        newStopPrice: breakevenPlusPrice,
        reason: `Breakeven plus: ${(rMultiple * 100).toFixed(1)}R reached, moving stop to breakeven + ${(this.profitBuffer * 100).toFixed(1)}% profit`,
      },
    };
  }
}

/**
 * Pyramiding Strategy
 * Adds to winning positions at key R-multiple levels
 */
export class PyramidingStrategy implements ExitStrategy {
  private readonly addLevels: number[]; // R-multiple levels to add (e.g., [1.5, 2.5])
  private readonly addPercent: number; // Percentage of original position size to add

  constructor(addLevels: number[] = [1.5, 2.5], addPercent: number = 0.25) {
    this.addLevels = addLevels;
    this.addPercent = addPercent;
  }

  evaluate(
    position: Position,
    _currentPrice: number,
    rMultiple: number,
    indicators?: TechnicalIndicators
  ): ExitDecision {
    // Only pyramid if position is in profit
    if (rMultiple < 1.0) {
      return { action: 'hold' };
    }

    // Check if we're at a pyramid level
    for (const level of this.addLevels) {
      // Check if we're near this level (within 0.1R)
      if (Math.abs(rMultiple - level) < 0.1 && rMultiple >= level) {
        // Check if we've already pyramided at this level
        const alreadyPyramided = (position as any).pyramidLevels?.includes(level);

        if (!alreadyPyramided) {
          // Check if trend is still favorable (simplified check)
          const isLong = position.side === 'long';
          const isFavorable = indicators
            ? (isLong && indicators.ema20 > indicators.ema50) ||
              (!isLong && indicators.ema20 < indicators.ema50)
            : true; // Default to favorable if no indicators

          if (isFavorable) {
            const addSize = position.size * this.addPercent;

            // Logging would be done by caller

            // Mark this level as pyramided
            if (!(position as any).pyramidLevels) {
              (position as any).pyramidLevels = [];
            }
            (position as any).pyramidLevels.push(level);

            return {
              action: 'add_to_position',
              details: {
                addSize,
                reason: `Pyramiding: ${rMultiple.toFixed(2)}R reached, adding ${(this.addPercent * 100).toFixed(0)}% to position`,
              },
            };
          }
        }
      }
    }

    return { action: 'hold' };
  }
}

/**
 * Adaptive Trailing Stop Strategy
 * Adjusts trailing stop distance based on volatility and R-multiple
 */
export class AdaptiveTrailingStopStrategy implements ExitStrategy {
  private readonly baseDistance: number = 0.02; // 2% base trailing distance
  private readonly volatilityMultiplier: number = 1.5; // Multiply by ATR if high volatility

  constructor() {
    // No logger needed
  }

  evaluate(
    position: Position,
    currentPrice: number,
    rMultiple: number,
    indicators?: TechnicalIndicators
  ): ExitDecision {
    // Only activate trailing stop after reaching profit threshold
    if (rMultiple < 1.0) {
      return { action: 'hold' };
    }

    let trailingDistance = this.baseDistance;

    // Adjust based on volatility (ATR)
    if (indicators?.atr14 && currentPrice > 0) {
      const atrPercent = indicators.atr14 / currentPrice;
      // High volatility = wider trailing stop
      if (atrPercent > 0.03) {
        trailingDistance = this.baseDistance * this.volatilityMultiplier;
      } else if (atrPercent < 0.01) {
        // Low volatility = tighter trailing stop
        trailingDistance = this.baseDistance * 0.75;
      }
    }

    // Adjust based on R-multiple (higher R = tighter trailing for profit protection)
    if (rMultiple >= 3.0) {
      // Very profitable: use tighter trailing to protect profits
      trailingDistance = trailingDistance * 0.7;
    } else if (rMultiple >= 2.0) {
      // Moderately profitable: slightly tighter
      trailingDistance = trailingDistance * 0.85;
    }

    const isLong = position.side === 'long';
    const peakPrice = position.peakPrice || position.entryPrice;
    const newStopPrice = isLong
      ? peakPrice * (1 - trailingDistance)
      : peakPrice * (1 + trailingDistance);

    // Check if stop should be updated
    if (position.trailingStopPrice) {
      const currentStop = position.trailingStopPrice;
      const shouldUpdate = isLong
        ? newStopPrice > currentStop // For longs, move stop up
        : newStopPrice < currentStop; // For shorts, move stop down

      if (!shouldUpdate) {
        return { action: 'hold' };
      }
    }

    return {
      action: 'move_stop',
      details: {
        newStopPrice,
        reason: `Adaptive trailing stop: ${(rMultiple * 100).toFixed(1)}R, volatility-adjusted distance ${(trailingDistance * 100).toFixed(2)}%`,
      },
    };
  }
}

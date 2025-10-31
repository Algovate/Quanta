import { Position } from '../exchange/types.js';
import { calculatePositionPnl } from '../utils/symbol-utils.js';
import {
  safeDivide,
  safeMultiply,
  safeAdd,
  roundToPrecision,
  EXCHANGE_PRECISION,
} from '../utils/precision.js';

export interface PositionAggregates {
  totalPnl: number;
  totalUnleveredExposure: number;
  totalMarginUsed: number;
  positionCount: number;
}

/**
 * Aggregate position metrics in a single pass for performance
 * Uses precision-safe arithmetic to prevent floating-point errors
 * @param positions - Array of positions to aggregate
 * @returns Aggregated position metrics
 */
export function aggregatePositionMetrics(positions: Position[]): PositionAggregates {
  const aggregates = positions.reduce(
    (acc, pos) => {
      // Use precision-safe addition for all financial values
      // Exposure (unlevered) is computed as sum(size * markPrice) without leverage
      const positionExposure = safeMultiply(pos.size, pos.markPrice).toNumber();
      return {
        totalPnl: safeAdd(acc.totalPnl, pos.unrealizedPnl).toNumber(),
        totalUnleveredExposure: safeAdd(acc.totalUnleveredExposure, positionExposure).toNumber(),
        totalMarginUsed: safeAdd(acc.totalMarginUsed, pos.marginUsed).toNumber(),
        positionCount: acc.positionCount + 1,
      };
    },
    { totalPnl: 0, totalUnleveredExposure: 0, totalMarginUsed: 0, positionCount: 0 }
  );

  // Round aggregated values to USDT precision
  return {
    totalPnl: roundToPrecision(aggregates.totalPnl, EXCHANGE_PRECISION.USDT),
    totalUnleveredExposure: roundToPrecision(
      aggregates.totalUnleveredExposure,
      EXCHANGE_PRECISION.USDT
    ),
    totalMarginUsed: roundToPrecision(aggregates.totalMarginUsed, EXCHANGE_PRECISION.USDT),
    positionCount: aggregates.positionCount,
  };
}

/**
 * Calculate unrealized profit and loss for a position
 * Uses precision-safe arithmetic to prevent floating-point errors
 * @param position - The position to calculate P&L for
 * @param currentPrice - Current market price
 * @returns Unrealized P&L (positive for profit, negative for loss)
 */
export function calculateUnrealizedPnl(position: Position, currentPrice: number): number {
  // Use precision-safe P&L calculation
  return calculatePositionPnl(
    position.side,
    currentPrice,
    position.entryPrice,
    position.size,
    position.symbol
  );
}

/**
 * Calculate P&L as percentage of position value
 * Uses precision-safe arithmetic
 * @param position - The position to calculate P&L for
 * @param currentPrice - Current market price
 * @returns P&L percentage
 */
export function calculatePnlPercent(position: Position, currentPrice: number): number {
  const unrealizedPnl = calculateUnrealizedPnl(position, currentPrice);
  const positionValue = safeMultiply(position.size, position.entryPrice).toNumber();

  if (positionValue === 0) {
    return 0;
  }

  const pnlPercent = safeDivide(unrealizedPnl, positionValue, 4);
  return roundToPrecision(safeMultiply(pnlPercent, 100).toNumber(), 2);
}

/**
 * Calculate P&L percent relative to margin used (preferred for risk display)
 * Falls back to implied margin (entryValue / leverage) if marginUsed is 0
 */
export function calculatePnlPercentVsMargin(position: Position): number {
  const entryValue = position.size * position.entryPrice;
  const impliedMargin = position.leverage ? entryValue / position.leverage : 0;
  const marginBasis = position.marginUsed || impliedMargin;
  if (!marginBasis) return 0;
  return (position.unrealizedPnl / marginBasis) * 100;
}

/**
 * Calculate risk percentage (absolute value of P&L percentage)
 * @param position - The position to calculate risk for
 * @param currentPrice - Current market price
 * @returns Risk percentage
 */
export function calculateRiskPercent(position: Position, currentPrice: number): number {
  return Math.abs(calculatePnlPercent(position, currentPrice));
}

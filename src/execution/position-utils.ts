import { Position } from '../exchange/types.js';

export interface PositionAggregates {
  totalPnl: number;
  totalNotional: number;
  totalMarginUsed: number;
  positionCount: number;
}

/**
 * Aggregate position metrics in a single pass for performance
 * @param positions - Array of positions to aggregate
 * @returns Aggregated position metrics
 */
export function aggregatePositionMetrics(positions: Position[]): PositionAggregates {
  const aggregates = positions.reduce(
    (acc, pos) => ({
      totalPnl: acc.totalPnl + pos.unrealizedPnl,
      totalNotional: acc.totalNotional + pos.notional,
      totalMarginUsed: acc.totalMarginUsed + pos.marginUsed,
      positionCount: acc.positionCount + 1,
    }),
    { totalPnl: 0, totalNotional: 0, totalMarginUsed: 0, positionCount: 0 }
  );
  return aggregates;
}

/**
 * Calculate unrealized profit and loss for a position
 * @param position - The position to calculate P&L for
 * @param currentPrice - Current market price
 * @returns Unrealized P&L (positive for profit, negative for loss)
 */
export function calculateUnrealizedPnl(position: Position, currentPrice: number): number {
  if (position.side === 'long') {
    // For long positions: profit when price increases
    return (currentPrice - position.entryPrice) * position.size;
  } else {
    // For short positions: profit when price decreases
    return (position.entryPrice - currentPrice) * position.size;
  }
}

/**
 * Calculate P&L as percentage of position value
 * @param position - The position to calculate P&L for
 * @param currentPrice - Current market price
 * @returns P&L percentage
 */
export function calculatePnlPercent(position: Position, currentPrice: number): number {
  const unrealizedPnl = calculateUnrealizedPnl(position, currentPrice);
  const positionValue = position.size * position.entryPrice;
  return (unrealizedPnl / positionValue) * 100;
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

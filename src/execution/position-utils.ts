import { Position } from '../exchange/types.js';

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

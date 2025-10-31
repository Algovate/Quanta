/**
 * Shared position and account calculation utilities
 * Used by SimulatorExchange and BacktestExchange to ensure consistency
 */

import { Position, Account } from './types.js';
import { calculatePositionPnl } from '../utils/symbol-utils.js';
import { normalizeSymbol } from '../utils/symbol-utils.js';
import { CompletedTrade } from '../types/index.js';
import {
  safeMultiply,
  safeDivide,
  safeAdd,
  safeSubtract,
  roundToPrecision,
  EXCHANGE_PRECISION,
} from '../utils/precision.js';

/**
 * Calculate notional value for a position
 * Formula: notional = size * markPrice * leverage (matches real exchanges)
 * Uses precision-safe arithmetic
 */
export function calculateNotional(size: number, markPrice: number, leverage: number): number {
  // Use precision-safe multiplication: size * markPrice * leverage
  const result = safeMultiply(safeMultiply(size, markPrice), leverage);
  // Round to USDT precision since notional is typically in USDT
  return roundToPrecision(result.toNumber(), EXCHANGE_PRECISION.USDT);
}

/**
 * Calculate margin required for a position
 * Formula: margin = (size * price) / leverage
 * Uses precision-safe arithmetic to prevent division errors
 */
export function calculateMargin(size: number, price: number, leverage: number): number {
  if (leverage <= 0) {
    throw new Error('Leverage must be greater than zero');
  }

  // Use precision-safe division: (size * price) / leverage
  const positionValue = safeMultiply(size, price);
  const margin = safeDivide(positionValue, leverage);

  // Round to USDT precision since margin is in USDT
  return roundToPrecision(margin.toNumber(), EXCHANGE_PRECISION.USDT);
}

/**
 * Create a new position with proper calculations
 */
export function createPosition(
  symbol: string,
  side: 'long' | 'short',
  amount: number,
  price: number,
  leverage: number,
  timestamp: number
): Position {
  const normalizedSymbol = normalizeSymbol(symbol);
  const marginRequired = calculateMargin(amount, price, leverage);

  return {
    symbol: normalizedSymbol,
    side,
    size: amount,
    entryPrice: price,
    markPrice: price,
    unrealizedPnl: 0,
    marginUsed: marginRequired,
    notional: calculateNotional(amount, price, leverage),
    leverage,
    timestamp,
  };
}

/**
 * Update position with current market price
 * Recalculates unrealized P&L and notional value using precision-safe arithmetic
 */
export function updatePositionWithPrice(position: Position, currentPrice: number): void {
  position.markPrice = currentPrice;

  // Calculate P&L using precision-safe function
  position.unrealizedPnl = calculatePositionPnl(
    position.side,
    currentPrice,
    position.entryPrice,
    position.size,
    position.symbol
  );

  // Notional = position size * current price * leverage (matches real exchanges)
  position.notional = calculateNotional(position.size, currentPrice, position.leverage);
}

/**
 * Verify leverage consistency for a position
 * Checks if stored leverage matches calculated leverage from notional and margin
 */
export function verifyLeverageConsistency(position: Position): {
  isValid: boolean;
  stored: number;
  fromNotional: number;
  fromMargin: number;
} {
  if (position.marginUsed <= 0) {
    return {
      isValid: true,
      stored: position.leverage,
      fromNotional: position.leverage,
      fromMargin: position.leverage,
    };
  }

  const calculatedLeverageFromNotional = position.notional / (position.size * position.markPrice);
  const calculatedLeverageFromMargin =
    position.marginUsed > 0 ? position.notional / position.marginUsed : position.leverage;

  // Allow small numerical drift from precision and rounding
  const tolerance = 0.0005; // 5 bps
  const isNotionalMatch = Math.abs(position.leverage - calculatedLeverageFromNotional) <= tolerance;
  const isMarginMatch = Math.abs(position.leverage - calculatedLeverageFromMargin) <= tolerance;

  return {
    isValid: isNotionalMatch && isMarginMatch,
    stored: position.leverage,
    fromNotional: calculatedLeverageFromNotional,
    fromMargin: calculatedLeverageFromMargin,
  };
}

/**
 * Update account equity and related metrics
 *
 * Calculation formulas:
 * - Used Margin = sum of all position.marginUsed
 * - Unrealized P&L = sum of all position.unrealizedPnl
 * - Equity = Balance + Unrealized P&L
 * - Available Margin = Equity - Used Margin (cannot go below 0)
 * - Margin Ratio = Used Margin / Equity (0 if equity <= 0)
 */
export function updateAccountEquity(account: Account, positions: Position[]): void {
  // Reconcile used margin with current positions using precision-safe arithmetic
  let recalculatedUsedMargin = safeAdd(0, 0);
  for (const pos of positions) {
    recalculatedUsedMargin = safeAdd(recalculatedUsedMargin, pos.marginUsed || 0);
  }
  account.usedMargin = roundToPrecision(recalculatedUsedMargin.toNumber(), EXCHANGE_PRECISION.USDT);

  // Calculate total P&L from all open positions (unrealized) using precision-safe arithmetic
  let unrealizedPnl = safeAdd(0, 0);
  for (const pos of positions) {
    unrealizedPnl = safeAdd(unrealizedPnl, pos.unrealizedPnl);
  }
  const unrealizedPnlNum = roundToPrecision(unrealizedPnl.toNumber(), EXCHANGE_PRECISION.USDT);

  // Total equity = balance + unrealized P&L using precision-safe arithmetic
  account.equity = roundToPrecision(
    safeAdd(account.balance, unrealizedPnlNum).toNumber(),
    EXCHANGE_PRECISION.USDT
  );

  // Available margin = equity - used margin (margin locked in positions)
  const availableMarginCalc = safeSubtract(account.equity, account.usedMargin);
  account.availableMargin = Math.max(
    0,
    roundToPrecision(availableMarginCalc.toNumber(), EXCHANGE_PRECISION.USDT)
  );

  // Margin ratio = used margin / equity (using precision-safe division)
  if (account.equity > 0) {
    account.marginRatio = safeDivide(account.usedMargin, account.equity, 4).toNumber();
  } else {
    account.marginRatio = 0;
  }

  // Verify: equity - usedMargin = availableMargin (with tolerance for rounding)
  const diff = Math.abs(account.equity - account.usedMargin - account.availableMargin);
  if (diff > 0.01) {
    console.warn('Account calculation mismatch!', {
      equity: account.equity,
      usedMargin: account.usedMargin,
      availableMargin: account.availableMargin,
      balance: account.balance,
      unrealizedPnl: unrealizedPnlNum,
      diff,
    });
  }
}

/**
 * Calculate realized P&L for a position close
 * Uses precision-safe arithmetic
 */
export function calculateRealizedPnl(
  side: 'long' | 'short',
  exitPrice: number,
  entryPrice: number,
  size: number,
  symbol?: string
): number {
  return calculatePositionPnl(side, exitPrice, entryPrice, size, symbol);
}

/**
 * Create a completed trade record
 */
export function createCompletedTrade(
  position: Position,
  exitPrice: number,
  exitTime: number,
  tradeId: number,
  reason: 'signal' | 'stop_loss' | 'take_profit' | 'end_of_backtest' = 'signal'
): CompletedTrade {
  const realizedPnl = calculateRealizedPnl(
    position.side,
    exitPrice,
    position.entryPrice,
    position.size
  );

  return {
    id: `trade_${tradeId}`,
    symbol: position.symbol,
    side: position.side,
    entryTime: position.timestamp,
    exitTime,
    entryPrice: position.entryPrice,
    exitPrice,
    size: position.size,
    pnl: realizedPnl,
    pnlPercent: (realizedPnl / (position.size * position.entryPrice)) * 100,
    holdingPeriod: (exitTime - position.timestamp) / 1000, // Convert milliseconds to seconds
    reason,
  };
}

/**
 * Calculate average entry price when adding to an existing position
 */
export function calculateAverageEntryPrice(
  existingSize: number,
  existingEntryPrice: number,
  additionalSize: number,
  additionalPrice: number
): number {
  const totalValue = existingSize * existingEntryPrice + additionalSize * additionalPrice;
  const totalSize = existingSize + additionalSize;
  return totalValue / totalSize;
}

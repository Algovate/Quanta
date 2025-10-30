/**
 * Symbol utility functions for normalizing trading pair symbols
 */

import { safeSubtract, safeMultiply, roundToPrecision, EXCHANGE_PRECISION } from './precision.js';

/**
 * Normalizes a trading symbol by removing duplicate /USDT suffixes
 * @param symbol - The symbol to normalize (e.g., 'BTC/USDT/USDT' or 'ETH/USDT')
 * @returns Normalized symbol (e.g., 'BTC/USDT')
 *
 * @example
 * normalizeSymbol('BTC/USDT') // 'BTC/USDT'
 * normalizeSymbol('ETH/USDT/USDT') // 'ETH/USDT'
 * normalizeSymbol('BTC') // 'BTC'
 */
export function normalizeSymbol(symbol: string): string {
  return symbol.replace(/\/USDT\/USDT$/, '/USDT');
}

/**
 * Ensures a symbol has the /USDT suffix
 * @param symbol - The symbol to ensure has /USDT suffix
 * @returns Symbol with /USDT suffix
 *
 * @example
 * ensureUsdtSuffix('BTC') // 'BTC/USDT'
 * ensureUsdtSuffix('ETH/USDT') // 'ETH/USDT'
 * ensureUsdtSuffix('SOL/USDT/USDT') // 'SOL/USDT'
 */
export function ensureUsdtSuffix(symbol: string): string {
  let normalized = normalizeSymbol(symbol);

  if (!normalized.includes('/USDT')) {
    normalized = `${normalized}/USDT`;
  }

  return normalized;
}

/**
 * Calculates position P&L based on side (long or short)
 * Uses precision-safe arithmetic to prevent floating-point errors
 * @param side - Position side ('long' or 'short')
 * @param currentPrice - Current market price
 * @param entryPrice - Entry price of the position
 * @param size - Position size
 * @param symbol - Optional symbol for precision rounding (e.g., 'BTC/USDT')
 * @returns Unrealized profit/loss (rounded to USDT precision)
 *
 * @example
 * calculatePositionPnl('long', 100, 90, 10) // 100 (profit)
 * calculatePositionPnl('short', 90, 100, 10) // 100 (profit)
 */
export function calculatePositionPnl(
  side: 'long' | 'short',
  currentPrice: number,
  entryPrice: number,
  size: number,
  _symbol?: string
): number {
  let priceDiff: number;

  if (side === 'long') {
    // LONG: profit when currentPrice > entryPrice
    priceDiff = safeSubtract(currentPrice, entryPrice).toNumber();
  } else {
    // SHORT: profit when entryPrice > currentPrice
    priceDiff = safeSubtract(entryPrice, currentPrice).toNumber();
  }

  // Multiply price difference by size with precision
  const pnl = safeMultiply(priceDiff, size).toNumber();

  // Round to USDT precision (2 decimal places) since P&L is in USDT
  return roundToPrecision(pnl, EXCHANGE_PRECISION.USDT);
}

/**
 * Account validation utilities
 * Functions to validate account calculations and detect inconsistencies
 */

import { Account, Position } from '../types/index.js';
import { ACCOUNT_VALIDATION } from '../execution/constants.js';
import { aggregatePositionMetrics } from '../execution/position-utils.js';

/**
 * Validation result for account calculations
 */
export interface AccountValidationResult {
  isValid: boolean;
  equityCheck?: {
    isValid: boolean;
    accountEquity: number;
    calculatedEquity: number;
    balance: number;
    unrealizedPnl: number;
    diff: number;
  };
  marginCheck?: {
    isValid: boolean;
    accountAvailable: number;
    calculatedAvailable: number;
    equity: number;
    usedMargin: number;
    diff: number;
  };
}

/**
 * Validates account equity calculation: Equity = Balance + Unrealized P&L
 * @param account - The account to validate
 * @param positions - Current positions for calculating unrealized P&L
 * @returns Validation result
 */
export function validateAccountEquity(
  account: Account,
  positions: Position[]
): AccountValidationResult {
  const aggregates = aggregatePositionMetrics(positions);
  const unrealizedPnl = aggregates.totalPnl;
  const calculatedEquity = account.balance + unrealizedPnl;
  const equityDiff = Math.abs(account.equity - calculatedEquity);

  const isValid = equityDiff <= ACCOUNT_VALIDATION.EQUITY_TOLERANCE;

  return {
    isValid,
    equityCheck: {
      isValid,
      accountEquity: account.equity,
      calculatedEquity,
      balance: account.balance,
      unrealizedPnl,
      diff: equityDiff,
    },
  };
}

/**
 * Validates available margin calculation: Available Margin = Equity - Used Margin
 * @param account - The account to validate
 * @param totalMarginUsed - Sum of margin used by all positions
 * @returns Validation result
 */
export function validateAvailableMargin(
  account: Account,
  totalMarginUsed: number
): AccountValidationResult {
  const calculatedAvailableMargin = account.equity - totalMarginUsed;
  const availableMarginDiff = Math.abs(account.availableMargin - calculatedAvailableMargin);

  const isValid = availableMarginDiff <= ACCOUNT_VALIDATION.MARGIN_TOLERANCE;

  return {
    isValid,
    marginCheck: {
      isValid,
      accountAvailable: account.availableMargin,
      calculatedAvailable: calculatedAvailableMargin,
      equity: account.equity,
      usedMargin: totalMarginUsed,
      diff: availableMarginDiff,
    },
  };
}

/**
 * Comprehensive account validation combining equity and margin checks
 * @param account - The account to validate
 * @param positions - Current positions for calculating unrealized P&L
 * @param totalMarginUsed - Sum of margin used by all positions
 * @returns Combined validation result
 */
export function validateAccount(
  account: Account,
  positions: Position[],
  totalMarginUsed: number
): AccountValidationResult {
  const equityResult = validateAccountEquity(account, positions);
  const marginResult = validateAvailableMargin(account, totalMarginUsed);

  return {
    isValid: equityResult.isValid && marginResult.isValid,
    equityCheck: equityResult.equityCheck,
    marginCheck: marginResult.marginCheck,
  };
}

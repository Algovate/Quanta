/**
 * Price validation utilities
 * Ensures all prices used in calculations are valid and meet minimum requirements
 */

import { ACCOUNT_VALIDATION } from '../execution/constants.js';

/**
 * Check if a price is valid for trading calculations
 * @param price - Price to validate
 * @returns true if price is valid (finite and > MIN_VALID_PRICE)
 */
export function isValidPrice(price: number): boolean {
  return typeof price === 'number' && isFinite(price) && price > ACCOUNT_VALIDATION.MIN_VALID_PRICE;
}

/**
 * Validate price and throw error if invalid
 * @param price - Price to validate
 * @param context - Context for error message (e.g., 'getTicker', 'refreshMarks')
 * @returns The validated price
 * @throws Error if price is invalid
 */
export function validatePrice(price: number, context: string): number {
  if (!isValidPrice(price)) {
    throw new Error(
      `Invalid price in ${context}: ${price} (must be > ${ACCOUNT_VALIDATION.MIN_VALID_PRICE})`
    );
  }
  return price;
}

/**
 * Get valid price or throw error if missing/invalid
 * Strict validation for required prices - never returns 0 or invalid values
 * @param price - Price value (may be undefined, null, or invalid)
 * @param context - Context for error message
 * @returns The validated price
 * @throws Error if price is missing or invalid
 */
export function getValidPriceOrThrow(price: number | undefined | null, context: string): number {
  if (price === undefined || price === null) {
    throw new Error(`Missing price in ${context}: price is ${price}`);
  }
  return validatePrice(price, context);
}

/**
 * Get valid price with fallback to last known price
 * Used when price fetch fails but we have a previous valid price
 * @param newPrice - New price value (may be invalid)
 * @param lastKnownPrice - Last known valid price (may be undefined)
 * @param context - Context for error message
 * @returns Valid price (newPrice if valid, otherwise lastKnownPrice)
 * @throws Error if both newPrice and lastKnownPrice are invalid
 */
export function getValidPriceWithFallback(
  newPrice: number | undefined | null,
  lastKnownPrice: number | undefined | null,
  context: string
): number {
  // Try new price first
  if (newPrice !== undefined && newPrice !== null && isValidPrice(newPrice)) {
    return newPrice;
  }

  // Fall back to last known price
  if (lastKnownPrice !== undefined && lastKnownPrice !== null && isValidPrice(lastKnownPrice)) {
    return lastKnownPrice;
  }

  // Both invalid - throw error
  throw new Error(
    `No valid price available in ${context}: newPrice=${newPrice}, lastKnownPrice=${lastKnownPrice}`
  );
}

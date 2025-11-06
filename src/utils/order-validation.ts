/**
 * Order validation and rounding utilities
 * Handles quantity/price rounding, minQty/stepSize validation, and reduce-only logic
 */

import Decimal from 'decimal.js';
import type { Decimal as DecimalNamespace } from 'decimal.js';
import { roundToPrecision, safeMultiply } from './precision.js';
import { EXCHANGE_PRECISION } from './precision.js';

// Type assertion helper for Decimal constructor
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const DecimalConstructor = Decimal as any;

/**
 * Symbol metadata for order validation
 */
export interface SymbolMetadata {
  /** Minimum order quantity */
  minQty: number;
  /** Step size for quantity (lot size) */
  stepSize: number;
  /** Minimum notional value (in USDT) */
  minNotional: number;
  /** Price tick size */
  priceTick: number;
}

/**
 * Default symbol metadata (conservative defaults for backtest)
 * These match typical exchange requirements
 */
const DEFAULT_SYMBOL_METADATA: SymbolMetadata = {
  minQty: 0.001,
  stepSize: 0.001,
  minNotional: 5.0,
  priceTick: 0.01,
};

/**
 * Symbol-specific metadata (can be extended with exchange-specific data)
 */
const SYMBOL_METADATA: Record<string, Partial<SymbolMetadata>> = {
  'BTC/USDT': {
    minQty: 0.00001,
    stepSize: 0.00001,
    minNotional: 5.0,
    priceTick: 0.1,
  },
  'ETH/USDT': {
    minQty: 0.001,
    stepSize: 0.001,
    minNotional: 5.0,
    priceTick: 0.01,
  },
  'SOL/USDT': {
    minQty: 0.01,
    stepSize: 0.01,
    minNotional: 5.0,
    priceTick: 0.001,
  },
};

/**
 * Get symbol metadata, falling back to defaults
 */
export function getSymbolMetadata(symbol: string): SymbolMetadata {
  const normalized = symbol.toUpperCase();
  const custom = SYMBOL_METADATA[normalized] || {};
  return {
    ...DEFAULT_SYMBOL_METADATA,
    ...custom,
  };
}

/**
 * Round quantity to step size
 * For closes: floor (round down) to ensure we don't exceed position size
 * For opens: ceil (round up) to ensure we meet minimum requirements
 */
export function roundQuantity(
  quantity: number,
  stepSize: number,
  mode: 'floor' | 'ceil' | 'round' = 'round'
): number {
  if (quantity <= 0 || stepSize <= 0) {
    return 0;
  }

  const steps = new DecimalConstructor(quantity).div(stepSize);
  let roundedSteps: DecimalNamespace.Instance;

  switch (mode) {
    case 'floor':
      roundedSteps = steps.floor();
      break;
    case 'ceil':
      roundedSteps = steps.ceil();
      break;
    case 'round':
    default:
      roundedSteps = steps.round();
      break;
  }

  const rounded = roundedSteps.mul(stepSize);
  return roundToPrecision(rounded.toNumber(), 8);
}

/**
 * Round price to tick size
 */
export function roundPrice(price: number, priceTick: number): number {
  if (price <= 0 || priceTick <= 0) {
    return price;
  }

  const ticks = new DecimalConstructor(price).div(priceTick);
  const roundedTicks = ticks.round();
  const rounded = roundedTicks.mul(priceTick);
  return roundToPrecision(rounded.toNumber(), EXCHANGE_PRECISION.USDT);
}

/**
 * Validate and round order quantity
 * Returns validated quantity or 0 if invalid
 */
export function validateAndRoundQuantity(
  quantity: number,
  symbol: string,
  isClose: boolean = false
): number {
  if (quantity <= 0 || !isFinite(quantity)) {
    return 0;
  }

  const metadata = getSymbolMetadata(symbol);
  const mode = isClose ? 'floor' : 'ceil';
  const rounded = roundQuantity(quantity, metadata.stepSize, mode);

  // Check minimum quantity
  if (rounded < metadata.minQty) {
    return 0;
  }

  return rounded;
}

/**
 * Validate and round order price
 */
export function validateAndRoundPrice(price: number, symbol: string): number {
  if (price <= 0 || !isFinite(price)) {
    return price;
  }

  const metadata = getSymbolMetadata(symbol);
  return roundPrice(price, metadata.priceTick);
}

/**
 * Validate order notional value
 */
export function validateNotional(quantity: number, price: number, symbol: string): boolean {
  const metadata = getSymbolMetadata(symbol);
  const notional = safeMultiply(quantity, price).toNumber();
  return notional >= metadata.minNotional;
}

/**
 * Clamp reduce-only quantity to available position size
 * Returns the minimum of requested quantity and position size, rounded appropriately
 */
export function clampReduceOnlyQuantity(
  requestedQuantity: number,
  positionSize: number,
  symbol: string
): number {
  if (requestedQuantity <= 0 || positionSize <= 0) {
    return 0;
  }

  // Clamp to position size
  const clamped = Math.min(requestedQuantity, positionSize);

  // Round down (floor) for closes to ensure we don't exceed position
  const metadata = getSymbolMetadata(symbol);
  const rounded = roundQuantity(clamped, metadata.stepSize, 'floor');

  // Check minimum quantity
  if (rounded < metadata.minQty) {
    return 0;
  }

  return rounded;
}

/**
 * Validate order with full checks
 * Returns validation result with reason if invalid
 */
export interface OrderValidationResult {
  valid: boolean;
  reason?: string;
  validatedQuantity?: number;
  validatedPrice?: number;
  notional?: number;
}

export function validateOrder(
  symbol: string,
  _side: 'buy' | 'sell',
  quantity: number,
  price: number,
  options?: {
    isReduceOnly?: boolean;
    positionSize?: number;
  }
): OrderValidationResult {
  // Basic quantity validation
  if (quantity <= 0 || !isFinite(quantity)) {
    return { valid: false, reason: 'Invalid quantity' };
  }

  // Basic price validation
  if (price <= 0 || !isFinite(price)) {
    return { valid: false, reason: 'Invalid price' };
  }

  const metadata = getSymbolMetadata(symbol);

  // Round and validate quantity
  const isClose = options?.isReduceOnly ?? false;
  let validatedQuantity = validateAndRoundQuantity(quantity, symbol, isClose);

  // For reduce-only orders, clamp to position size
  if (options?.isReduceOnly && options?.positionSize !== undefined) {
    validatedQuantity = clampReduceOnlyQuantity(validatedQuantity, options.positionSize, symbol);
  }

  if (validatedQuantity <= 0) {
    return { valid: false, reason: 'Quantity below minimum after rounding' };
  }

  // Round price
  const validatedPrice = validateAndRoundPrice(price, symbol);

  // Check notional
  const notional = safeMultiply(validatedQuantity, validatedPrice).toNumber();
  if (notional < metadata.minNotional) {
    return {
      valid: false,
      reason: `Notional ${notional.toFixed(2)} below minimum ${metadata.minNotional}`,
      validatedQuantity,
      validatedPrice,
      notional,
    };
  }

  return {
    valid: true,
    validatedQuantity,
    validatedPrice,
    notional,
  };
}

/**
 * Attempt fallback rounding for invalid orders
 * Tries to round to next valid size if initial validation fails
 */
export function attemptFallbackRounding(
  symbol: string,
  quantity: number,
  price: number,
  isClose: boolean
): OrderValidationResult | null {
  const metadata = getSymbolMetadata(symbol);

  // Try rounding up (for opens) or down (for closes) to next valid step
  const mode = isClose ? 'floor' : 'ceil';
  const roundedQty = roundQuantity(quantity, metadata.stepSize, mode);

  if (roundedQty < metadata.minQty) {
    // Try minimum quantity
    const minQtyRounded = roundQuantity(metadata.minQty, metadata.stepSize, 'ceil');
    if (minQtyRounded >= metadata.minQty) {
      const notional = safeMultiply(minQtyRounded, price).toNumber();
      if (notional >= metadata.minNotional) {
        return {
          valid: true,
          validatedQuantity: minQtyRounded,
          validatedPrice: validateAndRoundPrice(price, symbol),
          notional,
        };
      }
    }
    return null;
  }

  const notional = safeMultiply(roundedQty, price).toNumber();
  if (notional >= metadata.minNotional) {
    return {
      valid: true,
      validatedQuantity: roundedQty,
      validatedPrice: validateAndRoundPrice(price, symbol),
      notional,
    };
  }

  return null;
}


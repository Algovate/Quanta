import assert from 'node:assert';
import {
  validateOrder,
  clampReduceOnlyQuantity,
  attemptFallbackRounding,
  roundQuantity,
  validateAndRoundQuantity,
  validateNotional,
  getSymbolMetadata,
} from '../src/utils/order-validation.js';

async function testRoundQuantity() {
  // Test floor rounding (for closes)
  assert.strictEqual(roundQuantity(0.123456, 0.001, 'floor'), 0.123);
  assert.strictEqual(roundQuantity(0.123999, 0.001, 'floor'), 0.123);

  // Test ceil rounding (for opens)
  assert.strictEqual(roundQuantity(0.123456, 0.001, 'ceil'), 0.124);
  assert.strictEqual(roundQuantity(0.123001, 0.001, 'ceil'), 0.124);

  // Test round rounding
  assert.strictEqual(roundQuantity(0.123456, 0.001, 'round'), 0.123);
  assert.strictEqual(roundQuantity(0.123999, 0.001, 'round'), 0.124);
}

async function testValidateAndRoundQuantity() {
  // Test valid quantity
  const validQty = validateAndRoundQuantity(0.5, 'ETH/USDT', false);
  assert(validQty > 0, 'Valid quantity should be > 0');

  // Test invalid quantity (below minQty)
  const invalidQty = validateAndRoundQuantity(0.0001, 'ETH/USDT', false);
  assert.strictEqual(invalidQty, 0, 'Invalid quantity should be 0');

  // Test close rounding (floor)
  const closeQty = validateAndRoundQuantity(0.123456, 'ETH/USDT', true);
  assert(closeQty > 0, 'Close quantity should be > 0');
  assert(closeQty <= 0.123456, 'Close quantity should be <= original');
}

async function testClampReduceOnlyQuantity() {
  // Test clamping to position size
  const clamped = clampReduceOnlyQuantity(0.5, 0.3, 'ETH/USDT');
  assert.strictEqual(clamped, 0.3, 'Should clamp to position size');

  // Test clamping with rounding
  const clampedRounded = clampReduceOnlyQuantity(0.123456, 0.1, 'ETH/USDT');
  assert(clampedRounded <= 0.1, 'Should clamp and round to position size');

  // Test zero result when below minQty
  const zeroResult = clampReduceOnlyQuantity(0.0001, 0.0001, 'ETH/USDT');
  assert.strictEqual(zeroResult, 0, 'Should return 0 when below minQty');
}

async function testValidateNotional() {
  // Test valid notional
  assert.strictEqual(validateNotional(0.5, 10000, 'ETH/USDT'), true);

  // Test invalid notional (below minNotional)
  assert.strictEqual(validateNotional(0.0001, 1000, 'ETH/USDT'), false);
}

async function testValidateOrder() {
  // Test valid order
  const valid = validateOrder('ETH/USDT', 'buy', 0.5, 10000, {
    isReduceOnly: false,
  });
  assert.strictEqual(valid.valid, true, 'Valid order should pass');
  assert(valid.validatedQuantity !== undefined, 'Should have validated quantity');
  assert(valid.validatedPrice !== undefined, 'Should have validated price');
  assert(valid.notional !== undefined, 'Should have notional');

  // Test invalid order (below minQty)
  const invalidQty = validateOrder('ETH/USDT', 'buy', 0.0001, 10000, {
    isReduceOnly: false,
  });
  assert.strictEqual(invalidQty.valid, false, 'Invalid quantity should fail');
  assert(invalidQty.reason !== undefined, 'Should have reason');

  // Test invalid order (below minNotional)
  const invalidNotional = validateOrder('ETH/USDT', 'buy', 0.001, 1000, {
    isReduceOnly: false,
  });
  assert.strictEqual(invalidNotional.valid, false, 'Invalid notional should fail');

  // Test reduce-only order
  const reduceOnly = validateOrder('ETH/USDT', 'sell', 0.5, 10000, {
    isReduceOnly: true,
    positionSize: 0.3,
  });
  assert.strictEqual(reduceOnly.valid, true, 'Reduce-only order should pass');
  assert(
    reduceOnly.validatedQuantity !== undefined &&
      reduceOnly.validatedQuantity <= 0.3,
    'Should clamp to position size'
  );
}

async function testAttemptFallbackRounding() {
  // Test fallback for close order
  const fallback = attemptFallbackRounding('ETH/USDT', 0.123456, 10000, true);
  assert(fallback !== null, 'Should attempt fallback');
  if (fallback) {
    assert.strictEqual(fallback.valid, true, 'Fallback should be valid');
    assert(fallback.validatedQuantity !== undefined, 'Should have validated quantity');
  }

  // Test fallback for open order
  const fallbackOpen = attemptFallbackRounding('ETH/USDT', 0.123456, 10000, false);
  assert(fallbackOpen !== null, 'Should attempt fallback for open');
  if (fallbackOpen) {
    assert.strictEqual(fallbackOpen.valid, true, 'Fallback should be valid');
  }
}

async function testGetSymbolMetadata() {
  // Test BTC metadata
  const btcMeta = getSymbolMetadata('BTC/USDT');
  assert.strictEqual(btcMeta.minQty, 0.00001, 'BTC should have correct minQty');
  assert.strictEqual(btcMeta.stepSize, 0.00001, 'BTC should have correct stepSize');

  // Test ETH metadata
  const ethMeta = getSymbolMetadata('ETH/USDT');
  assert.strictEqual(ethMeta.minQty, 0.001, 'ETH should have correct minQty');
  assert.strictEqual(ethMeta.stepSize, 0.001, 'ETH should have correct stepSize');

  // Test default metadata
  const defaultMeta = getSymbolMetadata('UNKNOWN/USDT');
  assert(defaultMeta.minQty > 0, 'Should have default minQty');
  assert(defaultMeta.stepSize > 0, 'Should have default stepSize');
  assert(defaultMeta.minNotional > 0, 'Should have default minNotional');
}

async function run() {
  try {
    await testRoundQuantity();
    await testValidateAndRoundQuantity();
    await testClampReduceOnlyQuantity();
    await testValidateNotional();
    await testValidateOrder();
    await testAttemptFallbackRounding();
    await testGetSymbolMetadata();
    console.log('All order validation tests passed');
  } catch (error) {
    console.error('Order validation test failed:', error);
    throw error;
  }
}

run();


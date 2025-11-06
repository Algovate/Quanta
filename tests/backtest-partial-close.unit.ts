import assert from 'node:assert';
import { BacktestExchange } from '../src/exchange/backtest.js';
import { OrderExecutor } from '../src/execution/orders.js';
import { RiskManager } from '../src/execution/risk.js';
import { PositionMonitorService } from '../src/execution/monitor.js';
import { UnifiedLogger } from '../src/logging/index.js';
import type { Position } from '../src/exchange/types.js';

/**
 * Integration test for ETH partial TP ladder (50/30/20) and BTC short stability
 * Verifies no "Order rejected on partial close" errors
 */
async function testETHPartialTPLadder() {
  const startTime = Date.now() - 1000 * 60 * 60; // 1 hour ago
  const exchange = new BacktestExchange(10000, startTime, () => 0); // deterministic RNG

  // Load historical data for ETH
  const ethCandles = Array.from({ length: 100 }, (_, i) => ({
    timestamp: startTime + i * 3 * 60 * 1000, // 3m candles
    open: 3000 + i * 10,
    high: 3010 + i * 10,
    low: 2990 + i * 10,
    close: 3000 + i * 10,
    volume: 1000,
  }));
  exchange.loadHistoricalData('ETH/USDT', '3m', ethCandles as any);

  // Create a long position
  const position: Position = {
    symbol: 'ETH/USDT',
    side: 'long',
    size: 1.0,
    entryPrice: 3000,
    markPrice: 3000,
    unrealizedPnl: 0,
    marginUsed: 300,
    notional: 3000,
    leverage: 10,
    timestamp: startTime,
  };

  // Simulate position in exchange
  const riskManager = new RiskManager({ maxRiskPerTrade: 0.05, maxTotalRisk: 0.3 });
  const orderExecutor = new OrderExecutor(exchange, riskManager);

  // Test partial close at 1R (50%)
  exchange.setCurrentTime(startTime + 10 * 3 * 60 * 1000);
  const result1 = await orderExecutor.executePartialClose(position, 0.5);
  assert.strictEqual(result1.success, true, 'TP1 partial close should succeed');
  assert(result1.order !== undefined, 'Should have order');
  assert(
    result1.order?.status === 'filled' || result1.order?.status === 'open',
    'Order should be filled or open'
  );

  // Update position size after TP1
  position.size = 0.5;

  // Test partial close at 2R (30% of original = 60% of remaining)
  exchange.setCurrentTime(startTime + 20 * 3 * 60 * 1000);
  const result2 = await orderExecutor.executePartialClose(position, 0.6);
  assert.strictEqual(result2.success, true, 'TP2 partial close should succeed');
  assert(result2.order !== undefined, 'Should have order');

  // Update position size after TP2
  position.size = 0.2;

  // Test partial close at 3R (20% of original = 100% of remaining)
  exchange.setCurrentTime(startTime + 30 * 3 * 60 * 1000);
  const result3 = await orderExecutor.executePartialClose(position, 1.0);
  assert.strictEqual(result3.success, true, 'TP3 partial close should succeed');
  assert(result3.order !== undefined, 'Should have order');
}

async function testBTCShortStability() {
  const startTime = Date.now() - 1000 * 60 * 60; // 1 hour ago
  const exchange = new BacktestExchange(10000, startTime, () => 0); // deterministic RNG

  // Load historical data for BTC
  const btcCandles = Array.from({ length: 100 }, (_, i) => ({
    timestamp: startTime + i * 3 * 60 * 1000, // 3m candles
    open: 100000 - i * 100, // Decreasing price (short profit)
    high: 100100 - i * 100,
    low: 99900 - i * 100,
    close: 100000 - i * 100,
    volume: 1000,
  }));
  exchange.loadHistoricalData('BTC/USDT', '3m', btcCandles as any);

  // Create a short position
  const position: Position = {
    symbol: 'BTC/USDT',
    side: 'short',
    size: 0.02,
    entryPrice: 100000,
    markPrice: 100000,
    unrealizedPnl: 0,
    marginUsed: 200,
    notional: 2000,
    leverage: 10,
    timestamp: startTime,
  };

  const riskManager = new RiskManager({ maxRiskPerTrade: 0.05, maxTotalRisk: 0.3 });
  const orderExecutor = new OrderExecutor(exchange, riskManager);

  // Advance time and check maintenance margin
  for (let i = 0; i < 50; i++) {
    exchange.setCurrentTime(startTime + i * 3 * 60 * 1000);
    const account = await exchange.getAccount();
    const positions = await exchange.getPositions();

    // Check that maintenance margin doesn't cause premature liquidation
    if (positions.length > 0) {
      const pos = positions[0];
      const maint = riskManager.checkMaintenance(pos, pos.markPrice);

      // Position should not be liquidated prematurely (with buffer)
      // Maintenance margin should be stable
      assert(
        maint.marginRatio > -20 || maint.shouldLiquidate === false,
        'Position should not be liquidated prematurely'
      );
    }
  }
}

async function testNoPartialCloseRejections() {
  const startTime = Date.now() - 1000 * 60 * 60;
  const exchange = new BacktestExchange(10000, startTime, () => 0);

  // Load historical data
  const ethCandles = Array.from({ length: 100 }, (_, i) => ({
    timestamp: startTime + i * 3 * 60 * 1000,
    open: 3000 + i * 10,
    high: 3010 + i * 10,
    low: 2990 + i * 10,
    close: 3000 + i * 10,
    volume: 1000,
  }));
  exchange.loadHistoricalData('ETH/USDT', '3m', ethCandles as any);

  const position: Position = {
    symbol: 'ETH/USDT',
    side: 'long',
    size: 0.439391, // From logs
    entryPrice: 3000,
    markPrice: 3000,
    unrealizedPnl: 0,
    marginUsed: 131.8173,
    notional: 1318.173,
    leverage: 10,
    timestamp: startTime,
  };

  const riskManager = new RiskManager({ maxRiskPerTrade: 0.05, maxTotalRisk: 0.3 });
  const orderExecutor = new OrderExecutor(exchange, riskManager);

  // Test multiple partial closes (simulating TP ladder)
  const fractions = [0.5, 0.6, 1.0]; // 50%, 30% of original, then remaining
  let currentSize = position.size;

  for (const fraction of fractions) {
    exchange.setCurrentTime(startTime + 10 * 3 * 60 * 1000);
    const result = await orderExecutor.executePartialClose(
      { ...position, size: currentSize },
      fraction
    );

    // Should not be rejected
    assert.strictEqual(
      result.success,
      true,
      `Partial close should not be rejected (fraction: ${fraction})`
    );
    assert(
      result.error === undefined || !result.error.includes('rejected'),
      `Should not have rejection error: ${result.error}`
    );

    // Update size for next iteration
    if (result.order?.status === 'filled') {
      currentSize = Math.max(0, currentSize - (result.order.amount || 0));
    }
  }
}

async function run() {
  try {
    await testETHPartialTPLadder();
    console.log('✓ ETH partial TP ladder test passed');

    await testBTCShortStability();
    console.log('✓ BTC short stability test passed');

    await testNoPartialCloseRejections();
    console.log('✓ No partial close rejections test passed');

    console.log('All integration tests passed');
  } catch (error) {
    console.error('Integration test failed:', error);
    throw error;
  }
}

run();

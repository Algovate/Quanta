import assert from 'node:assert';

async function testBacktestMarketOrderSlippageDeterministic() {
  const { BacktestExchange } = await import('../src/exchange/backtest.js');

  const start = Date.UTC(2024, 0, 1, 0, 0, 0);
  const candles = [{ timestamp: start, open: 100, high: 101, low: 99, close: 100, volume: 1000 }];

  // rng returns 1 → max slippage 0.0005 (0.05%)
  const rngMax = () => 1;
  const ex = new BacktestExchange(10000, start, rngMax);
  ex.loadHistoricalData('BTC/USDT_3m', candles as any);

  const order = await ex.placeOrder('BTC/USDT', 'buy', 1);
  assert.strictEqual(order.status, 'filled');
  const expectedPrice = 100 * (1 + 0.0005);
  assert.ok(Math.abs(order.price - expectedPrice) < 1e-10);
}

async function run() {
  try {
    await testBacktestMarketOrderSlippageDeterministic();
    // eslint-disable-next-line no-console
    console.log('✓ backtest slippage capped at 0.05% and deterministic');
  } catch (e) {
    // eslint-disable-next-line no-console
    console.error('✗ backtest slippage deterministic/capped test failed:', (e as Error)?.message);
    process.exitCode = 1;
  }
}

void run();

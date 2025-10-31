import assert from 'node:assert';

const { BacktestEngine } = await import('../src/core/backtest-engine.js');

async function testMetricsAreFinite() {
  const now = Date.now();
  const start = new Date(now - 2 * 60 * 60 * 1000).toISOString();
  const end = new Date(now - 60 * 60 * 1000).toISOString();

  const engine = new BacktestEngine({
    startDate: start,
    endDate: end,
    initialBalance: 10000,
    coins: ['BTC', 'ETH'],
    cyclePeriod: 3 * 60 * 1000,
    maxPositions: 2,
    leverage: 1,
    seed: 7,
  });

  const result = await engine.runBacktest();
  const m = result.metrics;
  assert.ok(Number.isFinite(m.totalReturn));
  assert.ok(Number.isFinite(m.totalPnL));
  assert.ok(Number.isFinite(m.annualizedReturn));
  assert.ok(Number.isFinite(m.sharpeRatio));
  assert.ok(Number.isFinite(m.maxDrawdown));
}

async function run() {
  try {
    await testMetricsAreFinite();
    console.log('✓ metrics finite and computed');
  } catch (e) {
    console.error('✗ metrics finite and computed:', (e as Error)?.message);
    process.exitCode = 1;
  }
}

void run();

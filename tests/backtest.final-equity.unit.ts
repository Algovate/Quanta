import assert from 'node:assert';

const { BacktestEngine } = await import('../src/core/backtest-engine.js');

async function testFinalEquityMatchesSnapshotsAndNoUnrealized() {
  const now = Date.now();
  const start = new Date(now - 2 * 60 * 60 * 1000).toISOString(); // 2h ago
  const end = new Date(now - 1 * 60 * 60 * 1000).toISOString(); // 1h ago

  const engine = new BacktestEngine({
    startDate: start,
    endDate: end,
    initialBalance: 10000,
    coins: ['BTC'],
    cyclePeriod: 3 * 60 * 1000,
    maxPositions: 2,
    leverage: 1,
    seed: 42,
  });

  const result = await engine.runBacktest();

  const last = result.equitySnapshots[result.equitySnapshots.length - 1];
  assert.ok(last, 'last snapshot should exist');
  assert.strictEqual(result.finalEquity, last.equity, 'finalEquity matches last snapshot');
  assert.strictEqual(result.finalBalance <= result.finalEquity, true);
}

async function run() {
  try {
    await testFinalEquityMatchesSnapshotsAndNoUnrealized();
    console.log('✓ final equity uses post-close snapshot');
  } catch (e) {
    console.error('✗ final equity uses post-close snapshot:', (e as Error)?.message);
    process.exitCode = 1;
  }
}

void run();

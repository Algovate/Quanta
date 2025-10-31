import assert from 'node:assert';

async function testBacktestFinalSnapshotAfterClose() {
  const { BacktestEngine } = await import('../src/core/backtest-engine.js');

  const start = new Date(Date.UTC(2024, 0, 1, 0, 0, 0)).toISOString();
  const end = new Date(Date.UTC(2024, 0, 1, 2, 0, 0)).toISOString(); // 2 hours

  const config = {
    startDate: start,
    endDate: end,
    initialBalance: 10000,
    coins: ['BTC'],
    cyclePeriod: 15 * 60 * 1000, // 15m
    maxPositions: 1,
    leverage: 1,
    seed: 42,
  } as any;

  const engine = new BacktestEngine(config);
  const result = await engine.runBacktest();

  const lastSnap = result.equitySnapshots[result.equitySnapshots.length - 1];
  assert.ok(lastSnap, 'last snapshot exists');
  assert.strictEqual(result.finalEquity, lastSnap.equity);
  assert.strictEqual(result.finalBalance, lastSnap.balance);
}

async function run() {
  try {
    await testBacktestFinalSnapshotAfterClose();
    // eslint-disable-next-line no-console
    console.log('✓ backtest records final snapshot after close');
  } catch (e) {
    // eslint-disable-next-line no-console
    console.error('✗ backtest final snapshot test failed:', (e as Error)?.message);
    process.exitCode = 1;
  }
}

void run();

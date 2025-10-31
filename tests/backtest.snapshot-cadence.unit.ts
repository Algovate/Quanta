import assert from 'node:assert';

const { BacktestEngine } = await import('../src/core/backtest-engine.js');

async function testSnapshotCadenceAlignedToStart() {
  const now = Date.now();
  const start = new Date(now - 2 * 60 * 60 * 1000).toISOString();
  const end = new Date(now - 60 * 60 * 1000).toISOString();

  const engine = new BacktestEngine({
    startDate: start,
    endDate: end,
    initialBalance: 10000,
    coins: ['BTC'],
    cyclePeriod: 3 * 60 * 1000,
    maxPositions: 0, // no trades needed for cadence
    leverage: 1,
    seed: 1,
  });

  const result = await engine.runBacktest();
  const stamps = result.equitySnapshots.map(s => s.timestamp);
  assert.ok(stamps.length >= 2, 'should have multiple snapshots');

  const startMs = new Date(start).getTime();
  const interval = 15 * 60 * 1000;

  // All snapshots should align to start modulo interval
  for (const ts of stamps) {
    const mod = (ts - startMs) % interval;
    assert.strictEqual(mod, 0);
  }
}

async function run() {
  try {
    await testSnapshotCadenceAlignedToStart();
    console.log('✓ snapshot cadence aligned to start');
  } catch (e) {
    console.error('✗ snapshot cadence aligned to start:', (e as Error)?.message);
    process.exitCode = 1;
  }
}

void run();

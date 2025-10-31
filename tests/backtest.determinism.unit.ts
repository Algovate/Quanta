import assert from 'node:assert';

const { BacktestEngine } = await import('../src/core/backtest-engine.js');

async function testDeterminismWithSeed() {
  const now = Date.now();
  const start = new Date(now - 3 * 60 * 60 * 1000).toISOString();
  const end = new Date(now - 2 * 60 * 60 * 1000).toISOString();

  const cfg = {
    startDate: start,
    endDate: end,
    initialBalance: 10000,
    coins: ['BTC', 'ETH'],
    cyclePeriod: 3 * 60 * 1000,
    maxPositions: 2,
    leverage: 1,
  } as const;

  const e1 = new BacktestEngine({ ...cfg, seed: 1234 });
  const e2 = new BacktestEngine({ ...cfg, seed: 1234 });
  const e3 = new BacktestEngine({ ...cfg, seed: 5678 });

  const r1 = await e1.runBacktest();
  const r2 = await e2.runBacktest();
  const r3 = await e3.runBacktest();

  assert.deepStrictEqual(r1.equitySnapshots, r2.equitySnapshots, 'same seed → same curve');
  // Different seeds should usually differ
  assert.notDeepStrictEqual(
    r1.equitySnapshots,
    r3.equitySnapshots,
    'different seed → different curve'
  );
}

async function run() {
  try {
    await testDeterminismWithSeed();
    console.log('✓ backtest determinism with seed');
  } catch (e) {
    console.error('✗ backtest determinism with seed:', (e as Error)?.message);
    process.exitCode = 1;
  }
}

void run();

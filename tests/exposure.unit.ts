import assert from 'node:assert';

const { aggregatePositionMetrics } = await import('../src/execution/position-utils.js');

async function testExposureIgnoresLeverage() {
  const positions = [
    {
      symbol: 'ETH/USDT',
      side: 'long',
      size: 0.5,
      entryPrice: 3000,
      markPrice: 3500,
      unrealizedPnl: (3500 - 3000) * 0.5,
      marginUsed: (0.5 * 3000) / 10,
      notional: 0.5 * 3500 * 10, // legacy field may include leverage
      leverage: 10,
      timestamp: Date.now(),
    },
  ];

  const agg = aggregatePositionMetrics(positions as any);
  // Exposure should be size * markPrice (no leverage)
  assert.strictEqual(agg.totalUnleveredExposure, 0.5 * 3500);
}

async function run() {
  try {
    await testExposureIgnoresLeverage();
    // eslint-disable-next-line no-console
    console.log('✓ exposure ignores leverage');
  } catch (e) {
    // eslint-disable-next-line no-console
    console.error('✗ exposure ignores leverage:', (e as Error)?.message);
    process.exitCode = 1;
  }
}

void run();



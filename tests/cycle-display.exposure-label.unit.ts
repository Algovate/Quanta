import assert from 'node:assert';

async function testUnleveredExposureLabel() {
  const { CycleDisplay } = await import('../src/core/display/cycle-display.js');
  const cd = new CycleDisplay();

  const out = cd.formatCycleSummary({
    runtime: '0m 10s',
    cycleCount: 1,
    signalsCount: 0,
    executedTrades: 0,
    rejectedSignals: 0,
    openPositions: 0,
    maxPositions: 6,
    efficiency: 100,
    account: { equity: 10000, availableMargin: 10000 } as any,
    positions: [],
    totalMarginUsed: 0,
    totalUnleveredExposure: 123.45,
    totalPnl: 0,
    totalPnlPercent: 0,
    unrealizedPnl: 0,
    unrealizedPnlPercent: 0,
    cyclePnl: 0,
    cyclePnlPercent: 0,
    realizedCyclePnl: 0,
    marginUsage: 0,
    riskLevel: 'LOW',
    averageLeverage: 0,
    winRate: 0,
    countdown: '3m',
  });

  // Plain text to avoid ANSI codes interfering
  const plain = cd.getPlainText(out);
  assert.ok(plain.includes('Unlevered Exposure:'), 'should show Unlevered Exposure label');
}

async function run() {
  try {
    await testUnleveredExposureLabel();
    // eslint-disable-next-line no-console
    console.log('✓ cycle display shows Unlevered Exposure');
  } catch (e) {
    // eslint-disable-next-line no-console
    console.error('✗ cycle display shows Unlevered Exposure:', (e as Error)?.message);
    process.exitCode = 1;
  }
}

void run();

import assert from 'node:assert';

const { RiskManager } = await import('../src/execution/risk.js');
const { PositionMonitorService } = await import('../src/execution/monitor.js');

async function testTakeProfitTriggers() {
  const risk = new RiskManager({
    maxRiskPerTrade: 0.02,
    maxTotalRisk: 0.3,
    maxPositions: 10,
    defaultStopLoss: 0.03,
    maxLeverage: 5,
    minLeverage: 1,
  });

  // Minimal stub for order executor (not used by shouldClosePosition)
  const stubOrderExecutor = {
    executeStopLoss: async () => ({ success: true }),
    executeTakeProfit: async () => ({ success: true }),
    executePartialClose: async () => ({ success: true }),
  } as any;

  const monitor = new PositionMonitorService(risk, stubOrderExecutor);

  const position = {
    symbol: 'BTC/USDT',
    side: 'long',
    size: 0.1,
    entryPrice: 100,
    markPrice: 106,
    unrealizedPnl: 0,
    marginUsed: 10,
    notional: 10,
    leverage: 1,
    timestamp: Date.now(),
    customTakeProfit: 105,
  } as any;

  const { shouldClose, reason } = monitor.shouldClosePosition(position, 106);
  assert.strictEqual(shouldClose, true);
  assert.ok(reason.includes('Take profit'));
}

async function run() {
  try {
    await testTakeProfitTriggers();
    console.log('✓ take-profit exit triggers when price crosses custom TP');
  } catch (e) {
    console.error('✗ exit plan TP test failed:', (e as Error)?.message);
    process.exitCode = 1;
  }
}

void run();

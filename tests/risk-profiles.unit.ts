import assert from 'node:assert';

const { createWorkflowDeps } = await import('../src/core/factories.js');

class MockExchange {
  getExchangeName() {
    return 'mock';
  }
}

async function testSwapClamping() {
  const exchange = new MockExchange();
  const config = {
    mode: 'paper',
    exchange: { name: 'hyperliquid', testnet: true, marketType: 'swap' },
    ai: { apiKey: 'sk-test', model: 'x', temperature: 0.7, prompt: {} },
    trading: {
      coins: ['BTC'],
      cyclePeriod: 180000,
      maxPositions: 10, // too high for swap → clamp to <=4
      leverageRange: [1, 40], // clamp to [3,10]
      stopLoss: 0.1, // clamp to <=0.02
      maxRisk: 0.1, // clamp to <=0.02
      marketFetchParallel: true,
      priceSanity: { enabled: true, maxDeviation: 0.05 },
      funding: { warnings: true },
    },
  } as any;

  const { workflowConfig } = createWorkflowDeps(exchange as any, config, ['BTC']);
  assert.strictEqual(workflowConfig.riskParams.minLeverage, 3);
  assert.strictEqual(workflowConfig.riskParams.maxLeverage, 10);
  assert.ok(
    workflowConfig.riskParams.defaultStopLoss >= 0.01 &&
      workflowConfig.riskParams.defaultStopLoss <= 0.02
  );
  assert.ok(
    workflowConfig.riskParams.maxRiskPerTrade >= 0.01 &&
      workflowConfig.riskParams.maxRiskPerTrade <= 0.02
  );
  assert.ok(workflowConfig.maxPositions <= 4);
}

async function testSpotDefaults() {
  const exchange = new MockExchange();
  const config = {
    mode: 'paper',
    exchange: { name: 'hyperliquid', testnet: true, marketType: 'spot' },
    ai: { apiKey: 'sk-test', model: 'x', temperature: 0.7, prompt: {} },
    trading: {
      coins: ['BTC'],
      cyclePeriod: 180000,
      maxPositions: 8, // within spot 6-10 band; should pass through
      leverageRange: [1, 5], // clamp up/down to [1,1]
      stopLoss: 0.04, // within 3-7%; should pass
      maxRisk: 0.04, // within 3-5%; should pass
      marketFetchParallel: true,
      priceSanity: { enabled: true, maxDeviation: 0.05 },
      funding: { warnings: true },
    },
  } as any;

  const { workflowConfig } = createWorkflowDeps(exchange as any, config, ['BTC']);
  assert.strictEqual(workflowConfig.riskParams.minLeverage, 1);
  assert.strictEqual(workflowConfig.riskParams.maxLeverage, 1);
  assert.strictEqual(workflowConfig.riskParams.defaultStopLoss, 0.04);
  assert.strictEqual(workflowConfig.riskParams.maxRiskPerTrade, 0.04);
  assert.strictEqual(workflowConfig.maxPositions, 8);
}

async function run() {
  try {
    await testSwapClamping();
    console.log('✓ swap clamping works');
    await testSpotDefaults();
    console.log('✓ spot defaults respected');
  } catch (e) {
    console.error('✗ risk profiles tests failed:', (e as Error)?.message);
    process.exitCode = 1;
  }
}

void run();

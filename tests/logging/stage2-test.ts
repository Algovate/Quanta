/**
 * Test runner for Stage 2 components
 */

import assert from 'node:assert';
import { Sampler } from '../../src/logging/sampler.js';
import { StorageLayer } from '../../src/logging/storage-layer.js';
import { UnifiedLogger } from '../../src/logging/unified-logger.js';
import { MetricsCollector } from '../../src/logging/metrics-collector.js';
import type { OperationLog } from '../../src/logging/types.js';

async function testSampler() {
  console.log('Testing Sampler...');
  const sampler = Sampler.getInstance();

  // Test default configuration
  const config = sampler.getConfig();
  assert.strictEqual(config.normal.operationLogRate, 1.0, 'Operations should always be logged');
  assert.strictEqual(config.normal.debugLogRate, 0.0, 'Debug should be off by default');

  // Test state evaluation
  sampler.forceState('normal');
  assert.strictEqual(sampler.getState(), 'normal', 'State should be normal');

  // Test sampling
  sampler.forceState('normal');
  const shouldLogOp = sampler.shouldLog('operation', false);
  assert.strictEqual(shouldLogOp, true, 'Operations should always log');

  const shouldLogDebug = sampler.shouldLog('debug', false);
  assert.strictEqual(shouldLogDebug, false, 'Debug should not log in normal state');

  // Test error logging (always allowed)
  const shouldLogError = sampler.shouldLog('debug', true);
  assert.strictEqual(shouldLogError, true, 'Errors should always log');

  console.log('✓ Sampler tests passed');
}

async function testStorageLayer() {
  console.log('Testing StorageLayer...');
  const storage = StorageLayer.getInstance();

  // Test operation storage
  const testOperation: OperationLog = {
    operationId: 'test-op-1',
    traceId: 'test-trace-1',
    cycleId: 1,
    operationType: 'test_operation',
    startTime: Date.now(),
    status: 'completed',
    input: { test: 'input' },
    output: { test: 'output' },
    stages: [],
    metrics: { duration: 100 },
  };

  await storage.storeOperation(testOperation);

  // Test retrieval from L0
  const l0Ops = storage.getOperationsFromL0(10);
  assert.ok(l0Ops.length > 0, 'Should have operations in L0');

  // Test L1 SQLite database
  const l1Ops = await storage.getOperationsFromL1({ cycleId: 1, limit: 10 });
  assert.ok(Array.isArray(l1Ops), 'Should return array from L1');
  if (l1Ops.length > 0) {
    assert.ok(l1Ops[0].operationId === 'test-op-1', 'Should retrieve stored operation from L1');
  }

  // Test L1 count
  const l1Count = await storage.getL1OperationCount({ cycleId: 1 });
  assert.ok(typeof l1Count === 'number', 'Should return count from L1');
  assert.ok(l1Count >= 0, 'L1 count should be non-negative');

  // Test L1 cycle IDs
  const l1CycleIds = await storage.getL1CycleIds();
  assert.ok(Array.isArray(l1CycleIds), 'Should return array of cycle IDs from L1');

  // Test retrieval by cycle (should include L1 data)
  const opsByCycle = await storage.getOperationsByCycle(1);
  assert.ok(Array.isArray(opsByCycle), 'Should return array of operations');
  assert.ok(opsByCycle.length > 0, 'Should have operations from L0 or L1');

  // Test stats (should include L1 data)
  const stats = await storage.getStats();
  assert.ok(stats.l0Size >= 0, 'Should have L0 stats');
  assert.ok(stats.l1Cycles >= 0, 'Should have L1 cycle count');
  assert.ok(stats.totalOperations >= 0, 'Should have total operations count');

  console.log('✓ StorageLayer tests passed');
  console.log(`  - L0 size: ${stats.l0Size}`);
  console.log(`  - L1 cycles: ${stats.l1Cycles}`);
  console.log(`  - Total operations: ${stats.totalOperations}`);
}

async function testUnifiedLogger() {
  console.log('Testing UnifiedLogger...');
  const logger = UnifiedLogger.getInstance();

  // Initialize
  logger.initialize();

  // Test trace context creation
  const traceContext = logger.createTraceContext(1);
  assert.ok(traceContext.traceId, 'Should generate trace ID');
  assert.strictEqual(traceContext.cycleId, 1, 'Should set cycle ID');

  // Test operation lifecycle
  const operationId = logger.startOperation(traceContext, 'test_operation', { input: 'test' });
  assert.ok(operationId, 'Should return operation ID');

  logger.startStage(operationId, 'stage1');
  await new Promise(resolve => setTimeout(resolve, 10));
  logger.completeStage(operationId, 'stage1', { output: 'stage1-output' });

  const completed = logger.completeOperation(operationId, 'completed', { result: 'success' });
  assert.ok(completed, 'Should complete operation');
  assert.strictEqual(completed.status, 'completed', 'Status should be completed');

  // Test metrics
  logger.recordCycleTime(1, 1000);
  logger.recordAPILatency('test.endpoint', 50);

  const metrics = logger.getMetricsSnapshot(1);
  assert.ok(metrics.timestamp > 0, 'Should have timestamp');
  assert.ok(metrics.performance.cycleTime.p50 >= 0, 'Should calculate cycle time stats');

  // Test error recording
  logger.recordError(new Error('Test error'), { cycleId: 1 });
  const errorRate = logger.getErrorRate();
  assert.ok(errorRate >= 0, 'Should calculate error rate');

  // Test snapshot creation
  const snapshot = logger.createSnapshot(
    1,
    {
      equity: 10000,
      balance: 10000,
      marginUsed: 0,
      availableMargin: 10000,
    },
    [],
    [],
    []
  );

  assert.ok(snapshot.snapshotId, 'Should create snapshot');
  assert.strictEqual(snapshot.cycleId, 1, 'Should set cycle ID');

  // Test operations retrieval
  const ops = await logger.getOperationsByCycle(1);
  assert.ok(Array.isArray(ops), 'Should return operations');

  // Test sampling
  const state = logger.getSamplingState();
  assert.ok(['normal', 'warning', 'critical'].includes(state), 'Should return valid state');

  const shouldLog = logger.shouldLog('operation', false);
  assert.strictEqual(typeof shouldLog, 'boolean', 'Should return boolean');

  console.log('✓ UnifiedLogger tests passed');
}

async function runAllTests() {
  console.log('\n=== Running Stage 2 Tests ===\n');

  try {
    await testSampler();
    await testStorageLayer();
    await testUnifiedLogger();

    console.log('\n=== All Stage 2 Tests Passed! ===\n');
    process.exit(0);
  } catch (error) {
    console.error('\n=== Test Failed ===');
    console.error(error);
    if (error instanceof Error) {
      console.error('Stack:', error.stack);
    }
    process.exit(1);
  }
}

runAllTests();

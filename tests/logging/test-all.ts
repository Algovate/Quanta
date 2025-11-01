/**
 * Simple test runner for logging components
 * Uses Node.js built-in modules
 */

import assert from 'node:assert';
import { OperationLogger } from '../../src/logging/operation-logger.js';
import { ErrorAggregator } from '../../src/logging/error-aggregator.js';
import { MetricsCollector } from '../../src/logging/metrics-collector.js';
import { StateSnapshotService } from '../../src/logging/state-snapshot.js';
import type { TraceContext } from '../../src/logging/types.js';

async function testOperationLogger() {
  console.log('Testing OperationLogger...');
  const logger = OperationLogger.getInstance();
  logger.reset();

  // Test basic operation
  const traceContext: TraceContext = {
    traceId: 'test-trace-1',
    cycleId: 1,
  };

  const operationId = logger.startOperation(
    traceContext,
    'test_operation',
    { input: 'test' },
    'BTC/USDT'
  );
  assert.ok(operationId, 'Operation ID should be generated');
  assert.strictEqual(operationId.length, 36, 'Operation ID should be UUID format');

  // Test stages
  logger.startStage(operationId, 'stage1', { input: 'stage1-input' });
  await new Promise(resolve => setTimeout(resolve, 10)); // Small delay
  logger.completeStage(operationId, 'stage1', { output: 'stage1-output' });

  const activeOps = logger.getActiveOperations();
  assert.strictEqual(activeOps.length, 1, 'Should have one active operation');
  assert.strictEqual(activeOps[0].stages.length, 1, 'Should have one stage');
  assert.strictEqual(activeOps[0].stages[0].status, 'completed', 'Stage should be completed');
  assert.ok(activeOps[0].stages[0].duration !== undefined, 'Stage should have duration');

  // Test completion
  let handlerCalled = false;
  logger.onOperationComplete(() => {
    handlerCalled = true;
  });

  const completed = logger.completeOperation(operationId, 'completed', { result: 'success' });
  assert.ok(completed, 'Operation should be completed');
  assert.strictEqual(completed.status, 'completed', 'Status should be completed');
  assert.ok(completed.metrics.duration >= 0, 'Duration should be calculated');
  assert.ok(handlerCalled, 'Handler should be called');

  // Test nested operations
  const parentId = logger.startOperation(traceContext, 'parent', {});
  const nestedContext = logger.createNestedContext(parentId);
  assert.strictEqual(nestedContext.parentOperationId, parentId, 'Should have parent ID');
  const childId = logger.startOperation(nestedContext, 'child', {});
  const allOps = logger.getActiveOperations();
  const childOp = allOps.find(op => op.operationId === childId);
  assert.ok(childOp, 'Child operation should exist');
  assert.strictEqual(childOp.parentOperationId, parentId, 'Child should reference parent');

  logger.completeOperation(parentId, 'completed', {});
  logger.completeOperation(childId, 'completed', {});

  console.log('✓ OperationLogger tests passed');
}

async function testErrorAggregator() {
  console.log('Testing ErrorAggregator...');
  const aggregator = ErrorAggregator.getInstance();
  aggregator.reset();

  // Test error recording
  const error = new Error('Test error');
  aggregator.recordError(error, {
    cycleId: 1,
    symbol: 'BTC/USDT',
    operationId: 'op-1',
  });

  const aggregated = aggregator.getAggregatedErrors();
  assert.strictEqual(aggregated.length, 1, 'Should have one aggregated error');
  assert.strictEqual(aggregated[0].errorType, 'Error', 'Error type should match');
  assert.strictEqual(aggregated[0].message, 'Test error', 'Error message should match');
  assert.strictEqual(aggregated[0].totalCount, 1, 'Should have one occurrence');
  assert.ok(aggregated[0].affectedSymbols.includes('BTC/USDT'), 'Should track affected symbol');
  assert.ok(aggregated[0].affectedCycles.includes(1), 'Should track affected cycle');

  // Test error aggregation
  for (let i = 0; i < 5; i++) {
    aggregator.recordError(error, {
      cycleId: i + 1,
      symbol: 'BTC/USDT',
    });
  }

  const aggregated2 = aggregator.getAggregatedErrors();
  assert.strictEqual(aggregated2.length, 1, 'Same errors should be aggregated');
  assert.strictEqual(aggregated2[0].totalCount, 6, 'Should have 6 total occurrences');

  // Test different errors
  const error2 = new Error('Different error');
  aggregator.recordError(error2, { cycleId: 10 });
  const aggregated3 = aggregator.getAggregatedErrors();
  assert.strictEqual(aggregated3.length, 2, 'Different errors should not be aggregated');

  // Test recovery tracking
  aggregator.recordRecoveryAttempt(error, false, 1);
  aggregator.recordRecoveryAttempt(error, true, 2);
  const final = aggregator.getAggregatedErrors();
  const errorEntry = final.find(e => e.message === 'Test error');
  assert.ok(errorEntry, 'Error entry should exist');
  assert.strictEqual(errorEntry.recoveryAttempts, 2, 'Should track recovery attempts');
  assert.strictEqual(errorEntry.recoverySuccess, true, 'Should track recovery success');

  aggregator.reset();
  console.log('✓ ErrorAggregator tests passed');
}

async function testMetricsCollector() {
  console.log('Testing MetricsCollector...');
  const collector = MetricsCollector.getInstance();
  collector.reset();

  // Test cycle time tracking
  collector.recordCycleTime(1, 1000);
  collector.recordCycleTime(2, 1500);
  collector.recordCycleTime(3, 800);
  collector.recordCycleTime(4, 2000);
  collector.recordCycleTime(5, 1200);

  const stats = collector.getCycleTimeStats();
  assert.ok(stats.p50 >= 0, 'p50 should be calculated');
  assert.ok(stats.p95 >= 0, 'p95 should be calculated');
  assert.ok(stats.avg >= 0, 'Average should be calculated');

  // Test error tracking
  collector.recordError('NetworkError', 1);
  collector.recordError('NetworkError', 2);
  collector.recordError('TimeoutError', 3);

  // Test API latency
  collector.recordAPILatency('exchange.getTicker', 50);
  collector.recordAPILatency('exchange.getTicker', 60);
  collector.recordAPILatency('exchange.getTicker', 70);

  // Test operation time
  collector.recordOperationTime('order_execution', 200);
  collector.recordOperationTime('order_execution', 250);

  // Test business metrics
  collector.recordSignalGeneration(true);
  collector.recordSignalGeneration(true);
  collector.recordSignalGeneration(false);

  collector.recordOrderExecution(true);
  collector.recordOrderExecution(false);
  collector.recordOrderExecution(true);

  collector.recordPositionProfitability(100);
  collector.recordPositionProfitability(-50);
  collector.recordPositionProfitability(200);

  // Test snapshot creation
  const snapshot = collector.createSnapshot(1);
  assert.ok(snapshot.timestamp > 0, 'Snapshot should have timestamp');
  assert.strictEqual(snapshot.cycleId, 1, 'Snapshot should have cycle ID');
  assert.ok(snapshot.errorRate.overall >= 0, 'Should calculate error rate');
  assert.ok(snapshot.performance.cycleTime.p50 >= 0, 'Should calculate cycle time stats');
  assert.ok(Object.keys(snapshot.performance.apiLatency).length > 0, 'Should have API latency');
  assert.ok(snapshot.business.signalGenerationSuccess > 0, 'Should calculate signal success');

  console.log('✓ MetricsCollector tests passed');
}

async function testStateSnapshotService() {
  console.log('Testing StateSnapshotService...');
  const service = StateSnapshotService.getInstance();
  service.reset();

  // Test basic snapshot creation
  const snapshot1 = service.createSnapshot(
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

  assert.ok(snapshot1.snapshotId, 'Snapshot should have ID');
  assert.strictEqual(snapshot1.cycleId, 1, 'Snapshot should have cycle ID');
  assert.strictEqual(snapshot1.account.equity, 10000, 'Snapshot should have account data');
  assert.ok(snapshot1.systemMetrics, 'Snapshot should have system metrics');

  // Test snapshot with positions
  const snapshot2 = service.createSnapshot(
    2,
    {
      equity: 10100,
      balance: 10050,
      marginUsed: 100,
      availableMargin: 10000,
    },
    [
      {
        symbol: 'BTC/USDT',
        side: 'long',
        size: 0.1,
        entryPrice: 45000,
        unrealizedPnl: 50,
      },
    ],
    [],
    []
  );

  assert.strictEqual(snapshot2.positions.length, 1, 'Snapshot should have positions');
  assert.ok(snapshot2.changes, 'Should calculate changes');
  assert.strictEqual(snapshot2.changes?.equityChange, 100, 'Should calculate equity change');
  assert.strictEqual(snapshot2.changes?.positionCountChange, 1, 'Should calculate position change');

  // Test queries
  const last = service.getLastSnapshot();
  assert.ok(last, 'Should get last snapshot');
  assert.strictEqual(last?.cycleId, 2, 'Last snapshot should be cycle 2');

  const byId = service.getSnapshotById(snapshot1.snapshotId);
  assert.ok(byId, 'Should get snapshot by ID');
  assert.strictEqual(byId?.snapshotId, snapshot1.snapshotId, 'Should match snapshot ID');

  const atCycle = service.getSnapshotAtCycle(1);
  assert.ok(atCycle, 'Should get snapshot at cycle');
  assert.strictEqual(atCycle?.cycleId, 1, 'Should match cycle ID');

  // Test handler notification
  let handlerCalled = false;
  service.onSnapshot(() => {
    handlerCalled = true;
  });

  service.createSnapshot(
    3,
    {
      equity: 10200,
      balance: 10100,
      marginUsed: 100,
      availableMargin: 10100,
    },
    [],
    [],
    []
  );

  assert.ok(handlerCalled, 'Handler should be called');

  service.reset();
  console.log('✓ StateSnapshotService tests passed');
}

async function runAllTests() {
  console.log('\n=== Running Logging System Tests ===\n');

  try {
    await testOperationLogger();
    await testErrorAggregator();
    await testMetricsCollector();
    await testStateSnapshotService();

    console.log('\n=== All Tests Passed! ===\n');
    process.exit(0);
  } catch (error) {
    console.error('\n=== Test Failed ===');
    console.error(error);
    process.exit(1);
  }
}

runAllTests();

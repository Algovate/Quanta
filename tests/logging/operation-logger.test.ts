/**
 * Tests for Operation Logger
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { OperationLogger } from '../../src/logging/operation-logger.js';
import type { TraceContext } from '../../src/logging/types.js';

describe('OperationLogger', () => {
  let logger: OperationLogger;

  beforeEach(() => {
    logger = OperationLogger.getInstance();
    logger.reset();
  });

  describe('startOperation', () => {
    it('should create a new operation with correct properties', () => {
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

      expect(operationId).toBeDefined();
      expect(operationId).toHaveLength(36); // UUID length

      const activeOps = logger.getActiveOperations();
      expect(activeOps).toHaveLength(1);
      expect(activeOps[0].operationType).toBe('test_operation');
      expect(activeOps[0].symbol).toBe('BTC/USDT');
      expect(activeOps[0].status).toBe('running');
    });

    it('should support nested operations', () => {
      const traceContext: TraceContext = {
        traceId: 'test-trace-1',
        cycleId: 1,
      };

      const parentId = logger.startOperation(traceContext, 'parent_operation', {});
      const nestedContext = logger.createNestedContext(parentId);

      expect(nestedContext.parentOperationId).toBe(parentId);
      expect(nestedContext.traceId).toBe('test-trace-1');
      expect(nestedContext.cycleId).toBe(1);

      const childId = logger.startOperation(nestedContext, 'child_operation', {});
      const activeOps = logger.getActiveOperations();
      expect(activeOps).toHaveLength(2);

      const childOp = activeOps.find(op => op.operationId === childId);
      expect(childOp?.parentOperationId).toBe(parentId);
    });
  });

  describe('operation stages', () => {
    it('should track operation stages', () => {
      const traceContext: TraceContext = {
        traceId: 'test-trace-1',
        cycleId: 1,
      };

      const operationId = logger.startOperation(traceContext, 'test_operation', {});
      logger.startStage(operationId, 'stage1', { input: 'stage1-input' });
      logger.completeStage(operationId, 'stage1', { output: 'stage1-output' });

      const activeOps = logger.getActiveOperations();
      const operation = activeOps[0];
      expect(operation.stages).toHaveLength(1);
      expect(operation.stages[0].stage).toBe('stage1');
      expect(operation.stages[0].status).toBe('completed');
      expect(operation.stages[0].duration).toBeDefined();
      expect(operation.stages[0].duration).toBeGreaterThanOrEqual(0);
    });

    it('should handle stage errors', () => {
      const traceContext: TraceContext = {
        traceId: 'test-trace-1',
        cycleId: 1,
      };

      const operationId = logger.startOperation(traceContext, 'test_operation', {});
      logger.startStage(operationId, 'error_stage');
      const error = new Error('Test error');
      logger.completeStage(operationId, 'error_stage', undefined, error);

      const activeOps = logger.getActiveOperations();
      const operation = activeOps[0];
      expect(operation.stages[0].status).toBe('failed');
      expect(operation.stages[0].error).toBeDefined();
      expect(operation.stages[0].error?.message).toBe('Test error');
    });
  });

  describe('completeOperation', () => {
    it('should complete an operation successfully', () => {
      const traceContext: TraceContext = {
        traceId: 'test-trace-1',
        cycleId: 1,
      };

      const operationId = logger.startOperation(traceContext, 'test_operation', {});
      const completed = logger.completeOperation(operationId, 'completed', { result: 'success' });

      expect(completed).toBeDefined();
      expect(completed?.status).toBe('completed');
      expect(completed?.output).toEqual({ result: 'success' });
      expect(completed?.endTime).toBeDefined();
      expect(completed?.metrics.duration).toBeGreaterThanOrEqual(0);

      const activeOps = logger.getActiveOperations();
      expect(activeOps).toHaveLength(0);
    });

    it('should notify handlers on completion', () => {
      const traceContext: TraceContext = {
        traceId: 'test-trace-1',
        cycleId: 1,
      };

      let handlerCalled = false;
      let receivedOperation: any = null;

      logger.onOperationComplete(op => {
        handlerCalled = true;
        receivedOperation = op;
      });

      const operationId = logger.startOperation(traceContext, 'test_operation', {});
      logger.completeOperation(operationId, 'completed', { result: 'success' });

      expect(handlerCalled).toBe(true);
      expect(receivedOperation).toBeDefined();
      expect(receivedOperation.status).toBe('completed');
    });
  });

  describe('context and tags', () => {
    it('should update operation context', () => {
      const traceContext: TraceContext = {
        traceId: 'test-trace-1',
        cycleId: 1,
      };

      const operationId = logger.startOperation(traceContext, 'test_operation', {});
      logger.updateOperationContext(operationId, {
        accountState: { equity: 10000 },
        systemState: { uptime: 1000 },
      });

      const activeOps = logger.getActiveOperations();
      expect(activeOps[0].context?.accountState).toEqual({ equity: 10000 });
      expect(activeOps[0].context?.systemState).toEqual({ uptime: 1000 });
    });

    it('should add tags to operations', () => {
      const traceContext: TraceContext = {
        traceId: 'test-trace-1',
        cycleId: 1,
      };

      const operationId = logger.startOperation(traceContext, 'test_operation', {});
      logger.addTags(operationId, 'trading', 'order', 'high-priority');

      const activeOps = logger.getActiveOperations();
      expect(activeOps[0].tags).toContain('trading');
      expect(activeOps[0].tags).toContain('order');
      expect(activeOps[0].tags).toContain('high-priority');
    });
  });

  describe('cleanup', () => {
    it('should cleanup stale operations', () => {
      const traceContext: TraceContext = {
        traceId: 'test-trace-1',
        cycleId: 1,
      };

      logger.startOperation(traceContext, 'test_operation', {});

      // Mock old timestamp - access internal state for testing
      const activeOps = logger.getActiveOperations();
      if (activeOps[0]) {
        // Note: We need to modify the internal timestamp for this test
        // This is a test-specific scenario that requires access to internal state
        const operation = activeOps[0];
        // Use Object.assign to modify the timestamp
        Object.assign(operation, { startTime: Date.now() - 400000 }); // 400 seconds ago
      }

      logger.cleanupStaleOperations(300000); // 300 seconds max age

      // Operation should be completed (failed due to timeout)
      const remainingOps = logger.getActiveOperations();
      expect(remainingOps).toHaveLength(0);
    });
  });
});

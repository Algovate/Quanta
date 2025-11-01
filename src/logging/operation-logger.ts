/**
 * Operation Logger - Records complete operation lifecycles
 *
 * Features:
 * - Operation-centric logging (not event-centric)
 * - Automatic operation nesting
 * - Complete context capture
 * - Stage-by-stage tracking
 */

import { randomUUID } from 'crypto';
import type {
  OperationLog,
  OperationStage,
  OperationStatus,
  TraceContext,
  ErrorInfo,
} from './types.js';
import { normalizeError } from './utils.js';

export class OperationLogger {
  private static instance: OperationLogger;
  private activeOperations: Map<string, OperationLog> = new Map();
  private operationHandlers: Array<(operation: OperationLog) => void> = [];

  private constructor() {}

  static getInstance(): OperationLogger {
    if (!OperationLogger.instance) {
      OperationLogger.instance = new OperationLogger();
    }
    return OperationLogger.instance;
  }

  /**
   * Register a handler to receive completed operations
   */
  onOperationComplete(handler: (operation: OperationLog) => void): void {
    this.operationHandlers.push(handler);
  }

  /**
   * Start a new operation
   */
  startOperation(
    traceContext: TraceContext,
    operationType: string,
    input: Record<string, any>,
    symbol?: string
  ): string {
    const operationId = randomUUID();
    const now = Date.now();

    const operation: OperationLog = {
      operationId,
      traceId: traceContext.traceId,
      cycleId: traceContext.cycleId,
      operationType,
      symbol,
      parentOperationId: traceContext.parentOperationId,
      startTime: now,
      status: 'running',
      input,
      stages: [],
      metrics: {
        duration: 0,
      },
    };

    this.activeOperations.set(operationId, operation);
    return operationId;
  }

  /**
   * Add a stage to an operation
   */
  startStage(operationId: string, stageName: string, input?: Record<string, any>): void {
    const operation = this.activeOperations.get(operationId);
    if (!operation) {
      console.warn(`Operation ${operationId} not found for stage ${stageName}`);
      return;
    }

    const stage: OperationStage = {
      stage: stageName,
      startTime: Date.now(),
      status: 'started',
      input,
    };

    operation.stages.push(stage);
  }

  /**
   * Complete a stage
   */
  completeStage(
    operationId: string,
    stageName: string,
    output?: Record<string, any>,
    error?: Error
  ): void {
    const operation = this.activeOperations.get(operationId);
    if (!operation) {
      return;
    }

    const stage = operation.stages.find(s => s.stage === stageName && s.status === 'started');
    if (!stage) {
      console.warn(`Stage ${stageName} not found in operation ${operationId}`);
      return;
    }

    const endTime = Date.now();
    stage.endTime = endTime;
    stage.duration = endTime - stage.startTime;
    stage.status = error ? 'failed' : 'completed';
    stage.output = output;

    if (error) {
      stage.error = this.formatError(error);
    }
  }

  /**
   * Complete an operation
   */
  completeOperation(
    operationId: string,
    status: OperationStatus,
    output?: Record<string, any>,
    error?: Error
  ): OperationLog | null {
    const operation = this.activeOperations.get(operationId);
    if (!operation) {
      console.warn(`Operation ${operationId} not found`);
      return null;
    }

    const endTime = Date.now();
    operation.endTime = endTime;
    operation.status = status;
    operation.output = output;
    operation.metrics.duration = endTime - operation.startTime;

    if (error) {
      operation.error = this.formatError(error);
    }

    // Calculate resource usage if available
    if (typeof process !== 'undefined' && process.memoryUsage) {
      const memUsage = process.memoryUsage();
      operation.metrics.resourceUsage = {
        memory: Math.round(memUsage.heapUsed / 1024 / 1024), // MB
      };
    }

    this.activeOperations.delete(operationId);

    // Notify handlers
    for (const handler of this.operationHandlers) {
      try {
        handler(operation);
      } catch (error) {
        console.error('Error in operation handler:', error);
      }
    }

    return operation;
  }

  /**
   * Update operation context
   */
  updateOperationContext(
    operationId: string,
    context: {
      accountState?: Record<string, any>;
      marketState?: Record<string, any>;
      systemState?: Record<string, any>;
    }
  ): void {
    const operation = this.activeOperations.get(operationId);
    if (!operation) {
      return;
    }

    operation.context = {
      ...operation.context,
      ...context,
    };
  }

  /**
   * Add tags to an operation
   */
  addTags(operationId: string, ...tags: string[]): void {
    const operation = this.activeOperations.get(operationId);
    if (!operation) {
      return;
    }

    if (!operation.tags) {
      operation.tags = [];
    }
    operation.tags.push(...tags);
  }

  /**
   * Create a nested operation context
   */
  createNestedContext(operationId: string): TraceContext {
    const operation = this.activeOperations.get(operationId);
    if (!operation) {
      throw new Error(`Operation ${operationId} not found`);
    }

    return {
      traceId: operation.traceId,
      cycleId: operation.cycleId,
      parentOperationId: operationId,
    };
  }

  /**
   * Format error for logging
   */
  private formatError(error: Error | unknown): ErrorInfo {
    return normalizeError(error);
  }

  /**
   * Get active operations (for debugging)
   */
  getActiveOperations(): OperationLog[] {
    return Array.from(this.activeOperations.values());
  }

  /**
   * Reset logger state (for testing)
   * @internal
   */
  reset(): void {
    this.activeOperations.clear();
    this.operationHandlers = [];
  }

  /**
   * Cleanup stale operations (operations that should have completed but haven't)
   */
  cleanupStaleOperations(maxAge: number = 300000): void {
    const now = Date.now();
    const staleOps: string[] = [];

    for (const [operationId, operation] of this.activeOperations.entries()) {
      if (now - operation.startTime > maxAge) {
        staleOps.push(operationId);
      }
    }

    for (const operationId of staleOps) {
      const operation = this.activeOperations.get(operationId);
      if (operation) {
        console.warn(`Cleaning up stale operation: ${operationId}`, {
          type: operation.operationType,
          age: now - operation.startTime,
        });
        this.completeOperation(operationId, 'failed', undefined, new Error('Operation timeout'));
      }
    }
  }
}

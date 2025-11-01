/**
 * Unified Logger - Integrates all logging components
 *
 * This is the main interface for the new logging system.
 * It coordinates all components: Operation Logger, Error Aggregator,
 * Metrics Collector, State Snapshot, Sampler, Anomaly Detector, and Storage Layer.
 */

import { OperationLogger } from './operation-logger.js';
import { ErrorAggregator } from './error-aggregator.js';
import { MetricsCollector } from './metrics-collector.js';
import { StateSnapshotService } from './state-snapshot.js';
import { Sampler } from './sampler.js';
import { AnomalyDetector } from './anomaly-detector.js';
import { StorageLayer } from './storage-layer.js';
import { StorageOptimizer } from './storage-optimizer.js';
import type {
  TraceContext,
  OperationLog,
  SystemSnapshot,
  AggregatedError,
  MetricsSnapshot,
} from './types.js';
import type { AnomalyEvent } from './anomaly-detector.js';

export class UnifiedLogger {
  private static instance: UnifiedLogger;
  private operationLogger: OperationLogger;
  private errorAggregator: ErrorAggregator;
  private metricsCollector: MetricsCollector;
  private stateSnapshot: StateSnapshotService;
  private sampler: Sampler;
  private anomalyDetector: AnomalyDetector;
  private storageLayer: StorageLayer;
  private storageOptimizer: StorageOptimizer;
  private initialized: boolean = false;

  private constructor() {
    this.operationLogger = OperationLogger.getInstance();
    this.errorAggregator = ErrorAggregator.getInstance();
    this.metricsCollector = MetricsCollector.getInstance();
    this.stateSnapshot = StateSnapshotService.getInstance();
    this.sampler = Sampler.getInstance();
    this.anomalyDetector = AnomalyDetector.getInstance();
    this.storageLayer = StorageLayer.getInstance();
    this.storageOptimizer = StorageOptimizer.getInstance();
  }

  static getInstance(): UnifiedLogger {
    if (!UnifiedLogger.instance) {
      UnifiedLogger.instance = new UnifiedLogger();
    }
    return UnifiedLogger.instance;
  }

  /**
   * Initialize the logging system
   */
  initialize(): void {
    if (this.initialized) {
      return;
    }

    // Set up handlers
    this.operationLogger.onOperationComplete(operation => {
      // Queue operation for batch write
      this.storageOptimizer.queueOperation(operation);

      // Record operation time
      this.metricsCollector.recordOperationTime(
        operation.operationType,
        operation.metrics.duration
      );

      // Check if operation failed
      if (operation.status === 'failed' && operation.error) {
        this.errorAggregator.recordError(operation.error, {
          cycleId: operation.cycleId,
          symbol: operation.symbol,
          operationId: operation.operationId,
          context: operation.context,
        });

        // Record error in metrics
        this.metricsCollector.recordError(operation.error.type, operation.cycleId);
      }

      // Record business metrics
      if (operation.operationType === 'signal_generation') {
        this.metricsCollector.recordSignalGeneration(operation.status === 'completed');
      } else if (operation.operationType === 'order_execution') {
        this.metricsCollector.recordOrderExecution(operation.status === 'completed');
      }
    });

    // Set up error aggregation handlers
    this.errorAggregator.onAggregatedError(async () => {
      // Store aggregated errors periodically
      const allAggregated = this.errorAggregator.getAggregatedErrors();
      await this.storageLayer.storeAggregatedErrors(allAggregated);
    });

    // Set up snapshot handlers
    this.stateSnapshot.onSnapshot(snapshot => {
      // Queue snapshot for batch write
      this.storageOptimizer.queueSnapshot(snapshot);

      // Update metrics snapshot
      const metricsSnapshot = this.metricsCollector.createSnapshot(snapshot.cycleId);
      // Store metrics snapshot directly (non-blocking)
      this.storageLayer.storeMetricsSnapshot(metricsSnapshot).catch(err => {
        console.error('Error storing metrics snapshot:', err);
      });
    });

    // Set up anomaly detection handlers
    this.anomalyDetector.onAnomalyDetected(event => {
      console.warn(`[Anomaly] ${event.severity.toUpperCase()}: ${event.message}`, event.metrics);

      // Trigger additional actions based on anomaly type
      if (event.type === 'error_rate_spike' && event.severity === 'critical') {
        // Force save current state
        const lastSnapshot = this.stateSnapshot.getLastSnapshot();
        if (lastSnapshot) {
          this.storageLayer.storeSnapshot(lastSnapshot).catch(err => {
            console.error('Failed to save snapshot during anomaly:', err);
          });
        }
      }
    });

    this.initialized = true;
  }

  /**
   * Create trace context for a cycle
   */
  createTraceContext(cycleId: number): TraceContext {
    const traceId = `trace-${cycleId}-${Date.now()}`;
    return {
      traceId,
      cycleId,
    };
  }

  /**
   * Start an operation
   */
  startOperation(
    traceContext: TraceContext,
    operationType: string,
    input: Record<string, any>,
    symbol?: string
  ): string {
    return this.operationLogger.startOperation(traceContext, operationType, input, symbol);
  }

  /**
   * Complete an operation
   */
  completeOperation(
    operationId: string,
    status: 'completed' | 'failed' | 'cancelled',
    output?: Record<string, any>,
    error?: Error
  ): OperationLog | null {
    return this.operationLogger.completeOperation(operationId, status, output, error);
  }

  /**
   * Start a stage within an operation
   */
  startStage(operationId: string, stageName: string, input?: Record<string, any>): void {
    this.operationLogger.startStage(operationId, stageName, input);
  }

  /**
   * Complete a stage within an operation
   */
  completeStage(
    operationId: string,
    stageName: string,
    output?: Record<string, any>,
    error?: Error
  ): void {
    this.operationLogger.completeStage(operationId, stageName, output, error);
  }

  /**
   * Record API call latency
   */
  recordAPILatency(endpoint: string, latency: number): void {
    this.metricsCollector.recordAPILatency(endpoint, latency);
  }

  /**
   * Record cycle execution time
   */
  recordCycleTime(cycleId: number, duration: number): void {
    this.metricsCollector.recordCycleTime(cycleId, duration);
  }

  /**
   * Record error directly
   */
  recordError(
    error: Error | unknown,
    context: { cycleId: number; symbol?: string; operationId?: string }
  ): void {
    this.errorAggregator.recordError(error, {
      cycleId: context.cycleId,
      symbol: context.symbol,
      operationId: context.operationId,
    });
    this.metricsCollector.recordError(
      error instanceof Error ? error.constructor.name : 'UnknownError',
      context.cycleId
    );
  }

  /**
   * Create system snapshot
   */
  createSnapshot(
    cycleId: number,
    account: {
      equity: number;
      balance: number;
      marginUsed: number;
      availableMargin: number;
    },
    positions: Array<{
      symbol: string;
      side: string;
      size: number;
      entryPrice: number;
      unrealizedPnl: number;
    }>,
    circuitBreakers: Array<{
      name: string;
      state: 'CLOSED' | 'OPEN' | 'HALF_OPEN';
      failureCount: number;
      lastFailure?: number;
      lastSuccess?: number;
    }>,
    recentOperations: Array<{
      operationId: string;
      type: string;
      status: 'running' | 'completed' | 'failed' | 'cancelled';
      duration: number;
    }>
  ): SystemSnapshot {
    return this.stateSnapshot.createSnapshot(
      cycleId,
      account,
      positions,
      circuitBreakers,
      recentOperations
    );
  }

  /**
   * Get aggregated errors
   */
  getAggregatedErrors(): AggregatedError[] {
    return this.errorAggregator.getAggregatedErrors();
  }

  /**
   * Get current metrics snapshot
   */
  getMetricsSnapshot(cycleId?: number): MetricsSnapshot {
    return this.metricsCollector.createSnapshot(cycleId || 0);
  }

  /**
   * Get current error rate
   */
  getErrorRate(): number {
    return this.metricsCollector.getErrorRate();
  }

  /**
   * Get operations by cycle
   */
  async getOperationsByCycle(cycleId: number): Promise<OperationLog[]> {
    return this.storageLayer.getOperationsByCycle(cycleId);
  }

  /**
   * Get snapshot by ID
   */
  async getSnapshotById(snapshotId: string): Promise<SystemSnapshot | null> {
    return this.storageLayer.getSnapshotById(snapshotId);
  }

  /**
   * Check for anomalies
   */
  checkAnomalies(): AnomalyEvent[] {
    return this.anomalyDetector.checkForAnomalies();
  }

  /**
   * Get current sampling state
   */
  getSamplingState(): 'normal' | 'warning' | 'critical' {
    return this.sampler.getState();
  }

  /**
   * Should log based on log type
   */
  shouldLog(
    logType: 'operation' | 'system' | 'api' | 'debug',
    errorOccurred: boolean = false
  ): boolean {
    return this.sampler.shouldLog(logType, errorOccurred);
  }

  /**
   * Cleanup old data
   */
  async cleanup(maxCycles: number = 1000): Promise<void> {
    await this.storageLayer.cleanup(maxCycles);
  }
}

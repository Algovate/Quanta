/**
 * Unified Logger - Integrates all logging components
 *
 * This is the main interface for the new logging system.
 * It coordinates all components: Operation Logger, Error Aggregator,
 * Metrics Collector, State Snapshot, Sampler, and Storage Layer.
 */

import { OperationLogger } from './operation-logger.js';
import { ErrorAggregator } from './error-aggregator.js';
import { MetricsCollector } from './metrics-collector.js';
import { StateSnapshotService } from './state-snapshot.js';
import { Sampler } from './sampler.js';
import { StorageLayer } from './storage-layer.js';
import { StorageOptimizer } from './storage-optimizer.js';
import type {
  TraceContext,
  OperationLog,
  SystemSnapshot,
  AggregatedError,
  MetricsSnapshot,
  ValidationCheck,
  ValidationResults,
  DecisionPath,
  DataQualityInfo,
  DataQualityMetrics,
  DecisionMetrics,
  TextLog,
} from './types.js';

export class UnifiedLogger {
  private static instance: UnifiedLogger;
  private operationLogger: OperationLogger;
  private errorAggregator: ErrorAggregator;
  private metricsCollector: MetricsCollector;
  private stateSnapshot: StateSnapshotService;
  private sampler: Sampler;
  private storageLayer: StorageLayer;
  private storageOptimizer: StorageOptimizer;
  private initialized: boolean = false;
  private consoleInterceptionEnabled: boolean = false;
  private originalConsole: {
    log: typeof console.log;
    warn: typeof console.warn;
    error: typeof console.error;
  };
  private isLoggingInternally: boolean = false;

  private constructor() {
    this.operationLogger = OperationLogger.getInstance();
    this.errorAggregator = ErrorAggregator.getInstance();
    this.metricsCollector = MetricsCollector.getInstance();
    this.stateSnapshot = StateSnapshotService.getInstance();
    this.sampler = Sampler.getInstance();
    this.storageLayer = StorageLayer.getInstance();
    this.storageOptimizer = StorageOptimizer.getInstance();

    // Store original console methods
    this.originalConsole = {
      log: console.log.bind(console),
      warn: console.warn.bind(console),
      error: console.error.bind(console),
    };
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

    this.setupOperationHandlers();
    this.setupErrorAggregationHandlers();
    this.setupSnapshotHandlers();
    this.setupConsoleInterception();

    this.initialized = true;
  }

  /**
   * Set up console interception to capture all console output
   * NOTE: We capture console output to logs, but do NOT output to console.
   * This keeps the console clean - users can view captured logs via "quanta log console"
   */
  private setupConsoleInterception(): void {
    if (this.consoleInterceptionEnabled) {
      return;
    }

    // Wrap console.log - capture to logs only, do NOT output to console
    console.log = (...args: unknown[]) => {
      // Do NOT output to console - just capture to logs
      if (!this.isLoggingInternally) {
        const message = this.formatConsoleArgs(args);
        this.captureConsoleOutput('info', message);
      }
    };

    // Wrap console.warn - capture to logs only, do NOT output to console
    console.warn = (...args: unknown[]) => {
      // Do NOT output to console - just capture to logs
      if (!this.isLoggingInternally) {
        const message = this.formatConsoleArgs(args);
        this.captureConsoleOutput('warn', message);
      }
    };

    // Wrap console.error - capture to logs only, do NOT output to console
    console.error = (...args: unknown[]) => {
      // Do NOT output to console - just capture to logs
      if (!this.isLoggingInternally) {
        const message = this.formatConsoleArgs(args);
        this.captureConsoleOutput('error', message);
      }
    };

    this.consoleInterceptionEnabled = true;
  }

  /**
   * Format console arguments to string message
   */
  private formatConsoleArgs(args: unknown[]): string {
    return args
      .map(arg => {
        if (typeof arg === 'string') {
          return arg;
        }
        if (arg instanceof Error) {
          return arg.message;
        }
        try {
          return JSON.stringify(arg, null, 2);
        } catch {
          return String(arg);
        }
      })
      .join(' ');
  }

  /**
   * Capture console output to text logs
   */
  private captureConsoleOutput(level: 'info' | 'warn' | 'error', message: string): void {
    // Determine context based on message content
    let context = 'Console';
    const msg = message.toLowerCase();

    // Trading cycle context
    if (
      msg.includes('cycle') ||
      msg.includes('🔄') ||
      msg.includes('cycle summary') ||
      msg.includes('next cycle')
    ) {
      context = 'TradingCycle';
    }
    // Market data context
    else if (
      msg.includes('market data') ||
      msg.includes('fetched') ||
      msg.includes('candlestick') ||
      msg.includes('ticker') ||
      msg.includes('indicators') ||
      msg.includes('ema') ||
      msg.includes('rsi') ||
      msg.includes('macd')
    ) {
      context = 'MarketData';
    }
    // AI signal context
    else if (
      msg.includes('ai signal') ||
      msg.includes('generated') ||
      msg.includes('signals:') ||
      msg.includes('long') ||
      msg.includes('short') ||
      msg.includes('confidence:') ||
      msg.includes('reasoning:')
    ) {
      context = 'AISignal';
    }
    // Execution context
    else if (
      msg.includes('executed') ||
      msg.includes('position') ||
      msg.includes('order') ||
      msg.includes('leverage') ||
      msg.includes('margin') ||
      msg.includes('notional')
    ) {
      context = 'Execution';
    }
    // Account context
    else if (
      msg.includes('account') ||
      msg.includes('equity') ||
      msg.includes('available') ||
      msg.includes('used') ||
      msg.includes('p&l') ||
      msg.includes('unrealized') ||
      msg.includes('realized')
    ) {
      context = 'Account';
    }
    // Risk context
    else if (
      msg.includes('risk') ||
      msg.includes('margin usage') ||
      msg.includes('diversification') ||
      msg.includes('correlation') ||
      msg.includes('leverage') ||
      msg.includes('exposure')
    ) {
      context = 'Risk';
    }

    // Store in tiered storage (skip console output to avoid recursion)
    const logId = `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
    const plainMessage = this.stripAnsiCodes(message);

    const textLog: TextLog = {
      logId,
      timestamp: Date.now(),
      level,
      context,
      message: plainMessage,
      formattedMessage: message, // Keep ANSI codes for display
      metadata: {},
    };

    // Store asynchronously
    this.storageLayer.storeTextLog(textLog).catch(err => {
      // Use original console to avoid recursion
      this.originalConsole.error('Failed to store text log:', err);
    });
  }

  /**
   * Set up operation completion handlers
   */
  private setupOperationHandlers(): void {
    this.operationLogger.onOperationComplete(operation => {
      // Queue operation for batch write
      this.storageOptimizer.queueOperation(operation);

      // Record operation time
      this.metricsCollector.recordOperationTime(
        operation.operationType,
        operation.metrics.duration
      );

      // Handle operation errors
      if (operation.status === 'failed' && operation.error) {
        this.handleOperationError(operation);
      }

      // Record business metrics
      this.recordBusinessMetrics(operation);
    });
  }

  /**
   * Handle operation errors
   */
  private handleOperationError(operation: OperationLog): void {
    if (!operation.error) {
      return;
    }

    this.errorAggregator.recordError(operation.error, {
      cycleId: operation.cycleId,
      symbol: operation.symbol,
      operationId: operation.operationId,
      context: operation.context,
    });

    // Record error in metrics
    this.metricsCollector.recordError(operation.error.type, operation.cycleId);
  }

  /**
   * Record business-specific metrics based on operation type
   */
  private recordBusinessMetrics(operation: OperationLog): void {
    if (operation.operationType === 'signal_generation') {
      this.metricsCollector.recordSignalGeneration(operation.status === 'completed');
    } else if (operation.operationType === 'order_execution') {
      this.metricsCollector.recordOrderExecution(operation.status === 'completed');
    }
  }

  /**
   * Set up error aggregation handlers
   */
  private setupErrorAggregationHandlers(): void {
    this.errorAggregator.onAggregatedError(async () => {
      const allAggregated = this.errorAggregator.getAggregatedErrors();
      await this.storageLayer.storeAggregatedErrors(allAggregated);
    });
  }

  /**
   * Set up snapshot handlers
   */
  private setupSnapshotHandlers(): void {
    this.stateSnapshot.onSnapshot(snapshot => {
      // Queue snapshot for batch write
      this.storageOptimizer.queueSnapshot(snapshot);

      // Update and store metrics snapshot
      const metricsSnapshot = this.metricsCollector.createSnapshot(snapshot.cycleId);
      this.storageLayer.storeMetricsSnapshot(metricsSnapshot).catch(err => {
        console.error('Error storing metrics snapshot:', err);
      });
    });
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

    const errorType = this.extractErrorType(error);
    this.metricsCollector.recordError(errorType, context.cycleId);
  }

  /**
   * Extract error type from error object
   */
  private extractErrorType(error: Error | unknown): string {
    if (error instanceof Error) {
      return error.constructor.name;
    }
    return 'UnknownError';
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
   * Get operation by ID
   */
  getOperation(operationId: string): OperationLog | null {
    return this.operationLogger.getOperation(operationId);
  }

  /**
   * Append a choice to existing decision path or create new one
   */
  appendDecisionChoice(
    operationId: string,
    choice: {
      step: string;
      decision: string;
      reason: string;
      confidence?: number;
      threshold?: number;
      factors?: Record<string, any>;
    }
  ): void {
    const operation = this.getOperation(operationId);
    const existingChoices = operation?.decisionPath?.choices || [];

    this.recordDecisionPath(operationId, {
      choices: [...existingChoices, choice],
    });
  }

  /**
   * Get snapshot by ID
   */
  async getSnapshotById(snapshotId: string): Promise<SystemSnapshot | null> {
    return this.storageLayer.getSnapshotById(snapshotId);
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

  /**
   * Record validation check to a stage
   */
  recordValidationCheck(operationId: string, stageName: string, check: ValidationCheck): void {
    this.operationLogger.addValidationCheck(operationId, stageName, check);
  }

  /**
   * Record data quality info to a stage
   */
  recordDataQuality(operationId: string, stageName: string, qualityInfo: DataQualityInfo): void {
    this.operationLogger.addStageDataQuality(operationId, stageName, qualityInfo);
  }

  /**
   * Record decision metrics to a stage
   */
  recordDecisionMetrics(operationId: string, stageName: string, metrics: DecisionMetrics): void {
    this.operationLogger.addDecisionMetrics(operationId, stageName, metrics);
  }

  /**
   * Record validation results to an operation
   */
  recordValidationResult(operationId: string, validationResults: ValidationResults): void {
    this.operationLogger.addValidationResult(operationId, validationResults);
  }

  /**
   * Record decision path to an operation
   */
  recordDecisionPath(operationId: string, decisionPath: DecisionPath): void {
    this.operationLogger.addDecisionPath(operationId, decisionPath);
  }

  /**
   * Record data quality metrics to an operation
   */
  recordOperationDataQuality(operationId: string, dataQuality: DataQualityMetrics): void {
    this.operationLogger.addDataQuality(operationId, dataQuality);
  }

  /**
   * Aggregate validation checks from a stage into operation-level validation results
   */
  aggregateValidationResults(operationId: string, stageName: string): void {
    const operation = this.operationLogger.getOperation(operationId);
    if (!operation) {
      return;
    }

    const stage = operation.stages.find(s => s.stage === stageName);
    if (!stage?.validationChecks || stage.validationChecks.length === 0) {
      return;
    }

    const validationResults = this.createValidationResults(stage.validationChecks);
    this.recordValidationResult(operationId, validationResults);
  }

  /**
   * Create validation results from validation checks
   */
  private createValidationResults(checks: ValidationCheck[]): ValidationResults {
    const allPassed = checks.every(check => check.passed);
    return {
      passed: allPassed,
      checks: checks.map(check => ({
        check: check.name,
        passed: check.passed,
        reason: check.reason,
        details: check.details,
      })),
    };
  }

  /**
   * Strip ANSI color codes from string
   */
  private stripAnsiCodes(str: string): string {
    // eslint-disable-next-line no-control-regex
    return str.replace(/\u001b\[[0-9;]*m/g, '');
  }

  /**
   * Check if running in background mode (non-TTY)
   */
  isBackgroundMode(): boolean {
    return !process.stdout.isTTY;
  }

  /**
   * Get the original console methods (bypass interception)
   * Useful for minimal output that shouldn't be logged
   */
  getOriginalConsole(): {
    log: typeof console.log;
    warn: typeof console.warn;
    error: typeof console.error;
  } {
    return this.originalConsole;
  }

  /**
   * Log info message
   */
  info(message: string, metadata?: Record<string, any>, context?: string): void {
    this.logText('info', message, metadata, context);
  }

  /**
   * Log warn message
   */
  warn(message: string, metadata?: Record<string, any>, context?: string): void {
    this.logText('warn', message, metadata, context);
  }

  /**
   * Log error message
   */
  error(message: string, error?: Error, context?: string): void {
    const metadata = error
      ? {
          error: {
            type: error.constructor.name,
            message: error.message,
            stack: error.stack,
          },
        }
      : undefined;
    this.logText('error', message, metadata, context);
  }

  /**
   * Log debug message
   */
  debug(message: string, metadata?: Record<string, any>, context?: string): void {
    this.logText('debug', message, metadata, context);
  }

  /**
   * Internal method to log text messages
   */
  private logText(
    level: 'info' | 'warn' | 'error' | 'debug',
    message: string,
    metadata?: Record<string, any>,
    context?: string
  ): void {
    const logId = `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;

    // Extract plain text from formatted message (strip ANSI codes)
    const plainMessage = this.stripAnsiCodes(message);

    const textLog: TextLog = {
      logId,
      timestamp: Date.now(),
      level,
      context: context || 'UnifiedLogger',
      message: plainMessage, // Plain text for querying
      formattedMessage: message, // Formatted with ANSI codes for console display
      metadata: metadata || {},
    };

    // Store in tiered storage
    this.storageLayer.storeTextLog(textLog).catch(err => {
      this.originalConsole.error('Failed to store text log:', err);
    });

    // NOTE: We do NOT output to console here - all console output should go through
    // originalConsole.log() directly for minimal output, or through unifiedLogger
    // which stores logs that can be viewed via "quanta log console"
    // This prevents duplicate output and keeps console clean
  }

  /**
   * Shutdown logging services (stop intervals) to allow process to exit
   * This is useful for CLI commands that need to exit cleanly
   */
  shutdown(): void {
    // Stop all background intervals
    if (this.metricsCollector && typeof this.metricsCollector.stop === 'function') {
      this.metricsCollector.stop();
    }
    if (this.errorAggregator && typeof this.errorAggregator.stop === 'function') {
      this.errorAggregator.stop();
    }
    if (this.storageOptimizer && typeof this.storageOptimizer.stop === 'function') {
      this.storageOptimizer.stop();
    }
  }
}

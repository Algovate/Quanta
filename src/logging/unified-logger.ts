/**
 * Unified Logger - Integrates all logging components
 *
 * This is the main interface for the new logging system.
 * It coordinates all components: Operation Logger, Error Aggregator,
 * Metrics Collector, State Snapshot, Sampler, and Storage Layer.
 */

import { AsyncLocalStorage } from 'async_hooks';
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
  ExecutionDetails,
  APICallLog,
} from './types.js';
import { normalizeError } from './utils.js';

/**
 * Operation context tracked via AsyncLocalStorage
 */
interface OperationContext {
  operationId?: string;
  traceId?: string;
  cycleId?: number;
}

export class UnifiedLogger {
  private static instance: UnifiedLogger;

  // Constants
  private static readonly OPERATION_CONTEXT_MAP: Record<string, string> = {
    trading_cycle: 'TradingCycle',
    signal_generation: 'AISignal',
    order_execution: 'Execution',
    position_monitoring: 'Account',
    account_sync: 'Account',
    market_data: 'MarketData',
  };

  private static readonly SENSITIVE_HEADER_KEYS = [
    'authorization',
    'api-key',
    'api-secret',
    'x-api-key',
    'cookie',
    'token',
  ];

  private static readonly SENSITIVE_BODY_KEYS = [
    'password',
    'secret',
    'apiKey',
    'apiSecret',
    'token',
    'authorization',
  ];

  // Components
  private operationLogger: OperationLogger;
  private errorAggregator: ErrorAggregator;
  private metricsCollector: MetricsCollector;
  private stateSnapshot: StateSnapshotService;
  private sampler: Sampler;
  private storageLayer: StorageLayer;
  private storageOptimizer: StorageOptimizer;

  // State
  private initialized: boolean = false;
  private consoleInterceptionEnabled: boolean = false;
  private originalConsole: {
    log: typeof console.log;
    warn: typeof console.warn;
    error: typeof console.error;
  };
  private isLoggingInternally: boolean = false;
  private operationContextStorage: AsyncLocalStorage<OperationContext>;

  private constructor() {
    this.operationLogger = OperationLogger.getInstance();
    this.errorAggregator = ErrorAggregator.getInstance();
    this.metricsCollector = MetricsCollector.getInstance();
    this.stateSnapshot = StateSnapshotService.getInstance();
    this.sampler = Sampler.getInstance();
    this.storageLayer = StorageLayer.getInstance();
    this.storageOptimizer = StorageOptimizer.getInstance();
    this.operationContextStorage = new AsyncLocalStorage<OperationContext>();

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
   * Generate a unique log ID
   */
  private generateLogId(): string {
    return `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
  }

  /**
   * Get operation context from AsyncLocalStorage
   */
  private getOperationContext(): OperationContext | undefined {
    return this.operationContextStorage.getStore();
  }

  /**
   * Resolve context from operation type
   */
  private resolveContextFromOperation(operationType: string): string {
    return UnifiedLogger.OPERATION_CONTEXT_MAP[operationType] || 'Console';
  }

  /**
   * Capture console output to text logs
   */
  private captureConsoleOutput(level: 'info' | 'warn' | 'error', message: string): void {
    const opContext = this.getOperationContext();
    const context = this.determineContext(opContext);
    const cycleId = opContext?.cycleId ?? 0;

    const textLog: TextLog = {
      logId: this.generateLogId(),
      timestamp: Date.now(),
      level,
      context,
      message: this.stripAnsiCodes(message),
      formattedMessage: message, // Optional: Keep ANSI codes for display (not stored in DB)
      metadata: {},
      cycleId,
      operationId: opContext?.operationId,
      traceId: opContext?.traceId,
    };

    // Store asynchronously
    this.storageLayer.storeTextLog(textLog).catch(err => {
      // Use original console to avoid recursion
      this.originalConsole.error('Failed to store text log:', err);
    });
  }

  /**
   * Determine context from operation context
   */
  private determineContext(opContext?: OperationContext): string {
    if (!opContext?.operationId) {
      return 'Console';
    }

    const operation = this.operationLogger.getOperation(opContext.operationId);
    if (!operation) {
      return 'Console';
    }

    return this.resolveContextFromOperation(operation.operationType);
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
        // Use original console to avoid recursion
        this.originalConsole.error('Error storing metrics snapshot:', err);
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
    const operationId = this.operationLogger.startOperation(
      traceContext,
      operationType,
      input,
      symbol
    );

    // Set operation context in AsyncLocalStorage for this operation
    // Note: The context will be available in all async callbacks within the same async context
    // The caller should run the operation within AsyncLocalStorage.run() if they want context tracking
    this.operationContextStorage.enterWith({
      operationId,
      traceId: traceContext.traceId,
      cycleId: traceContext.cycleId,
    });

    return operationId;
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
   * Record full API call details (request/response)
   */
  recordAPICall(
    endpoint: string,
    method: string,
    request: {
      url: string;
      headers?: Record<string, string>;
      body?: Record<string, any>;
      params?: Record<string, any>;
    },
    response: {
      status?: number;
      statusText?: string;
      headers?: Record<string, string>;
      body?: Record<string, any>;
      data?: any;
    },
    latency: number,
    error?: Error
  ): void {
    // Record latency for metrics
    this.metricsCollector.recordAPILatency(endpoint, latency);

    const opContext = this.getOperationContext();
    if (!opContext?.operationId) {
      return;
    }

    // Record full API call details as operation stage metadata
    const apiCallLog: APICallLog = {
      apiCallId: this.generateLogId(),
      timestamp: Date.now(),
      endpoint,
      method,
      request: {
        url: request.url,
        headers: this.sanitizeHeaders(request.headers),
        body: request.body ? this.sanitizeBody(request.body) : undefined,
        params: request.params,
      },
      response: {
        status: response.status,
        statusText: response.statusText,
        headers: this.sanitizeHeaders(response.headers),
        body: response.body ? this.sanitizeBody(response.body) : undefined,
        data: response.data ? this.sanitizeBody(response.data) : undefined,
      },
      latency,
      error: error ? normalizeError(error) : undefined,
      cycleId: opContext.cycleId ?? 0,
      operationId: opContext.operationId,
      traceId: opContext.traceId,
    };

    // Store as metadata in the current operation stage
    this.addAPICallToCurrentStage(opContext.operationId, apiCallLog);
  }

  /**
   * Add API call log to the current operation stage
   */
  private addAPICallToCurrentStage(operationId: string, apiCallLog: APICallLog): void {
    const operation = this.operationLogger.getOperation(operationId);
    if (!operation?.stages.length) {
      return;
    }

    const currentStage = operation.stages[operation.stages.length - 1];
    if (!currentStage) {
      return;
    }

    currentStage.metadata = {
      ...(currentStage.metadata || {}),
      apiCalls: [...(currentStage.metadata?.apiCalls || []), apiCallLog],
    };
  }

  /**
   * Check if a key matches any sensitive key pattern
   * Uses exact match or prefix matching to avoid false positives
   */
  private isSensitiveKey(key: string, sensitiveKeys: readonly string[]): boolean {
    const lowerKey = key.toLowerCase();
    return sensitiveKeys.some(sk => {
      // Exact match
      if (lowerKey === sk) {
        return true;
      }
      // Prefix match with separator (e.g., "authorization", "x-api-key")
      if (lowerKey.startsWith(`${sk}-`) || lowerKey.startsWith(`${sk}_`)) {
        return true;
      }
      // Contains as word (for headers like "X-Authorization-Header")
      // This is more permissive but catches cases like "authorization-token"
      if (lowerKey.includes(`-${sk}-`) || lowerKey.includes(`_${sk}_`)) {
        return true;
      }
      return false;
    });
  }

  /**
   * Sanitize headers to remove sensitive information
   */
  private sanitizeHeaders(headers?: Record<string, string>): Record<string, string> | undefined {
    if (!headers) {
      return undefined;
    }

    const sanitized: Record<string, string> = {};
    for (const [key, value] of Object.entries(headers)) {
      sanitized[key] = this.isSensitiveKey(key, UnifiedLogger.SENSITIVE_HEADER_KEYS)
        ? '[REDACTED]'
        : value;
    }

    return sanitized;
  }

  /**
   * Sanitize request/response body to remove sensitive information
   */
  private sanitizeBody(body: Record<string, any> | any[]): any {
    if (Array.isArray(body)) {
      return body.map(item => this.sanitizeBody(item));
    }

    if (typeof body !== 'object' || body === null) {
      return body;
    }

    const sanitized: Record<string, any> = {};
    for (const [key, value] of Object.entries(body)) {
      if (this.isSensitiveKey(key, UnifiedLogger.SENSITIVE_BODY_KEYS)) {
        sanitized[key] = '[REDACTED]';
      } else if (typeof value === 'object' && value !== null) {
        sanitized[key] = this.sanitizeBody(value);
      } else {
        sanitized[key] = value;
      }
    }

    return sanitized;
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
   * Record execution details to a stage
   */
  recordExecutionDetails(
    operationId: string,
    stageName: string,
    execution: ExecutionDetails
  ): void {
    this.operationLogger.addExecutionDetails(operationId, stageName, execution);
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
    const opContext = this.getOperationContext();
    const cycleId = opContext?.cycleId ?? 0;

    const textLog: TextLog = {
      logId: this.generateLogId(),
      timestamp: Date.now(),
      level,
      context: context || 'UnifiedLogger',
      message: this.stripAnsiCodes(message), // Plain text for querying
      formattedMessage: message, // Optional: formatted with ANSI codes (not stored in DB)
      metadata: metadata || {},
      cycleId,
      operationId: opContext?.operationId,
      traceId: opContext?.traceId,
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

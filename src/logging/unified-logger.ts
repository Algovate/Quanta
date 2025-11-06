/**
 * Unified Logger - Integrates all logging components
 *
 * This is the main interface for the new logging system.
 * It coordinates all components: Operation Logger, Error Aggregator,
 * Metrics Collector, State Snapshot, Sampler, and Storage Layer.
 */

import { AsyncLocalStorage } from 'async_hooks';
import { OperationLogger } from './operation-logger.js';
import { JsonlWriter } from './writers/jsonl-writer.js';
import { getConfig } from '../config/settings.js';
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
  private jsonlWriter: JsonlWriter<Record<string, unknown>>;

  // State
  private initialized: boolean = false;
  private operationContextStorage: AsyncLocalStorage<OperationContext>;

  private constructor() {
    this.operationLogger = OperationLogger.getInstance();
    // Initialize a simple JSONL writer for text logs (non-tiered)
    this.jsonlWriter = new JsonlWriter<{ [key: string]: unknown }>({
      directory: process.env.LOG_DIR || './logs/text',
      filePrefix: 'text-logs',
      retentionDays: 7,
    });
    this.operationContextStorage = new AsyncLocalStorage<OperationContext>();
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

    this.initialized = true;
  }

  /**
   * Generate a unique log ID
   */
  private generateLogId(): string {
    return `${Date.now()}-${Math.random().toString(36).slice(2, 11)}`;
  }

  /**
   * Get operation context from AsyncLocalStorage
   */
  private getOperationContext(): OperationContext | undefined {
    return this.operationContextStorage.getStore();
  }

  // Lite mode: no background handlers or aggregations

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
  recordAPILatency(_endpoint: string, _latency: number): void {}

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
    // Lite mode: no metrics collection

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
  recordCycleTime(_cycleId: number, _duration: number): void {}

  /**
   * Record error directly
   */
  recordError(
    _error: Error | unknown,
    _context: { cycleId: number; symbol?: string; operationId?: string }
  ): void {}

  // Lite mode: no error type extraction helper needed

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
    return {
      snapshotId: this.generateLogId(),
      timestamp: Date.now(),
      cycleId,
      account,
      positions,
      systemMetrics: {
        uptime: 0,
        errorRate: 0,
        avgCycleTime: 0,
        memoryUsage: { heapUsed: 0, heapTotal: 0, rss: 0 },
      },
      circuitBreakers: circuitBreakers.map(cb => ({
        name: cb.name,
        state: cb.state,
        failureCount: cb.failureCount,
        lastFailure: cb.lastFailure,
        lastSuccess: cb.lastSuccess,
      })),
      recentOperations: recentOperations.map(op => ({
        operationId: op.operationId,
        type: op.type,
        status: op.status,
        duration: op.duration,
      })),
    };
  }

  /**
   * Get aggregated errors
   */
  getAggregatedErrors(): AggregatedError[] {
    return [];
  }

  /**
   * Get current metrics snapshot
   */
  getMetricsSnapshot(_cycleId?: number): MetricsSnapshot {
    return {
      timestamp: Date.now(),
      cycleId: 0,
      errorRate: { overall: 0, byType: {}, bySymbol: {}, trend: 'stable' },
      performance: {
        cycleTime: { p50: 0, p75: 0, p90: 0, p95: 0, p99: 0, avg: 0 },
        apiLatency: {},
        operationTime: {},
      },
      business: {
        signalGenerationSuccess: 0,
        orderExecutionSuccess: 0,
        positionProfitability: 0,
      },
    };
  }

  /**
   * Get current error rate
   */
  getErrorRate(): number {
    return 0;
  }

  /**
   * Get operations by cycle
   */
  async getOperationsByCycle(_cycleId: number): Promise<OperationLog[]> {
    // Not supported in Lite mode without tiered storage
    return [];
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
  async getSnapshotById(_snapshotId: string): Promise<SystemSnapshot | null> {
    // Not supported in Lite mode without tiered storage
    return null;
  }

  /**
   * Get current sampling state
   */
  getSamplingState(): 'normal' | 'warning' | 'critical' {
    return 'normal';
  }

  /**
   * Should log based on log type
   */
  shouldLog(
    _logType: 'operation' | 'system' | 'api' | 'debug',
    _errorOccurred: boolean = false
  ): boolean {
    return true;
  }

  /**
   * Cleanup old data
   */
  async cleanup(_maxCycles: number = 1000): Promise<void> {
    // No-op in Lite mode
    return;
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
   * Log info message
   *
   * Output routing (Scheme B):
   * - Default: Console only (text format, no context)
   * - Configurable via logging.output.info in config.json
   *
   * @param message - Log message
   * @param metadata - Optional metadata object
   * @param context - Optional context name
   */
  info(message: string, metadata?: Record<string, any>, context?: string): void {
    this.logText('info', message, metadata, context);
  }

  /**
   * Log warn message
   *
   * Output routing (Scheme B):
   * - Default: Console + File (text format, no context in console)
   * - Configurable via logging.output.warn in config.json
   *
   * @param message - Log message
   * @param metadata - Optional metadata object
   * @param context - Optional context name
   */
  warn(message: string, metadata?: Record<string, any>, context?: string): void {
    this.logText('warn', message, metadata, context);
  }

  /**
   * Log error message
   *
   * Output routing (Scheme B):
   * - Default: Console + File (text format, includes context and stack trace)
   * - Configurable via logging.output.error in config.json
   *
   * @param message - Log message
   * @param error - Optional Error object (stack trace will be included)
   * @param context - Optional context name
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
   *
   * Output routing (Scheme B):
   * - Default: File only (JSON format, includes full context)
   * - Configurable via logging.output.debug in config.json
   *
   * @param message - Log message
   * @param metadata - Optional metadata object
   * @param context - Optional context name
   */
  debug(message: string, metadata?: Record<string, any>, context?: string): void {
    this.logText('debug', message, metadata, context);
  }

  /**
   * Internal method to log text messages with smart routing (Scheme B)
   *
   * Routes logs to console and/or file based on configuration:
   * - Gets configuration from config.json (logging.output[level])
   * - Falls back to defaults if not configured
   * - Console output: Respects includeContext flag for formatting
   * - File output: Always includes full context for queryability
   *
   * @param level - Log level (info, warn, error, debug)
   * @param message - Log message
   * @param metadata - Optional metadata object
   * @param context - Optional context name
   */
  private logText(
    level: 'info' | 'warn' | 'error' | 'debug',
    message: string,
    metadata?: Record<string, any>,
    context?: string
  ): void {
    // Get configuration for this log level
    const config = getConfig();
    const loggingConfig = config.logging;

    // Default behavior if no output config is specified
    const defaultOutputConfig = {
      debug: { console: false, file: true, format: 'json' as const, includeContext: true },
      info: { console: true, file: false, format: 'text' as const, includeContext: false },
      warn: { console: true, file: true, format: 'text' as const, includeContext: false },
      error: {
        console: true,
        file: true,
        format: 'text' as const,
        includeContext: true,
        includeStack: true,
      },
    };

    // Use configured output or default
    const outputConfig = loggingConfig?.output?.[level];
    const levelConfig = outputConfig || defaultOutputConfig[level];

    // Get operation context
    const opContext = this.getOperationContext();
    const cycleId = opContext?.cycleId ?? 0;

    // Build simplified log structure
    const baseLog: TextLog = {
      timestamp: Date.now(),
      level,
      context: context || 'UnifiedLogger',
      message: this.stripAnsiCodes(message), // Plain text for querying
      metadata: {
        formattedMessage: message, // Keep ANSI codes for display
        cycleId,
        ...(opContext?.operationId && { operationId: opContext.operationId }),
        ...(opContext?.traceId && { traceId: opContext.traceId }),
        ...(metadata || {}), // Merge user-provided metadata
      },
    };

    // Route to console if configured
    if (levelConfig.console) {
      this.outputToConsole(level, baseLog, {
        format: levelConfig.format || 'text',
        includeContext: levelConfig.includeContext ?? false,
      });
    }

    // Route to file if configured
    // File output always includes context for queryability, regardless of includeContext flag
    if (levelConfig.file && loggingConfig?.fileOutput !== false) {
      this.outputToFile(baseLog);
    }
  }

  /**
   * Output log to console
   */
  private outputToConsole(
    level: 'info' | 'warn' | 'error' | 'debug',
    log: TextLog,
    config: { format: 'json' | 'text'; includeContext?: boolean }
  ): void {
    const includeContext = config.includeContext ?? false;
    const metadata = log.metadata || {};

    if (config.format === 'json') {
      // JSON format: output structured JSON
      const jsonOutput: Record<string, unknown> = {
        timestamp: new Date(log.timestamp).toISOString(),
        level: log.level,
        context: log.context,
        message: log.message,
      };

      // Include context fields from metadata only if includeContext is true
      if (includeContext) {
        if (metadata.operationId) jsonOutput.operationId = metadata.operationId;
        if (metadata.traceId) jsonOutput.traceId = metadata.traceId;
        if (metadata.cycleId !== undefined && metadata.cycleId !== null) {
          jsonOutput.cycleId = metadata.cycleId;
        }
      }

      // Include other metadata if present
      if (Object.keys(metadata).length > 0) {
        jsonOutput.metadata = metadata;
      }

      console.log(JSON.stringify(jsonOutput));
    } else {
      // Text format: output human-readable text
      const formattedMessage = (metadata.formattedMessage as string) || log.message;
      switch (level) {
        case 'info':
          console.log(formattedMessage);
          break;
        case 'warn':
          console.warn(formattedMessage);
          break;
        case 'error':
          console.error(formattedMessage);
          // If error has stack trace, output it
          if (metadata.error && typeof metadata.error === 'object' && 'stack' in metadata.error) {
            console.error(metadata.error.stack as string);
          }
          break;
        case 'debug':
          console.log(formattedMessage);
          break;
      }
    }
  }

  /**
   * Output log to file
   * Always stores as simplified structured JSONL
   */
  private outputToFile(log: TextLog): void {
    // Store simplified log structure directly
    this.jsonlWriter.append(log as unknown as Record<string, unknown>).catch(err => {
      console.error('Failed to write log to file:', err);
    });
  }

  /**
   * Shutdown logging services (stop intervals) to allow process to exit
   * This is useful for CLI commands that need to exit cleanly
   */
  shutdown(): void {
    // Close JSONL writer stream
    void this.jsonlWriter.close();
  }

  /**
   * Flush logging and wait for underlying streams to close
   */
  async flush(): Promise<void> {
    try {
      await this.jsonlWriter.close();
    } catch {
      // Swallow errors on flush to avoid blocking shutdown
    }
  }
}

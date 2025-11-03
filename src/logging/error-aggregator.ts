/**
 * Error Aggregator - Intelligently aggregates duplicate errors
 *
 * Features:
 * - Time window aggregation (same errors within 60 seconds are aggregated)
 * - Error fingerprinting (based on type + message + stack top 5 lines)
 * - Trend detection (increasing/stable/decreasing)
 * - Automatic severity assessment
 * - Aggregated summary output (instead of individual error logs)
 */

import crypto from 'crypto';
import type { AggregatedError, ErrorInfo } from './types.js';
import { normalizeError, LOGGING_CONSTANTS } from './utils.js';

interface ErrorEntry {
  fingerprint: string;
  errorType: string;
  message: string;
  stack?: string;
  occurrences: Array<{
    timestamp: number;
    cycleId: number;
    symbol?: string;
    operationId?: string;
    context?: Record<string, any>;
  }>;
  affectedSymbols: Set<string>;
  affectedCycles: Set<number>;
  firstOccurrence: number;
  lastOccurrence: number;
  recoveryAttempts: number;
  recoverySuccess: boolean;
}

export class ErrorAggregator {
  private static instance: ErrorAggregator;
  
  // Store original console methods to avoid recursion when console interception is enabled
  private originalConsole: {
    log: typeof console.log;
    warn: typeof console.warn;
    error: typeof console.error;
  };
  private errors: Map<string, ErrorEntry> = new Map();
  private aggregationWindow: number = LOGGING_CONSTANTS.ERROR_AGGREGATION.TIME_WINDOW_MS;
  private summaryInterval?: NodeJS.Timeout; // Keep for cleanup if needed
  private handlers: Array<(aggregated: AggregatedError) => void> = [];
  private lastSummaryTime: number = Date.now(); // Keep for potential future use
  private started: boolean = false;

  private constructor() {
    // Store original console methods to avoid infinite recursion
    // when UnifiedLogger intercepts console calls
    this.originalConsole = {
      log: console.log.bind(console),
      warn: console.warn.bind(console),
      error: console.error.bind(console),
    };
    // Do NOT start periodic summary output in constructor - start lazily when first error is recorded
    // This prevents keeping the process alive when logger instance is created but not initialized
  }

  static getInstance(): ErrorAggregator {
    if (!ErrorAggregator.instance) {
      ErrorAggregator.instance = new ErrorAggregator();
    }
    return ErrorAggregator.instance;
  }

  /**
   * Stop error aggregation (cleanup intervals)
   */
  stop(): void {
    if (this.summaryInterval) {
      clearInterval(this.summaryInterval);
      this.summaryInterval = undefined;
    }
    this.started = false;
  }

  /**
   * Register a handler to receive aggregated errors
   */
  onAggregatedError(handler: (aggregated: AggregatedError) => void): void {
    this.handlers.push(handler);
  }

  /**
   * Record an error occurrence
   */
  recordError(
    error: Error | ErrorInfo | unknown,
    context: {
      cycleId: number;
      symbol?: string;
      operationId?: string;
      context?: Record<string, any>;
    }
  ): void {
    // Start periodic summary output on first error if not already started
    if (!this.started) {
      this.summaryInterval = setInterval(() => {
        this.outputSummary();
      }, LOGGING_CONSTANTS.ERROR_AGGREGATION.CLEANUP_INTERVAL_MS / 6); // Every 30 seconds
      this.started = true;
    }

    void context.cycleId; // Used in affectedCycles below
    const errorInfo = this.normalizeError(error);
    const fingerprint = this.generateErrorFingerprint(errorInfo);

    const now = Date.now();
    let entry = this.errors.get(fingerprint);

    if (!entry) {
      entry = {
        fingerprint,
        errorType: errorInfo.type,
        message: errorInfo.message,
        stack: errorInfo.stack,
        occurrences: [],
        affectedSymbols: new Set(),
        affectedCycles: new Set(),
        firstOccurrence: now,
        lastOccurrence: now,
        recoveryAttempts: 0,
        recoverySuccess: false,
      };
      this.errors.set(fingerprint, entry);
    }

    // Add occurrence
    entry.occurrences.push({
      timestamp: now,
      cycleId: context.cycleId,
      symbol: context.symbol,
      operationId: context.operationId,
      context: context.context,
    });

    // Update metadata
    entry.lastOccurrence = now;
    if (context.symbol) {
      entry.affectedSymbols.add(context.symbol);
    }
    entry.affectedCycles.add(context.cycleId);

    // Cleanup old occurrences outside the window
    this.cleanupOldErrorOccurrences(fingerprint, now);
  }

  /**
   * Record a recovery attempt
   */
  recordRecoveryAttempt(
    error: Error | ErrorInfo | unknown,
    success: boolean,
    _cycleId: number
  ): void {
    const errorInfo = this.normalizeError(error);
    const fingerprint = this.generateErrorFingerprint(errorInfo);
    const entry = this.errors.get(fingerprint);

    if (entry) {
      entry.recoveryAttempts++;
      if (success) {
        entry.recoverySuccess = true;
      }
    }
  }

  /**
   * Generate error fingerprint
   */
  private generateErrorFingerprint(error: ErrorInfo): string {
    // Use type + message + top 5 lines of stack for fingerprinting
    const stackTop = error.stack ? error.stack.split('\n').slice(0, 5).join('\n') : '';
    const data = `${error.type}|${error.message}|${stackTop}`;
    return crypto.createHash('sha256').update(data).digest('hex').substring(0, 16);
  }

  /**
   * Normalize error to ErrorInfo format
   */
  private normalizeError(error: Error | ErrorInfo | unknown): ErrorInfo {
    return normalizeError(error);
  }

  /**
   * Cleanup old occurrences outside the aggregation window
   */
  private cleanupOldErrorOccurrences(fingerprint: string, now: number): void {
    const entry = this.errors.get(fingerprint);
    if (!entry) {
      return;
    }

    const cutoff = now - this.aggregationWindow;
    entry.occurrences = entry.occurrences.filter(occ => occ.timestamp > cutoff);

    // Rebuild affected sets
    entry.affectedSymbols.clear();
    entry.affectedCycles.clear();
    for (const occ of entry.occurrences) {
      if (occ.symbol) {
        entry.affectedSymbols.add(occ.symbol);
      }
      entry.affectedCycles.add(occ.cycleId);
    }

    // Remove entry if no occurrences left
    if (entry.occurrences.length === 0) {
      this.errors.delete(fingerprint);
    }
  }

  /**
   * Calculate error severity
   */
  private calculateSeverity(entry: ErrorEntry): 'low' | 'medium' | 'high' | 'critical' {
    const count = entry.occurrences.length;
    const timeSpan = entry.lastOccurrence - entry.firstOccurrence;
    const rate = timeSpan > 0 ? count / (timeSpan / 1000) : count; // errors per second

    // Critical: Very high rate or affects many symbols/cycles
    if (rate > 10 || entry.affectedSymbols.size > 5 || entry.affectedCycles.size > 10) {
      return 'critical';
    }

    // High: High rate or moderate impact
    if (rate > 5 || entry.affectedSymbols.size > 2 || entry.affectedCycles.size > 5) {
      return 'high';
    }

    // Medium: Moderate rate
    if (rate > 1 || count > 10) {
      return 'medium';
    }

    // Low: Low rate and limited impact
    return 'low';
  }

  /**
   * Calculate error trend
   */
  private calculateTrend(entry: ErrorEntry): 'increasing' | 'stable' | 'decreasing' {
    if (entry.occurrences.length < 3) {
      return 'stable';
    }

    // Split occurrences into two halves
    const midpoint = Math.floor(entry.occurrences.length / 2);
    const firstHalf = entry.occurrences.slice(0, midpoint);
    const secondHalf = entry.occurrences.slice(midpoint);

    const firstHalfRate =
      firstHalf.length /
      ((firstHalf[firstHalf.length - 1].timestamp - firstHalf[0].timestamp) / 1000 || 1);
    const secondHalfRate =
      secondHalf.length /
      ((secondHalf[secondHalf.length - 1].timestamp - secondHalf[0].timestamp) / 1000 || 1);

    const ratio = secondHalfRate / (firstHalfRate || 1);

    if (ratio > 1.5) {
      return 'increasing';
    }
    if (ratio < 0.67) {
      return 'decreasing';
    }
    return 'stable';
  }

  /**
   * Convert error entry to aggregated error format
   */
  private toAggregatedError(entry: ErrorEntry): AggregatedError {
    const severity = this.calculateSeverity(entry);
    const trend = this.calculateTrend(entry);

    return {
      fingerprint: entry.fingerprint,
      errorType: entry.errorType,
      message: entry.message,
      firstOccurrence: entry.firstOccurrence,
      lastOccurrence: entry.lastOccurrence,
      totalCount: entry.occurrences.length,
      affectedSymbols: Array.from(entry.affectedSymbols),
      affectedCycles: Array.from(entry.affectedCycles),
      severity,
      trend,
      sampleStack: entry.stack || '',
      recoveryAttempts: entry.recoveryAttempts,
      recoverySuccess: entry.recoverySuccess,
    };
  }

  /**
   * Get internal errors map (for testing)
   * @internal
   */
  getErrorsMap(): Map<string, ErrorEntry> {
    return this.errors;
  }

  /**
   * Generate fingerprint (for testing)
   * @internal
   */
  generateFingerprint(error: ErrorInfo): string {
    return this.generateErrorFingerprint(error);
  }

  /**
   * Cleanup old occurrences (for testing)
   * @internal
   */
  cleanupOldOccurrences(fingerprint: string, now: number): void {
    this.cleanupOldErrorOccurrences(fingerprint, now);
  }

  /**
   * Get all aggregated errors
   */
  getAggregatedErrors(): AggregatedError[] {
    return Array.from(this.errors.values()).map(entry => this.toAggregatedError(entry));
  }

  /**
   * Get errors by severity
   */
  getErrorsBySeverity(minSeverity: 'low' | 'medium' | 'high' | 'critical'): AggregatedError[] {
    const severityLevels = { low: 0, medium: 1, high: 2, critical: 3 };
    const minLevel = severityLevels[minSeverity];

    return this.getAggregatedErrors().filter(err => {
      const level = severityLevels[err.severity];
      return level >= minLevel;
    });
  }

  /**
   * Output periodic summary
   */
  private outputSummary(): void {
    const now = Date.now();
    this.lastSummaryTime = now; // Update last summary time
    const aggregatedErrors = this.getAggregatedErrors();

    if (aggregatedErrors.length === 0) {
      return;
    }

    // Output summary every 30 seconds if there are errors
    for (const handler of this.handlers) {
      try {
        // Send all aggregated errors
        for (const aggregated of aggregatedErrors) {
          handler(aggregated);
        }
      } catch (error) {
        // Use originalConsole to avoid triggering console interception
        this.originalConsole.error('Error in aggregated error handler:', error);
      }
    }

    this.lastSummaryTime = now;
  }

  /**
   * Get summary interval (for cleanup if needed)
   */
  getSummaryInterval(): NodeJS.Timeout | undefined {
    return this.summaryInterval;
  }

  /**
   * Get last summary time
   */
  getLastSummaryTime(): number {
    return this.lastSummaryTime;
  }

  /**
   * Force immediate summary output
   */
  forceSummary(): void {
    this.outputSummary();
  }

  /**
   * Clear old errors (outside aggregation window)
   */
  clearOldErrors(): void {
    const now = Date.now();
    const cutoff = now - this.aggregationWindow;

    for (const [fingerprint, entry] of this.errors.entries()) {
      if (entry.lastOccurrence < cutoff) {
        this.errors.delete(fingerprint);
      }
    }
  }

  /**
   * Reset aggregator (for testing)
   */
  reset(): void {
    this.errors.clear();
    this.lastSummaryTime = Date.now();
  }
}

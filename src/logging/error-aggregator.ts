/**
 * Error Aggregator - Aggregates and analyzes errors
 *
 * This module provides error aggregation and analysis capabilities.
 * Currently implemented as a minimal interface.
 */

import type { AggregatedError } from './types.js';

export class ErrorAggregator {
  private static instance: ErrorAggregator;
  private errors: Map<string, AggregatedError> = new Map();

  private constructor() {}

  static getInstance(): ErrorAggregator {
    if (!ErrorAggregator.instance) {
      ErrorAggregator.instance = new ErrorAggregator();
    }
    return ErrorAggregator.instance;
  }

  /**
   * Record an error
   */
  recordError(error: Error, metadata?: Record<string, unknown>): void {
    const fingerprint = `${error.name}:${error.message}`;
    const existing = this.errors.get(fingerprint);

    if (existing) {
      existing.totalCount++;
      existing.lastOccurrence = Date.now();
      if (metadata) {
        existing.metadata = { ...existing.metadata, ...metadata };
        // Track affected symbols and cycles
        if (metadata.symbol && !existing.affectedSymbols.includes(metadata.symbol as string)) {
          existing.affectedSymbols.push(metadata.symbol as string);
        }
        if (metadata.cycleId && !existing.affectedCycles.includes(metadata.cycleId as number)) {
          existing.affectedCycles.push(metadata.cycleId as number);
        }
      }
    } else {
      this.errors.set(fingerprint, {
        fingerprint,
        errorType: error.name,
        message: error.message,
        firstOccurrence: Date.now(),
        lastOccurrence: Date.now(),
        totalCount: 1,
        affectedSymbols: metadata?.symbol ? [metadata.symbol as string] : [],
        affectedCycles: metadata?.cycleId ? [metadata.cycleId as number] : [],
        severity: 'medium',
        trend: 'stable',
        sampleStack: error.stack || '',
        recoveryAttempts: 0,
        recoverySuccess: false,
        metadata,
      });
    }
  }

  /**
   * Record recovery attempt
   */
  recordRecoveryAttempt(error: Error, success: boolean, attemptNumber: number): void {
    const fingerprint = `${error.name}:${error.message}`;
    const existing = this.errors.get(fingerprint);

    if (existing) {
      existing.recoveryAttempts = attemptNumber;
      existing.recoverySuccess = success;
    }
  }

  /**
   * Get all aggregated errors
   */
  getAggregatedErrors(): AggregatedError[] {
    return Array.from(this.errors.values());
  }

  /**
   * Get errors within time window
   */
  getRecentErrors(windowMs: number): AggregatedError[] {
    const now = Date.now();
    return this.getAggregatedErrors().filter(err => now - err.lastOccurrence < windowMs);
  }

  /**
   * Reset all errors
   */
  reset(): void {
    this.errors.clear();
  }

  /**
   * Cleanup old errors
   */
  cleanup(maxAgeMs: number): void {
    const now = Date.now();
    for (const [key, error] of this.errors.entries()) {
      if (now - error.lastOccurrence > maxAgeMs) {
        this.errors.delete(key);
      }
    }
  }
}

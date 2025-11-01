/**
 * Logging system utility functions
 */

import type { ErrorInfo } from './types.js';

/**
 * Error with optional code property
 */
interface ErrorWithCode extends Error {
  code?: string | number;
}

/**
 * Check if error has a code property
 */
function hasErrorCode(error: unknown): error is ErrorWithCode {
  return error instanceof Error && 'code' in error;
}

/**
 * Normalize error to ErrorInfo format
 * Handles Error, ErrorInfo, and unknown error types
 */
export function normalizeError(error: Error | ErrorInfo | unknown): ErrorInfo {
  if (error instanceof Error) {
    const errorInfo: ErrorInfo = {
      type: error.constructor.name,
      message: error.message,
      stack: error.stack,
    };

    // Safely extract code property if it exists
    if (hasErrorCode(error)) {
      errorInfo.code = String(error.code);
      errorInfo.details = { code: error.code };
    }

    return errorInfo;
  }

  if (typeof error === 'object' && error !== null && 'type' in error) {
    return error as ErrorInfo;
  }

  // Fallback for unknown error types
  const message =
    typeof error === 'string'
      ? error
      : error instanceof Object && 'message' in error
        ? String((error as { message: unknown }).message)
        : String(error);

  return {
    type: 'UnknownError',
    message,
  };
}

/**
 * Constants for the logging system
 */
export const LOGGING_CONSTANTS = {
  // Storage configuration
  STORAGE: {
    DEFAULT_LOG_DIR: './logs',
    L0_MAX_SIZE: 1000,
    L1_MAX_CYCLES: 10,
    L2_RETENTION_DAYS: 7,
    L3_RETENTION_DAYS: 30,
    L2_DIR: 'l2-history',
    L3_DIR: 'l3-archive',
  },

  // Snapshot configuration
  SNAPSHOT: {
    DEFAULT_INTERVAL: 60000, // 1 minute
    MAX_AGE: 3600000, // 1 hour
  },

  // Error aggregation
  ERROR_AGGREGATION: {
    TIME_WINDOW_MS: 60000, // 1 minute
    MAX_SAMPLES: 10,
    CLEANUP_INTERVAL_MS: 300000, // 5 minutes
  },

  // Metrics collection
  METRICS: {
    PERCENTILES: [50, 75, 90, 95, 99] as const,
    MAX_METRIC_HISTORY: 1000,
  },

  // Sampling rates
  SAMPLING: {
    NORMAL_RATE: 1.0,
    WARNING_RATE: 1.5,
    CRITICAL_RATE: 2.0,
  },

  // Anomaly detection thresholds
  ANOMALY: {
    ERROR_RATE_SPIKE: 0.1, // 10%
    LATENCY_DEGRADATION: 2.0, // 2x
    MEMORY_LEAK_RATE: 0.05, // 5% per cycle
  },
} as const;

/**
 * Type helper for error with code
 */
export type { ErrorWithCode };

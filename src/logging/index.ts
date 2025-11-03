/**
 * Logging System - Main entry point
 *
 * Exports all logging system components
 */

export { OperationLogger } from './operation-logger.js';
export { ErrorAggregator } from './error-aggregator.js';
export { MetricsCollector } from './metrics-collector.js';
export { StateSnapshotService } from './state-snapshot.js';
export { Sampler } from './sampler.js';
export { StorageLayer } from './storage-layer.js';
export { UnifiedLogger } from './unified-logger.js';
export { QueryInterface } from './query-interface.js';
export { StorageOptimizer } from './storage-optimizer.js';
export { normalizeError, LOGGING_CONSTANTS } from './utils.js';

export type {
  LogLevel,
  OperationStatus,
  CircuitBreakerState,
  TraceContext,
  OperationLog,
  OperationStage,
  ErrorInfo,
  SystemSnapshot,
  AggregatedError,
  MetricsSnapshot,
  SamplingConfig,
  TextLog,
} from './types.js';

export type { SamplingState } from './sampler.js';

/**
 * Core types for the new logging system
 */

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

export type OperationStatus = 'running' | 'completed' | 'failed' | 'cancelled';

export type CircuitBreakerState = 'CLOSED' | 'OPEN' | 'HALF_OPEN';

export interface TraceContext {
  traceId: string; // Cycle-level trace ID
  cycleId: number;
  parentOperationId?: string; // For nested operations
}

export interface OperationStage {
  stage: string;
  startTime: number;
  endTime?: number;
  duration?: number;
  status: 'started' | 'completed' | 'failed';
  input?: Record<string, any>;
  output?: Record<string, any>;
  error?: ErrorInfo;
  metadata?: Record<string, any>;
}

export interface ErrorInfo {
  type: string;
  message: string;
  stack?: string;
  code?: string;
  details?: Record<string, any>;
}

export interface OperationLog {
  operationId: string;
  traceId: string;
  cycleId: number;
  operationType: string;
  symbol?: string;
  parentOperationId?: string;
  startTime: number;
  endTime?: number;
  status: OperationStatus;
  input: Record<string, any>;
  output?: Record<string, any>;
  error?: ErrorInfo;
  stages: OperationStage[];
  metrics: {
    duration: number;
    resourceUsage?: {
      cpu?: number;
      memory?: number;
    };
  };
  context?: {
    accountState?: Record<string, any>;
    marketState?: Record<string, any>;
    systemState?: Record<string, any>;
  };
  tags?: string[];
}

export interface SystemSnapshot {
  snapshotId: string;
  timestamp: number;
  cycleId: number;
  account: {
    equity: number;
    balance: number;
    marginUsed: number;
    availableMargin: number;
  };
  positions: Array<{
    symbol: string;
    side: string;
    size: number;
    entryPrice: number;
    unrealizedPnl: number;
  }>;
  systemMetrics: {
    uptime: number;
    errorRate: number;
    avgCycleTime: number;
    memoryUsage: {
      heapUsed: number;
      heapTotal: number;
      rss: number;
    };
    apiLatency?: {
      p50: number;
      p75: number;
      p90: number;
      p95: number;
      p99: number;
    };
  };
  circuitBreakers: Array<{
    name: string;
    state: CircuitBreakerState;
    failureCount: number;
    lastFailure?: number;
    lastSuccess?: number;
  }>;
  recentOperations: Array<{
    operationId: string;
    type: string;
    status: OperationStatus;
    duration: number;
  }>;
  changes?: {
    equityChange?: number;
    positionCountChange?: number;
    errorRateChange?: number;
    performanceChange?: number;
  };
}

export interface AggregatedError {
  fingerprint: string;
  errorType: string;
  message: string;
  firstOccurrence: number;
  lastOccurrence: number;
  totalCount: number;
  affectedSymbols: string[];
  affectedCycles: number[];
  severity: 'low' | 'medium' | 'high' | 'critical';
  trend: 'increasing' | 'stable' | 'decreasing';
  sampleStack: string;
  recoveryAttempts: number;
  recoverySuccess: boolean;
  metadata?: Record<string, any>;
}

export interface MetricsSnapshot {
  timestamp: number;
  cycleId: number;
  errorRate: {
    overall: number;
    byType: Record<string, number>;
    bySymbol: Record<string, number>;
    trend: 'increasing' | 'stable' | 'decreasing';
  };
  performance: {
    cycleTime: {
      p50: number;
      p75: number;
      p90: number;
      p95: number;
      p99: number;
      avg: number;
    };
    apiLatency: Record<
      string,
      {
        p50: number;
        p95: number;
        p99: number;
        count: number;
      }
    >;
    operationTime: Record<
      string,
      {
        p50: number;
        p95: number;
        p99: number;
        count: number;
      }
    >;
  };
  business: {
    signalGenerationSuccess: number;
    orderExecutionSuccess: number;
    positionProfitability: number;
  };
}

export interface SamplingConfig {
  normal: {
    operationLogRate: number;
    systemLogRate: number;
    apiLogRate: number;
    debugLogRate: number;
  };
  warning: {
    operationLogRate: number;
    systemLogRate: number;
    apiLogRate: number;
    debugLogRate: number;
  };
  critical: {
    operationLogRate: number;
    systemLogRate: number;
    apiLogRate: number;
    debugLogRate: number;
  };
}

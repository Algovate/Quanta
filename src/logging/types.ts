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

export interface DecisionPath {
  choices: Array<{
    step: string;
    decision: string;
    reason: string;
    confidence?: number;
    threshold?: number;
    factors?: Record<string, any>; // Additional detailed information (signals, reasoning, etc.)
  }>;
}

export interface ValidationResults {
  passed: boolean;
  checks: Array<{
    check: string;
    passed: boolean;
    reason?: string;
    details?: Record<string, any>;
  }>;
}

export interface DataQualityMetrics {
  freshness: {
    latestTimestamp: number;
    ageMs: number;
    isStale: boolean;
  };
  completeness: {
    expectedItems: number;
    actualItems: number;
    missingItems?: string[];
  };
  gaps?: Array<{
    symbol: string;
    timeframe: string;
    missingFrom: number;
    missingTo: number;
  }>;
}

export interface DataQualityInfo {
  freshness: number; // Age in ms
  isStale: boolean;
  completeness: number; // 0-1 ratio
  gapsCount: number;
}

export interface ValidationCheck {
  name: string;
  passed: boolean;
  reason?: string;
  threshold?: number;
  actual?: number;
  details?: Record<string, any>;
}

export interface DecisionMetrics {
  confidence: number;
  threshold: number;
  reasoning?: string;
  factors?: Record<string, any>;
}

export interface ExecutionDetails {
  orderId?: string;
  expectedPrice?: number;
  actualPrice?: number;
  slippage?: number;
  slippageAbs?: number;
  realizedPnl?: number;
  fees?: number;
  sizing?: {
    suggestedSize?: number;
    leverage?: number;
    riskAmount?: number;
  };
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
  dataQuality?: DataQualityInfo;
  validationChecks?: ValidationCheck[];
  decisionMetrics?: DecisionMetrics;
  execution?: ExecutionDetails; // Execution details for order execution stages
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
  decisionPath?: DecisionPath;
  validationResults?: ValidationResults;
  dataQuality?: DataQualityMetrics;
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

/**
 * Simplified text log structure
 * All optional fields are merged into metadata for simplicity
 */
export interface TextLog {
  timestamp: number;
  level: 'info' | 'warn' | 'error' | 'debug';
  message: string;
  context: string;
  metadata?: Record<string, any>; // Contains cycleId, operationId, traceId, formattedMessage, etc.
}

export interface APICallLog {
  apiCallId: string;
  timestamp: number;
  endpoint: string;
  method: string;
  request: {
    url: string;
    headers?: Record<string, string>;
    body?: Record<string, any>;
    params?: Record<string, any>;
  };
  response: {
    status?: number;
    statusText?: string;
    headers?: Record<string, string>;
    body?: Record<string, any>;
    data?: any;
  };
  latency: number;
  error?: ErrorInfo;
  cycleId: number;
  operationId?: string;
  traceId?: string;
}

import type { Exchange } from '../exchange/types.js';
import type { MarketDataProvider } from '../data/market.js';
import type { UnifiedLogger } from '../logging/index.js';
import type { ExchangeSnapshotService } from './exchange-snapshot.js';
import type { RiskManager } from '../execution/risk.js';
import type { OrderExecutor } from '../execution/orders.js';
import type { PositionMonitorService } from '../execution/monitor.js';
import type { IAIClient } from '../ai/types.js';
import type { MarketDataFetcher } from './market-data-fetcher.js';
import type { SignalProcessor } from './signal-processor.js';
import type { Account, Position, TradingSignal, TechnicalIndicators } from '../types/index.js';
import type { TypedEventBus } from './event-bus.js';
import type { WorkflowConfig, SystemState } from './workflow.js';
import type { IStrategy } from '../strategies/index.js';
import type { SignalDecisionInfo } from './cycle-summary-formatter.js';
import type { PositionAggregates } from '../execution/position-utils.js';

export interface ExecuteSignalFn {
  (
    operationId: string,
    signal: TradingSignal,
    account: Account,
    positions: Position[],
    tickerCache: Map<string, { price: number; timestamp: number }>,
    currentPrice: number,
    atr14?: number,
    indicators?: TechnicalIndicators
  ): Promise<{
    success: boolean;
    order?: { id: string };
    error?: string;
    decisionInfo?: SignalDecisionInfo;
  }>;
}

export interface WorkflowContext {
  exchange: Exchange;
  marketDataProvider: MarketDataProvider;
  unifiedLogger: UnifiedLogger;
  snapshotService: ExchangeSnapshotService;
  riskManager: RiskManager;
  orderExecutor: OrderExecutor;
  positionMonitor: PositionMonitorService;
  aiAgent: IAIClient; // Required for fallback when strategy is not provided
  strategy?: IStrategy; // Optional strategy instance (preferred over direct aiAgent calls)
  marketDataFetcher: MarketDataFetcher;
  signalProcessor: SignalProcessor;
  isBackgroundMode: boolean;
  config: WorkflowConfig;
  eventBus: TypedEventBus;
  loggerContext: string;
  // Optional helpers for stages that need workflow-internal functionality
  executeSignalFn?: ExecuteSignalFn;
  emitLog?: (level: 'info' | 'warn' | 'error' | 'success', message: string) => void;
  emitEvent?: (event: string, payload: unknown) => void;
  cycleSummaryFormatter?: import('./cycle-summary-formatter.js').CycleSummaryFormatter;
  performanceMetricsCalculator?: import('./performance-metrics-calculator.js').PerformanceMetricsCalculator;
  getState?: () => SystemState & {
    cycleStartTime?: number;
    tradesBefore?: number;
  };
  updateState?: (updates: Partial<SystemState>) => void;
  getCircuitBreakerStates?: () => Array<{
    name: string;
    state: 'CLOSED' | 'OPEN' | 'HALF_OPEN';
    failureCount: number;
    lastFailure?: number;
    lastSuccess?: number;
  }>;
  getRecentOperationsSummary?: () => Array<{
    operationId: string;
    type: string;
    status: 'running' | 'completed' | 'failed' | 'cancelled';
    duration: number;
  }>;
  logCycleSummary?: (
    account: Account,
    positions: Position[],
    signals: TradingSignal[],
    aggregates: PositionAggregates,
    cycleMetrics: { rejectedSignalsCycle: number; tradeCountCycle: number }
  ) => void;
}

export interface CycleIO {
  account: Account;
  positions: Position[];
  tickerCache: Map<string, { price: number; timestamp: number }>;
  marketData?: import('../data/market.js').MarketData[]; // Market data from data provider
  signals?: TradingSignal[];
  marketMeta?: {
    successCount: number;
    failCount: number;
    fetchMs: number;
  };
}

export interface StageAbort {
  reason: string;
  error?: Error;
  stopWorkflow?: boolean; // If true, indicates the workflow should stop (e.g., AIClientError)
}

export interface StageResult<T = Partial<CycleIO>> {
  ioDelta?: T;
  abort?: StageAbort;
}

export interface WorkflowStage {
  name: string;
  run(operationId: string, ctx: WorkflowContext, io: CycleIO): Promise<StageResult>;
}

import type { Exchange } from '../exchange/types.js';
import type { MarketDataProvider } from '../data/market.js';
import type { UnifiedLogger } from '../logging/index.js';
import type { ExchangeSnapshotService } from './exchange-snapshot.js';
import type { RiskManager } from '../execution/risk.js';
import type { OrderExecutor } from '../execution/orders.js';
import type { PositionMonitorService } from '../execution/monitor.js';
import type { OpenRouterClient } from '../ai/agent.js';
import type { MarketDataFetcher } from './market-data-fetcher.js';
import type { SignalProcessor } from './signal-processor.js';
import type { Account, Position, TradingSignal } from '../types/index.js';
import type { TypedEventBus } from './event-bus.js';
import type { WorkflowConfig } from './workflow.js';
import type { IStrategy } from '../strategies/index.js';

export interface ExecuteSignalFn {
  (
    operationId: string,
    signal: TradingSignal,
    account: Account,
    positions: Position[],
    tickerCache: Map<string, { price: number; timestamp: number }>,
    currentPrice: number,
    atr14?: number,
    indicators?: any
  ): Promise<{
    success: boolean;
    order?: { id: string };
    error?: string;
    decisionInfo?: any;
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
  aiAgent: OpenRouterClient; // Required for fallback when strategy is not provided
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
  emitEvent?: (event: string, payload: any) => void;
  cycleSummaryFormatter?: any;
  performanceMetricsCalculator?: any;
  getState?: () => any;
  updateState?: (updates: Partial<any>) => void;
  getCircuitBreakerStates?: () => any[];
  getRecentOperationsSummary?: () => any[];
  logCycleSummary?: (
    account: Account,
    positions: Position[],
    signals: TradingSignal[],
    aggregates: any,
    cycleMetrics: any
  ) => void;
}

export interface CycleIO {
  account: Account;
  positions: Position[];
  tickerCache: Map<string, { price: number; timestamp: number }>;
  marketData?: any[]; // Intentionally broad to decouple; stage-specific types apply at call sites
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

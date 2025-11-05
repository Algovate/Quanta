import { Exchange } from '../exchange/types.js';
import { MarketDataProvider } from '../data/market.js';
import { OpenRouterClient } from '../ai/agent.js';
import { RiskManager } from '../execution/risk.js';
import { OrderExecutor } from '../execution/orders.js';
import { PositionMonitorService } from '../execution/monitor.js';
import { Account, Position, TradingSignal } from '../types/index.js';
import { EventBus, TypedEventBus, type EventKey, type EventPayloads } from './event-bus.js';
import { BarScheduler, type BarTimeframe } from './scheduler.js';
import { validateAccount } from '../utils/account-validation.js';
import type { PositionAggregates } from '../execution/position-utils.js';
import { CycleLogger, CycleDisplay } from './display/index.js';
import chalk from 'chalk';
import { ExchangeSnapshotService } from './exchange-snapshot.js';
import { UnifiedLogger } from '../logging/index.js';
import { ExecutionSessionManager } from './execution-session-manager.js';
import { MarketDataFetcher } from './market-data-fetcher.js';
import { PerformanceMetricsCalculator } from './performance-metrics-calculator.js';
import { CycleSummaryFormatter } from './cycle-summary-formatter.js';
import { SignalProcessor } from './signal-processor.js';
import { runStages } from './workflow-pipeline.js';
import type { WorkflowContext, CycleIO } from './workflow-types.js';
import {
  MonitorPositionsStage,
  FetchMarketDataStage,
  GenerateSignalsStage,
  ProcessSignalsStage,
  ExecuteSignalsStage,
  FinalizeCycleStage,
} from './workflow-stages/index.js';
import { formatWithArenaPrefix } from './log-prefix-formatter.js';
import { CycleEvents } from './cycle-events.js';

/**
 * TradingWorkflow - Orchestrates the complete trading cycle
 *
 * ## Architecture Overview
 *
 * TradingWorkflow manages the execution of trading cycles, where each cycle:
 * 1. Monitors existing positions (TP1, breakeven, stop loss, etc.)
 * 2. Fetches market data for configured coins and timeframes
 * 3. Generates AI trading signals based on market conditions
 * 4. Processes and displays signals
 * 5. Executes signals (LONG/SHORT/CLOSE) with risk management
 * 6. Finalizes the cycle (metrics, snapshots, summaries)
 *
 * ## Pipeline Architecture
 *
 * The workflow supports a staged pipeline architecture for improved modularity:
 * - **Stages**: Independent, composable units that process a `CycleIO` object
 * - **Pipeline Runner**: Chains stages sequentially, short-circuiting on aborts
 * - **Context**: Shared immutable dependencies (exchange, logger, config, etc.)
 * - **CycleIO**: Mutable cycle data (account, positions, marketData, signals)
 *
 * Stages are located in `workflow-stages/`:
 * - `MonitorPositionsStage` - Position monitoring and exit decisions
 * - `FetchMarketDataStage` - Market data retrieval with caching
 * - `GenerateSignalsStage` - AI signal generation
 * - `ProcessSignalsStage` - Signal post-processing and display
 * - `ExecuteSignalsStage` - Signal execution with risk management
 * - `FinalizeCycleStage` - Metrics, snapshots, and cycle completion
 *
 * The workflow always uses the staged pipeline; the legacy inline orchestration was removed.
 *
 * ## State Management
 *
 * - `SystemState`: Tracks cycle count, P&L, win rate, drawdown protection
 * - State is updated atomically during cycle execution
 * - Performance metrics are calculated and aggregated per cycle
 *
 * ## Error Handling
 *
 * - Errors in any stage abort the cycle gracefully
 * - Errors are logged via UnifiedLogger with full context
 * - Cycle errors emit `cycle:error` events
 * - Failed cycles don't prevent subsequent cycles from running
 *
 * ## Logging
 *
 * - Uses UnifiedLogger for structured, queryable logs
 * - Supports Arena mode with drone/session prefixes
 * - Cycle summaries are logged to operation logs
 * - All stages log their start/complete/duration to the same operation
 */

// Decision information types for signal execution (handled within stages)

// (legacy position decision info type removed; pipeline stages log decisions directly)

export interface SystemState {
  isRunning: boolean;
  cycleCount: number;
  startTime: number;
  lastUpdate: number;
  totalSignals: number;
  totalTrades: number;
  rejectedSignals: number; // Track rejected signals for efficiency calculation (cumulative)
  rejectedSignalsCycle: number; // Track rejected signals for current cycle
  initialBalance: number; // Initial account balance for total P&L calculation
  totalPnl: number; // Total P&L from initial balance (realized + unrealized)
  unrealizedPnl: number; // Unrealized P&L from open positions
  winRate: number;
  lastCountdownTime?: number;
  previousEquity?: number; // Track equity from previous cycle
  cyclePnl?: number; // P&L change in this cycle
  previousBalance?: number; // Track balance for realized P&L per-cycle
  peakEquity?: number; // Peak equity for drawdown calculation
  maxDrawdown?: number; // Maximum drawdown percentage (0-1)
  drawdownState?: 'normal' | 'reduced' | 'paused'; // Drawdown protection state
}

export interface WorkflowConfig {
  coins: string[];
  cyclePeriod: number; // milliseconds
  maxPositions: number;
  marketFetchParallel?: boolean;
  marketTimeframes?: string[]; // e.g., ['3m','4h']
  ai?: {
    prompt?: {
      candles?: { m3?: number; h1?: number; h4?: number };
      sections?: { candlesTA?: boolean; sentiment?: boolean; technicalState?: boolean };
    };
  };
  riskParams: {
    maxRiskPerTrade: number;
    maxTotalRisk: number;
    defaultStopLoss: number;
    maxLeverage: number;
    minLeverage: number;
    maxPositions: number;
  };
}

export class TradingWorkflow {
  private exchange: Exchange;
  private marketDataProvider: MarketDataProvider;
  private aiAgent: OpenRouterClient;
  private riskManager: RiskManager;
  private orderExecutor: OrderExecutor;
  private positionMonitor: PositionMonitorService;
  private config: WorkflowConfig;
  private state: SystemState;
  private nextTimeout?: NodeJS.Timeout;
  private isCycleRunning: boolean = false;
  private isPaused: boolean = false;
  private loggerContext: string = 'Workflow';
  private cycleLogger: CycleLogger;
  private cycleDisplay: CycleDisplay;
  private isBackgroundMode: boolean;
  private snapshotService: ExchangeSnapshotService;
  private barScheduler?: BarScheduler;
  private barDrivenEnabled: boolean = false;
  private barUnsubscribe?: () => void;
  private unifiedLogger: UnifiedLogger;
  private originalConsole: {
    log: typeof console.log;
    warn: typeof console.warn;
    error: typeof console.error;
  };
  // Arena support: event bus and prefix
  private eventBus: TypedEventBus;
  private eventPrefix: string = '';
  // Optional getter to retrieve custom exit plans
  private getCustomExitPlans?: (
    symbol: string,
    side: 'long' | 'short'
  ) => { stopLoss?: number; takeProfit?: number };
  private marketDataFetcher: MarketDataFetcher;
  private performanceMetricsCalculator: PerformanceMetricsCalculator;
  private cycleSummaryFormatter: CycleSummaryFormatter;
  private signalProcessor: SignalProcessor;

  constructor(
    exchange: Exchange,
    marketDataProvider: MarketDataProvider,
    aiAgent: OpenRouterClient,
    config: WorkflowConfig,
    options?: {
      eventBus?: TypedEventBus;
      eventPrefix?: string;
      loggerContext?: string;
      logger?: UnifiedLogger;
    }
  ) {
    this.exchange = exchange;
    this.marketDataProvider = marketDataProvider;
    this.aiAgent = aiAgent;
    this.config = config;

    // Initialize Arena support: use provided or default to singleton
    this.eventBus = options?.eventBus ?? EventBus;
    this.eventPrefix = options?.eventPrefix ?? '';
    this.loggerContext = options?.loggerContext ?? 'Workflow';
    this.unifiedLogger = options?.logger ?? UnifiedLogger.getInstance();

    this.riskManager = new RiskManager(config.riskParams);
    // Force market orders when using simulated execution (SimulatorExchange in simulation/paper)
    const exchangeName = exchange.getExchangeName();
    const forceMarket = exchangeName === 'simulator' || exchangeName.startsWith('paper(');
    this.orderExecutor = new OrderExecutor(exchange, this.riskManager, {
      forceMarketOrders: forceMarket,
    });
    this.positionMonitor = new PositionMonitorService(this.riskManager, this.orderExecutor);
    this.unifiedLogger.initialize();
    this.originalConsole = this.unifiedLogger.getOriginalConsole();
    this.cycleLogger = new CycleLogger();
    this.cycleDisplay = new CycleDisplay();
    this.isBackgroundMode = this.unifiedLogger.isBackgroundMode();
    this.snapshotService = new ExchangeSnapshotService(this.exchange);
    this.marketDataFetcher = new MarketDataFetcher(this.marketDataProvider, (level, message) =>
      this.emitLog(level, message)
    );
    this.performanceMetricsCalculator = new PerformanceMetricsCalculator(
      this.riskManager,
      this.exchange,
      this.unifiedLogger,
      this.loggerContext
    );
    this.cycleSummaryFormatter = new CycleSummaryFormatter();
    this.signalProcessor = new SignalProcessor();

    this.state = {
      isRunning: false,
      cycleCount: 0,
      startTime: Date.now(),
      lastUpdate: Date.now(),
      totalSignals: 0,
      totalTrades: 0,
      rejectedSignals: 0,
      rejectedSignalsCycle: 0,
      initialBalance: 0, // Will be set when trading starts
      totalPnl: 0,
      unrealizedPnl: 0,
      winRate: 0,
      previousEquity: 0,
      cyclePnl: 0,
      previousBalance: 0,
      peakEquity: 0,
      maxDrawdown: 0,
      drawdownState: 'normal',
    };
  }

  public getExchange(): Exchange {
    return this.exchange;
  }

  public getConfig(): WorkflowConfig {
    return { ...this.config };
  }

  /**
   * Centralized event emission with optional prefix for Arena isolation
   * @private
   */
  private emitEvent<K extends EventKey>(event: K, payload: EventPayloads[K]): void {
    const fullEvent = this.eventPrefix ? (`${this.eventPrefix}${event}` as any) : event;
    this.eventBus.emit(fullEvent, payload);
  }

  /**
   * Set a getter function to retrieve custom exit plans for positions
   */
  public setCustomExitPlansGetter(
    getter: (
      symbol: string,
      side: 'long' | 'short'
    ) => {
      stopLoss?: number;
      takeProfit?: number;
    }
  ): void {
    this.getCustomExitPlans = getter;
  }

  /**
   * Emit log message with proper handling for foreground vs background mode
   * - Foreground: Direct synchronous console output for chronological ordering
   * - Background: Buffered logger output for efficiency
   */
  private emitLog(level: 'info' | 'warn' | 'error' | 'success', message: string): void {
    const prefixedMessage = formatWithArenaPrefix(this.loggerContext, message);
    this.cycleLogger.log(level, prefixedMessage);
  }

  /**
   * Log structured output to console (bypasses interception)
   * Use this for structured outputs that are already logged to operation logs.
   * This prevents duplicate storage in text logs while maintaining console display.
   */
  private logToConsole(...args: unknown[]): void {
    this.originalConsole.log(...args);
  }

  async start(): Promise<void> {
    if (this.state.isRunning) {
      this.emitLog('warn', 'Workflow is already running');
      return;
    }

    // Remove duplicate startup message - already shown in trade.ts
    this.state.isRunning = true;
    this.state.startTime = Date.now();
    this.state.lastUpdate = Date.now();

    // Execute first cycle immediately; subsequent cycles are scheduled at the end
    await this.executeCycle();
  }

  async stop(): Promise<void> {
    if (!this.state.isRunning) {
      this.emitLog('warn', 'Workflow is not running');
      return;
    }

    this.emitLog('info', '🛑 Stopping Quanta trading workflow...');
    this.state.isRunning = false;
    this.isPaused = false; // Clear paused flag on stop

    if (this.nextTimeout) {
      clearTimeout(this.nextTimeout);
      this.nextTimeout = undefined;
    }

    // Stop bar-driven scheduling if enabled
    try {
      if (this.barScheduler) this.barScheduler.stop();
      if (this.barUnsubscribe) this.barUnsubscribe();
    } catch {
      // ignore
    }

    // Generate final report
    this.generateReport();
  }

  private async executeCycle(): Promise<void> {
    if (!this.state.isRunning) return;
    if (this.isCycleRunning) return; // prevent overlap
    this.isCycleRunning = true;

    const cycleStartTime = Date.now();

    // Get ExecutionSession context for logging
    const sessionManager = ExecutionSessionManager.getInstance();
    const activeSession = sessionManager.getActive();

    // Extract drone/arena context from loggerContext (format: "Arena:${arenaId}:Drone:${droneId}:${droneName}")
    let arenaId: string | undefined;
    let droneId: string | undefined;
    let droneName: string | undefined;
    if (this.loggerContext.startsWith('Arena:')) {
      const parts = this.loggerContext.split(':');
      if (parts.length >= 4 && parts[0] === 'Arena' && parts[2] === 'Drone') {
        arenaId = parts[1];
        droneId = parts[3];
        // Optional drone name (parts[4] if present)
        if (parts.length >= 5) {
          droneName = parts[4];
        }
      }
    }

    const cycleOperationId = this.unifiedLogger.startOperation(
      this.unifiedLogger.createTraceContext(this.state.cycleCount + 1),
      'trading_cycle',
      {
        cycleCount: this.state.cycleCount + 1,
        coins: this.config.coins,
        cyclePeriod: this.config.cyclePeriod,
        executionSession: activeSession
          ? {
              mode: activeSession.mode,
              env: activeSession.env,
              id: activeSession.id,
              startTime: activeSession.startTime,
            }
          : undefined,
        arenaContext:
          arenaId && droneId
            ? {
                arenaId,
                droneId,
              }
            : undefined,
      }
    );

    try {
      this.state.cycleCount++;
      this.state.lastUpdate = Date.now();
      this.state.rejectedSignalsCycle = 0; // Reset per-cycle counter at start of each cycle

      // Guard: check if stopped mid-cycle
      if (!this.state.isRunning) {
        return;
      }

      // Emit cycle start event
      this.emitEvent(CycleEvents.Start, {
        cycleCount: this.state.cycleCount,
        timestamp: Date.now(),
        startTime: this.state.startTime,
      });

      // Record cycle start in unified logger
      this.unifiedLogger.startStage(cycleOperationId, 'cycle_start', {
        cycleCount: this.state.cycleCount,
        executionSession: activeSession
          ? {
              mode: activeSession.mode,
              env: activeSession.env,
              id: activeSession.id,
            }
          : undefined,
        arenaContext:
          arenaId && droneId
            ? {
                arenaId,
                droneId,
              }
            : undefined,
      });

      // Display cycle header with emphasis
      this.emitLog('info', '');
      const cycleHeader = this.cycleDisplay.formatCycleHeader(this.state.cycleCount, {
        executionSession: activeSession
          ? {
              mode: activeSession.mode,
              env: activeSession.env,
              id: activeSession.id,
            }
          : undefined,
        arenaContext:
          arenaId && droneId
            ? {
                arenaId,
                droneId,
                droneName,
              }
            : undefined,
      });
      this.emitLog('info', cycleHeader);

      this.emitLog('info', chalk.gray('⏳ Fetching account data...'));

      // 1. Get a consistent snapshot of account and positions
      this.unifiedLogger.startStage(cycleOperationId, 'fetch_account', {});
      const accountStartTime = Date.now();
      const { account, positions } = await this.snapshotService.getSnapshot();
      const accountDuration = Date.now() - accountStartTime;
      this.unifiedLogger.recordAPILatency('exchange.getAccount', accountDuration);
      this.unifiedLogger.completeStage(cycleOperationId, 'fetch_account', {
        equity: account.equity,
        balance: account.balance,
        positionsCount: positions.length,
        duration: accountDuration,
      });

      // Set initial balance on first cycle (must happen early before any operations that might fail)
      // This ensures P&L calculations are correct even if the cycle fails later
      if (this.state.cycleCount === 1 && this.state.initialBalance === 0 && account.equity > 0) {
        this.state.initialBalance = account.equity;
        this.unifiedLogger.info(
          'Initial balance set for P&L tracking',
          {
            initialBalance: this.state.initialBalance,
            equity: account.equity,
          },
          this.loggerContext
        );
      }

      this.emitLog(
        'info',
        `💰 Account: $${account.equity.toFixed(2)} | Positions: ${positions.length}`
      );

      // Per-cycle ticker cache to avoid redundant fetches (created early for position monitoring)
      const tickerCache = new Map<string, { price: number; timestamp: number }>();

      // Ticker price helper created by stages when needed

      // 2-7. Pipeline execution (monitor -> fetch -> generate -> process -> execute -> finalize)
      // mark optional getter as used to satisfy TS when custom plans are provided externally
      void this.getCustomExitPlans;
      const tradesBeforePipeline = this.state.totalTrades;
      const ctx: WorkflowContext = {
        exchange: this.exchange,
        marketDataProvider: this.marketDataProvider,
        unifiedLogger: this.unifiedLogger,
        snapshotService: this.snapshotService,
        riskManager: this.riskManager,
        orderExecutor: this.orderExecutor,
        positionMonitor: this.positionMonitor,
        aiAgent: this.aiAgent,
        marketDataFetcher: this.marketDataFetcher,
        signalProcessor: this.signalProcessor,
        isBackgroundMode: this.isBackgroundMode,
        config: this.config,
        eventBus: this.eventBus,
        loggerContext: this.loggerContext,
        executeSignalFn: this.executeSignal.bind(this),
        emitLog: (level, message) => this.emitLog(level, message),
        emitEvent: (event, payload) => this.emitEvent(event as any, payload as any),
        cycleSummaryFormatter: this.cycleSummaryFormatter,
        performanceMetricsCalculator: this.performanceMetricsCalculator,
        getState: () => ({ ...this.state, tradesBefore: tradesBeforePipeline, cycleStartTime }),
        updateState: updates => {
          this.state = { ...this.state, ...(updates as any) };
        },
        getCircuitBreakerStates: () => this.getCircuitBreakerStates(),
        getRecentOperationsSummary: () => this.getRecentOperationsSummary(),
        logCycleSummary: (acc, poss, sigs, aggs, cycleMetrics) =>
          this.logCycleSummary(acc, poss, sigs, aggs, cycleMetrics),
      };
      const initialIO: CycleIO = {
        account,
        positions,
        tickerCache,
      };
      const pipelineResult = await runStages(cycleOperationId, ctx, initialIO, [
        new MonitorPositionsStage(),
        new FetchMarketDataStage(),
        new GenerateSignalsStage(),
        new ProcessSignalsStage(),
        new ExecuteSignalsStage(),
        new FinalizeCycleStage(),
      ]);

      // If a stage requested workflow stop (e.g., AIClientError), stop the workflow
      if (pipelineResult.stopWorkflow) {
        const error = pipelineResult.lastResult?.abort?.error;
        const errorMessage =
          error?.message || pipelineResult.lastResult?.abort?.reason || 'AI client error';

        // Log to structured logger
        this.unifiedLogger.error(
          `Stopping workflow due to AI client error: ${errorMessage}`,
          error || new Error(errorMessage),
          this.loggerContext
        );

        // Emit to console logger
        this.emitLog('error', `Stopping workflow: ${errorMessage}`);

        // Also output directly to console for immediate visibility
        this.originalConsole.error('\n❌ AI Client Error - Stopping Workflow');
        this.originalConsole.error(`   ${errorMessage}`);
        if (error instanceof Error && error.stack) {
          this.originalConsole.error('\n   Error details:');
          this.originalConsole.error(error.stack.split('\n').slice(0, 3).join('\n'));
        }
        this.originalConsole.error('\n');

        // Stop the workflow gracefully
        await this.stop();
        return;
      }

      return;
    } catch (error) {
      const cycleError = error instanceof Error ? error : new Error(String(error));
      this.emitLog('error', `Error in trading cycle: ${error}`);

      // Record error in unified logger
      this.unifiedLogger.recordError(cycleError, {
        cycleId: this.state.cycleCount,
        operationId: cycleOperationId,
      });

      // Emit cycle error event
      this.emitEvent(CycleEvents.Error, {
        cycleCount: this.state.cycleCount,
        error: cycleError.message,
        timestamp: Date.now(),
      });

      // Complete cycle operation with error
      if (cycleOperationId) {
        this.unifiedLogger.completeOperation(cycleOperationId, 'failed', undefined, cycleError);
      }
    } finally {
      this.isCycleRunning = false;
      // Chain next cycle if still running and not paused
      // When bar-driven scheduling is enabled, suppress timer-based chaining
      if (this.state.isRunning && !this.isPaused && !this.barDrivenEnabled) {
        const elapsed = Date.now() - this.state.lastUpdate;
        const delay = Math.max(0, this.config.cyclePeriod - elapsed);
        if (this.nextTimeout) clearTimeout(this.nextTimeout);
        this.nextTimeout = setTimeout(async () => {
          await this.executeCycle();
        }, delay);
      }
    }
  }

  /**
   * Execute a single trading signal
   * Extracted from executeCycle for better organization and testability
   * @returns OrderResult to indicate success/failure and allow position refresh
   */
  private async executeSignal(
    cycleOperationId: string,
    signal: TradingSignal,
    account: Account,
    positions: Position[],
    _tickerCache: Map<string, { price: number; timestamp: number }>,
    currentPrice: number,
    atr14?: number,
    indicators?: import('../types/index.js').TechnicalIndicators
  ): Promise<{
    success: boolean;
    order?: { id: string };
    error?: string;
    decisionInfo?: {
      coin: string;
      action: string;
      validation: { passed: boolean; reason?: string };
      sizing: {
        passed: boolean;
        leverage?: number;
        suggestedSize?: number;
        riskAmount?: number;
        regime?: string;
        atrAdjustment?: number;
      };
      execution: {
        expectedPrice: number;
        actualPrice?: number;
        slippage?: number;
        slippageAbs?: number;
        orderId?: string;
      };
    };
  }> {
    try {
      const symbol = `${signal.coin}/USDT`;

      // Validate signal before execution
      const validationResult = this.riskManager.validateSignal(signal, account, positions);

      // Record validation check
      this.unifiedLogger.recordValidationCheck(cycleOperationId, 'execute_signals', {
        name: 'signal_validation',
        passed: validationResult.valid,
        reason: validationResult.reason,
        details: {
          coin: signal.coin,
          action: signal.action,
          confidence: signal.confidence,
        },
      });

      if (!validationResult.valid) {
        this.state.rejectedSignals++;
        this.state.rejectedSignalsCycle++;
        return {
          success: false,
          error: validationResult.reason || 'Signal validation failed',
          decisionInfo: {
            coin: signal.coin,
            action: signal.action,
            validation: { passed: false, reason: validationResult.reason },
            sizing: { passed: false },
            execution: { expectedPrice: currentPrice },
          },
        };
      }

      // Handle HOLD signals early - no sizing or execution validation needed
      if (signal.action === 'HOLD') {
        const hasPosition = positions.some(p => p.symbol === `${signal.coin}/USDT`);
        this.emitLog(
          'info',
          hasPosition
            ? `⏸️  ${signal.coin}: HOLD - monitoring existing position`
            : `⏸️  ${signal.coin}: HOLD - no action`
        );
        return {
          success: true,
          decisionInfo: {
            coin: signal.coin,
            action: signal.action,
            validation: { passed: true },
            sizing: { passed: true },
            execution: { expectedPrice: currentPrice },
          },
        };
      }

      // Get position sizing info for detailed logging (non-HOLD signals only)
      // Check if trading should be paused due to drawdown
      if (this.state.drawdownState === 'paused') {
        this.state.rejectedSignals++;
        this.state.rejectedSignalsCycle++;
        this.emitLog(
          'warn',
          `⚠️  ${signal.coin}: ${signal.action} signal rejected (trading paused due to drawdown)`
        );
        return {
          success: false,
          error: 'Trading paused due to drawdown',
          decisionInfo: {
            coin: signal.coin,
            action: signal.action,
            validation: { passed: true },
            sizing: { passed: false },
            execution: { expectedPrice: currentPrice },
          },
        };
      }

      const sizing = this.riskManager.calculatePositionSizing(
        signal,
        account,
        positions,
        currentPrice,
        atr14,
        indicators,
        this.state.drawdownState,
        this.state.peakEquity
      );

      // Detect market regime for decision path (simplified logic)
      let regime: 'trending' | 'ranging' | 'unknown' = 'unknown';
      if (indicators && currentPrice > 0) {
        // Use Bollinger Bandwidth as indicator (narrow = ranging, wide = trending)
        const bandwidth = indicators.bollinger?.bandwidth;
        if (bandwidth !== undefined) {
          regime = bandwidth < 0.02 ? 'ranging' : 'trending';
        }
      }

      // Record sizing calculation check (non-HOLD signals only)
      this.unifiedLogger.recordValidationCheck(cycleOperationId, 'execute_signals', {
        name: 'position_sizing',
        passed: sizing !== null,
        reason: sizing === null ? 'Risk limit or max positions reached' : undefined,
        details: sizing
          ? {
              suggestedSize: sizing.suggestedSize,
              maxSize: sizing.maxSize,
              riskAmount: sizing.riskAmount,
              leverage: sizing.leverage,
            }
          : undefined,
      });

      // Check if sizing calculation failed
      if (!sizing) {
        this.state.rejectedSignals++;
        this.state.rejectedSignalsCycle++;
        this.emitLog(
          'warn',
          `⚠️  ${signal.coin}: ${signal.action} signal rejected (risk limit or max positions reached)`
        );
        return {
          success: false,
          error: 'Position sizing calculation failed',
          decisionInfo: {
            coin: signal.coin,
            action: signal.action,
            validation: { passed: true },
            sizing: { passed: false },
            execution: { expectedPrice: currentPrice },
          },
        };
      }

      // Execute the signal
      const result = await this.orderExecutor.executeSignal(
        signal,
        account,
        positions,
        currentPrice
      );

      if (result.success && result.order) {
        this.state.totalTrades++;

        // Use actual order execution price, not estimated ticker price
        // For market orders, order.price may be 0 or undefined - use currentPrice as fallback
        // For limit orders, order.price should be the execution price
        const actualPrice =
          result.order.price && result.order.price > 0 ? result.order.price : currentPrice;

        // Calculate slippage (only if we have valid prices)
        const slippage =
          currentPrice > 0 && actualPrice > 0
            ? ((actualPrice - currentPrice) / currentPrice) * 100
            : 0;
        const slippageAbs = Math.abs(slippage);

        // Record execution details to stage for direct queryability
        this.unifiedLogger.recordExecutionDetails(cycleOperationId, 'execute_signals', {
          orderId: result.order.id,
          expectedPrice: currentPrice,
          actualPrice,
          slippage,
          slippageAbs,
          realizedPnl: result.realizedPnl,
          fees: result.fees,
          sizing: sizing
            ? {
                suggestedSize: sizing.suggestedSize,
                leverage: sizing.leverage,
                riskAmount: sizing.riskAmount,
              }
            : undefined,
        });

        // Also record execution validation check for validation logic
        this.unifiedLogger.recordValidationCheck(cycleOperationId, 'execute_signals', {
          name: 'execution_price_validation',
          passed: slippageAbs <= 5, // 5% tolerance
          reason:
            slippageAbs > 5 ? `Significant price deviation: ${slippage.toFixed(2)}%` : undefined,
          threshold: 5,
          actual: slippageAbs,
          details: {
            expectedPrice: currentPrice,
            actualPrice,
            slippage,
            slippageAbs,
            orderId: result.order.id,
            realizedPnl: result.realizedPnl,
            fees: result.fees,
            sizing: sizing
              ? {
                  suggestedSize: sizing.suggestedSize,
                  leverage: sizing.leverage,
                  riskAmount: sizing.riskAmount,
                }
              : undefined,
          },
        });

        // Guard: warn if execution price deviates significantly from current ticker (possible symbol mismatch)
        // Only warn if we got an actual fill price from the exchange (not the fallback)
        // and the deviation is very significant (>10%) to avoid false positives from normal slippage
        try {
          const hasActualFillPrice = result.order.price && result.order.price > 0;
          if (hasActualFillPrice) {
            const ref = currentPrice;
            const relDiff = ref ? Math.abs(actualPrice - ref) / ref : 0;
            // Use 10% threshold (increased from 5%) to allow for normal market order slippage
            // Only warn on very significant deviations that might indicate a symbol mismatch
            if (relDiff > 0.1) {
              this.unifiedLogger.warn(
                'Symbol/price mismatch suspected',
                {
                  coin: signal.coin,
                  symbol,
                  executionPrice: actualPrice,
                  tickerPrice: ref,
                  relativeDiff: relDiff,
                },
                this.loggerContext
              );
            }
          }
        } catch {
          // Non-critical
        }

        if (signal.action === 'CLOSE') {
          // For CLOSE, avoid leverage/margin estimates (misleading for exits)
          const detailMsg = this.cycleDisplay.formatExecutionMessage({
            action: 'CLOSE',
            coin: signal.coin,
            price: actualPrice,
            realizedPnl: result.realizedPnl,
            fees: result.fees,
          });
          this.emitLog('success', detailMsg);
        } else {
          const leverage = sizing.leverage || 1;
          // Calculate estimates for display (actual values will be in position data)
          // Note: Notional and Position Value are both UNLEVERED (size * price) to match account status terminology
          // Margin = notional / leverage, consistent with standard trading definitions
          const estimatedPositionValue = sizing.suggestedSize * actualPrice;
          const estimatedMargin = estimatedPositionValue / leverage;
          const estimatedNotional = estimatedPositionValue; // Notional is unlevered (matches aggregates.totalNotional)

          const detailMsg = this.cycleDisplay.formatExecutionMessage({
            action: signal.action,
            coin: signal.coin,
            price: actualPrice,
            leverage,
            notional: estimatedNotional,
            margin: estimatedMargin,
          });
          this.emitLog('success', detailMsg);
        }
      } else if (!result.success) {
        this.emitLog(
          'error',
          `❌ Failed to execute ${signal.action} signal for ${signal.coin}: ${result.error}`
        );
      }

      // Calculate ATR adjustment for decision info
      const atrAdjustment =
        atr14 && currentPrice > 0
          ? (this.riskManager as any).detectRegime?.(indicators, currentPrice) === 'trending'
            ? 1.33
            : (this.riskManager as any).detectRegime?.(indicators, currentPrice) === 'ranging'
              ? 0.75
              : 1.0
          : undefined;

      // Return result for caller to know if positions should be refreshed
      return {
        success: result.success,
        order: result.order,
        error: result.error,
        decisionInfo: {
          coin: signal.coin,
          action: signal.action,
          validation: { passed: true },
          sizing: {
            passed: true,
            leverage: sizing.leverage,
            suggestedSize: sizing.suggestedSize,
            riskAmount: sizing.riskAmount,
            regime: regime !== 'unknown' ? regime : undefined,
            atrAdjustment,
          },
          execution: {
            expectedPrice: currentPrice,
            actualPrice:
              result.success && result.order && result.order.price && result.order.price > 0
                ? result.order.price
                : result.success && result.order
                  ? currentPrice // Market order or price not available - use expected price
                  : undefined,
            slippage:
              result.success && result.order && currentPrice > 0
                ? result.order.price && result.order.price > 0
                  ? ((result.order.price - currentPrice) / currentPrice) * 100
                  : 0 // Market order - no slippage calculated (price not available from exchange)
                : undefined,
            slippageAbs:
              result.success && result.order
                ? currentPrice > 0
                  ? Math.abs(((result.order.price || currentPrice) - currentPrice) / currentPrice)
                  : undefined
                : undefined,
            orderId: result.success && result.order ? result.order.id : undefined,
          },
        },
      };
    } catch (error) {
      this.emitLog('error', `Error executing signal for ${signal.coin}: ${error}`);
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  /**
   * Validate and log account consistency issues
   */
  private validateAccountConsistency(
    account: Account,
    positions: Position[],
    totalMarginUsed: number
  ): void {
    const validation = validateAccount(account, positions, totalMarginUsed);
    if (!validation.isValid) {
      if (validation.equityCheck && !validation.equityCheck.isValid) {
        this.unifiedLogger.warn(
          'Equity calculation mismatch detected in cycle summary',
          {
            cycle: this.state.cycleCount,
            ...validation.equityCheck,
          },
          this.loggerContext
        );
        // Suppress direct console output; structured log above already recorded
      }
      if (validation.marginCheck && !validation.marginCheck.isValid) {
        this.unifiedLogger.warn(
          'Available margin calculation mismatch detected in cycle summary',
          {
            cycle: this.state.cycleCount,
            ...validation.marginCheck,
          },
          this.loggerContext
        );
        // Suppress direct console output; structured log above already recorded
      }
    }
  }

  /**
   * Log structured cycle summary for background mode
   */
  private logStructuredCycleSummary(
    account: Account,
    positions: Position[],
    signals: TradingSignal[],
    aggregates: PositionAggregates,
    pnlMetrics: {
      totalPnl: number;
      totalPnlPercent: number;
      unrealizedPnl: number;
      unrealizedPnlPercent: number;
    },
    runtimeMinutes: number,
    runtimeSeconds: number,
    formattedSummary?: string
  ): void {
    // Always log structured summary (removed background mode check)
    // Include formatted summary in metadata so it can be displayed via "quanta log view"

    this.unifiedLogger.info(
      formattedSummary || 'Cycle Summary',
      {
        cycle: this.state.cycleCount,
        runtime: `${runtimeMinutes}m ${runtimeSeconds}s`,
        totalCycles: this.state.cycleCount,
        aiSignals: signals.length,
        executedTrades: this.state.totalTrades,
        openPositions: positions.length,
        account: {
          equity: account.equity,
          availableMargin: account.availableMargin,
          usedMargin: aggregates.totalMarginUsed,
          unleveredExposure: aggregates.totalUnleveredExposure,
          leverage:
            account.equity > 0
              ? (aggregates.totalUnleveredExposure / account.equity).toFixed(2)
              : '0',
          totalPnl: pnlMetrics.totalPnl,
          totalPnlPercent: pnlMetrics.totalPnlPercent,
          unrealizedPnl: pnlMetrics.unrealizedPnl,
          unrealizedPnlPercent: pnlMetrics.unrealizedPnlPercent,
        },
        positions: positions.map(p => ({
          symbol: p.symbol,
          side: p.side,
          leverage: p.leverage,
          marginUsed: p.marginUsed,
          entryPrice: p.entryPrice,
          unrealizedPnl: p.unrealizedPnl,
        })),
        winRate: this.state.winRate,
        // Store formatted summary so it can be retrieved by "quanta log view"
        _formattedSummary: formattedSummary,
      },
      this.loggerContext
    );
  }

  private logCycleSummary(
    account: Account,
    positions: Position[],
    signals: TradingSignal[],
    aggregates: PositionAggregates,
    cycleMetrics: { rejectedSignalsCycle: number; tradeCountCycle: number }
  ): void {
    const runtime = this.cycleSummaryFormatter.calculateRuntimeMetrics(this.state.startTime);
    const pnlMetricsResult = this.performanceMetricsCalculator.calculatePnLMetrics(
      this.state,
      account,
      aggregates
    );
    this.state = pnlMetricsResult.updatedState;
    const pnlMetrics = pnlMetricsResult;
    const cycleMetricsData = this.cycleSummaryFormatter.calculateCycleMetrics(
      account,
      positions,
      signals,
      aggregates,
      cycleMetrics,
      this.config.maxPositions
    );

    // Validate account consistency
    this.validateAccountConsistency(account, positions, aggregates.totalMarginUsed);

    // Format cycle summary for structured logs
    const formattedSummary = this.cycleSummaryFormatter.formatCycleSummary(
      runtime.string,
      this.state.cycleCount,
      cycleMetricsData,
      account,
      positions,
      aggregates,
      pnlMetrics,
      this.state.winRate,
      this.cycleSummaryFormatter.calculateNextCycleCountdown(this.config.cyclePeriod),
      this.state.previousEquity
    );

    // Log to structured logs (both CLI and API server modes)
    // Users can view via "quanta log view --follow"
    this.logStructuredCycleSummary(
      account,
      positions,
      signals,
      aggregates,
      {
        totalPnl: pnlMetrics.totalPnl,
        totalPnlPercent: pnlMetrics.totalPnlPercent,
        unrealizedPnl: pnlMetrics.unrealizedPnl,
        unrealizedPnlPercent: pnlMetrics.unrealizedPnlPercent,
      },
      runtime.minutes,
      runtime.seconds,
      formattedSummary
    );

    // Log error if formatting failed
    if (!formattedSummary) {
      this.unifiedLogger.error(
        'Failed to format cycle summary',
        new Error('Formatting returned undefined'),
        this.loggerContext
      );
    }
  }

  // Removed logConsoleCycleSummary and related helper methods
  // All cycle summary information is now logged via logStructuredCycleSummary()
  // Users can view detailed output using "quanta log view"

  /**
   * Get circuit breaker states from AI agent
   */
  private getCircuitBreakerStates(): Array<{
    name: string;
    state: 'CLOSED' | 'OPEN' | 'HALF_OPEN';
    failureCount: number;
    lastFailure?: number;
    lastSuccess?: number;
  }> {
    // Access circuit breaker from AI agent via reflection if needed
    // For now, return empty array as circuit breaker is private
    // TODO: Add public method to OpenRouterClient to get circuit breaker stats
    return [];
  }

  /**
   * Get recent operations summary for snapshot
   */
  private getRecentOperationsSummary(): Array<{
    operationId: string;
    type: string;
    status: 'running' | 'completed' | 'failed' | 'cancelled';
    duration: number;
  }> {
    try {
      const operationLogger = (this.unifiedLogger as any).operationLogger;
      if (operationLogger && typeof operationLogger.getActiveOperations === 'function') {
        const activeOps = operationLogger.getActiveOperations();
        return Array.from(activeOps.values())
          .slice(0, 10)
          .map((op: any) => ({
            operationId: op.operationId || 'unknown',
            type: op.operationType || 'unknown',
            status: (op.status || 'running') as 'running' | 'completed' | 'failed' | 'cancelled',
            duration: op.metrics?.duration || 0,
          }));
      }
    } catch {
      // Ignore errors
    }
    return [];
  }

  private generateReport(): void {
    const runtime = Date.now() - this.state.startTime;
    const runtimeMinutes = Math.floor(runtime / (1000 * 60));

    const report = {
      runtime: `${runtimeMinutes} minutes`,
      cycles: this.state.cycleCount,
      totalSignals: this.state.totalSignals,
      totalTrades: this.state.totalTrades,
      totalPnl: this.state.totalPnl,
      winRate: this.state.winRate,
    };

    this.unifiedLogger.info('Final Report', report, this.loggerContext);

    // Structured output - bypass interception (already in operation logs)
    if (!this.isBackgroundMode) {
      // Extract drone/arena context from loggerContext if in arena context
      let arenaId: string | undefined;
      let droneId: string | undefined;
      let droneName: string | undefined;
      if (this.loggerContext.startsWith('Arena:')) {
        const parts = this.loggerContext.split(':');
        if (parts.length >= 4 && parts[0] === 'Arena' && parts[2] === 'Drone') {
          arenaId = parts[1];
          droneId = parts[3];
          // Optional drone name (parts[4] if present)
          if (parts.length >= 5) {
            droneName = parts[4];
          }
        }
      }

      // Get ExecutionSession information
      const sessionManager = ExecutionSessionManager.getInstance();
      const activeSession = sessionManager.getActive();

      // Build report header
      let reportHeader = '\n📈 FINAL REPORT';
      if (arenaId && droneId) {
        if (droneName) {
          reportHeader += ` - Drone: ${droneName} (${droneId})`;
        } else {
          reportHeader += ` - Drone: ${droneId}`;
        }
      }
      if (activeSession) {
        reportHeader += ` | Session: ${activeSession.id}`;
      }

      this.logToConsole(reportHeader);
      this.logToConsole('='.repeat(50));
      this.logToConsole(`Runtime: ${runtimeMinutes} minutes`);
      this.logToConsole(`Cycles: ${this.state.cycleCount}`);
      this.logToConsole(`Total Signals: ${this.state.totalSignals}`);
      this.logToConsole(`Total Trades: ${this.state.totalTrades}`);
      this.logToConsole(`Total PnL: $${this.state.totalPnl.toFixed(2)}`);
      this.logToConsole(`Win Rate: ${this.state.winRate.toFixed(1)}%`);
      this.logToConsole('='.repeat(50));
    }
  }

  getState(): SystemState {
    return { ...this.state };
  }

  async pause(): Promise<void> {
    // Set paused flag first to prevent race condition
    this.isPaused = true;
    // Clear any pending timeouts
    if (this.nextTimeout) {
      clearTimeout(this.nextTimeout);
      this.nextTimeout = undefined;
    }
    // Note: This doesn't stop the current cycle if it's running.
    // The cycle will complete but won't schedule the next one (due to isPaused check in finally block)
    // To fully stop, use stop() instead
  }

  async resume(): Promise<void> {
    // Clear paused flag first
    this.isPaused = false;
    // Only resume if workflow is running, no cycle is currently executing, and no timeout is already scheduled
    if (
      !this.barDrivenEnabled &&
      !this.nextTimeout &&
      this.state.isRunning &&
      !this.isCycleRunning
    ) {
      this.nextTimeout = setTimeout(async () => {
        await this.executeCycle();
      }, this.config.cyclePeriod);
    }
  }

  updateConfig(newConfig: Partial<WorkflowConfig>): void {
    this.config = { ...this.config, ...newConfig };
    this.riskManager.updateRiskParams(newConfig.riskParams || {});
  }

  /**
   * Enable bar-driven scheduling. When enabled, completed bar events trigger cycles,
   * and timer-based chaining is disabled (acts as a fallback only).
   */
  enableBarDrivenScheduling(options: {
    symbols: string[];
    timeframes: BarTimeframe[];
    pollIntervalMs?: number;
  }): void {
    if (this.barDrivenEnabled) return;
    const symbols = new Set(options.symbols);
    const tfs = new Set(options.timeframes);
    // Subscribe to unified EventBus bar-close events
    const listener = (payload: {
      symbol: string;
      timeframe: string;
      openTime: number;
      closeTime: number;
    }) => {
      try {
        if (!this.state.isRunning || this.isPaused) return;
        if (!symbols.has(payload.symbol)) return;
        if (!tfs.has(payload.timeframe as BarTimeframe)) return;
        if (this.isCycleRunning) return;
        void this.executeCycle();
      } catch {
        // ignore
      }
    };
    EventBus.on('bar:closed', listener);
    this.barUnsubscribe = () => EventBus.off('bar:closed', listener as any);
    this.barDrivenEnabled = true;
    this.emitLog('info', '🟢 Bar-driven scheduling enabled (EventBus)');
  }
}

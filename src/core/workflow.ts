import { Exchange } from '../exchange/types.js';
import { MarketDataProvider, MarketData } from '../data/market.js';
import { OpenRouterClient, AIContext, EnrichedPositionInfo } from '../ai/agent.js';
import { RiskManager } from '../execution/risk.js';
import { OrderExecutor } from '../execution/orders.js';
import { PositionMonitorService } from '../execution/monitor.js';
import { Account, Position, TradingSignal } from '../types/index.js';
import { EventBus, TypedEventBus, type EventKey, type EventPayloads } from './event-bus.js';
import { BarScheduler, type BarTimeframe } from './scheduler.js';
import { aggregatePositionMetrics, PositionAggregates } from '../execution/position-utils.js';
import { validateAccount } from '../utils/account-validation.js';
import { CycleLogger, CycleDisplay } from './display/index.js';
import chalk from 'chalk';
import { ExchangeSnapshotService } from './exchange-snapshot.js';
// import { getConfig } from '../config/settings.js'; // Removed - no longer used
import { UnifiedLogger } from '../logging/index.js';
import { formatUTCTimeCompact, formatUTCLogTime } from '../utils/time.js';
import { createTickerPriceGetter } from '../utils/ticker-cache.js';
import { ExecutionSessionManager } from '../web/execution-session-manager.js';

// Decision information types for signal execution
interface SignalDecisionInfo {
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
}

// Decision information types for position monitoring
interface PositionDecisionInfo {
  symbol: string;
  side: string;
  decisions: Array<{
    type:
      | 'maintenance'
      | 'tp1'
      | 'breakeven'
      | 'auto_close'
      | 'stop_loss'
      | 'take_profit'
      | 'emergency';
    action: string;
    reason: string;
    details?: Record<string, any>;
  }>;
}

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
}

export interface WorkflowConfig {
  coins: string[];
  cyclePeriod: number; // milliseconds
  maxPositions: number;
  marketFetchParallel?: boolean;
  marketTimeframes?: string[]; // e.g., ['3m','4h']
  ai?: {
    prompt?: {
      candles?: { m3?: number; h4?: number };
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
  private barScheduler?: BarScheduler; // legacy fallback
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
    // Prefix message with drone and session info when in arena context
    let prefixedMessage = message;
    if (this.loggerContext.startsWith('Arena:')) {
      // Extract drone/arena context from loggerContext
      const parts = this.loggerContext.split(':');
      if (parts.length >= 4 && parts[0] === 'Arena' && parts[2] === 'Drone') {
        const droneId = parts[3];
        const droneName = parts.length >= 5 ? parts[4] : undefined;

        // Get ExecutionSession information
        const sessionManager = ExecutionSessionManager.getInstance();
        const activeSession = sessionManager.getActive();

        // Build prefix
        const prefixParts: string[] = [];
        if (droneName) {
          prefixParts.push(chalk.cyan(`[${droneName}]`));
        } else {
          prefixParts.push(chalk.cyan(`[Drone:${droneId}]`));
        }
        if (activeSession) {
          prefixParts.push(chalk.gray(`[Session:${activeSession.id}]`));
        }

        if (prefixParts.length > 0) {
          prefixedMessage = `${prefixParts.join(' ')} ${message}`;
        }
      }
    }

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

  /**
   * Format market data logs for a single coin
   */
  private formatMarketDataLogs(
    coin: string,
    marketData: MarketData[],
    coinMs: number,
    tickerPrice?: number,
    tickerTimestamp?: number,
    tickerError?: Error | unknown
  ): string[] {
    const logs: string[] = [];
    const tfList = marketData.map(d => d.timeframe).join(', ');
    const base = marketData[0];
    const tf3m = marketData.find(d => d.timeframe === '3m');
    const tf4h = marketData.find(d => d.timeframe === '4h');
    const last3m = tf3m?.candlesticks?.at(-1);
    const last4h = tf4h?.candlesticks?.at(-1);
    const ema20 = base?.indicators?.ema20;
    const ema50 = base?.indicators?.ema50;
    const rsi14 = base?.indicators?.rsi14;
    const macdVal = base?.indicators?.macd?.macd;
    const macdSig = base?.indicators?.macd?.signal;

    logs.push(
      chalk.gray(`   • ${coin}: fetched ${marketData.length} frames (${tfList}) in ${coinMs}ms`)
    );

    if (last3m) {
      logs.push(
        chalk.gray(
          `       [3m] close=$${last3m.close.toFixed(2)} @ ${formatUTCTimeCompact(last3m.timestamp)}`
        )
      );
    }
    if (last4h) {
      logs.push(
        chalk.gray(
          `       [4h] close=$${last4h.close.toFixed(2)} @ ${formatUTCLogTime(last4h.timestamp)}`
        )
      );
    }
    if (base?.indicators) {
      logs.push(
        chalk.gray(
          `       ind: EMA20=${ema20?.toFixed?.(2)} EMA50=${ema50?.toFixed?.(2)} RSI14=${rsi14?.toFixed?.(2)} MACD=${macdVal?.toFixed?.(4)}/${macdSig?.toFixed?.(4)}`
        )
      );
    }

    if (tickerError) {
      logs.push(
        chalk.gray(
          `       ticker: unavailable (${(tickerError as Error)?.message || String(tickerError)})`
        )
      );
    } else if (tickerPrice !== undefined) {
      logs.push(
        chalk.gray(
          `       ticker: $${tickerPrice.toFixed(2)} @ ${formatUTCTimeCompact(tickerTimestamp ?? Date.now())}`
        )
      );
    }

    return logs;
  }

  /**
   * Fetch market data for all coins (parallel mode)
   */
  private async fetchMarketDataParallel(
    coins: string[],
    timeframes: string[],
    tickerCache: Map<string, { price: number; timestamp: number }>,
    getTickerPrice: (symbol: string) => Promise<number>
  ): Promise<{ marketData: MarketData[]; successCount: number; failCount: number }> {
    type CoinResult = {
      coin: string;
      ok: boolean;
      marketData?: MarketData[];
      logs: string[];
    };

    const tasks = coins.map(async coin => {
      const symbol = `${coin}/USDT`;
      const logs: string[] = [];
      try {
        const coinStart = Date.now();
        const marketData = await this.marketDataProvider.getMarketData(symbol, timeframes);
        const coinMs = Date.now() - coinStart;

        let tickerPrice: number | undefined;
        let tickerTimestamp: number | undefined;
        let tickerError: Error | unknown;
        try {
          const price = await getTickerPrice(symbol);
          tickerPrice = price;
          const cached = tickerCache.get(symbol);
          tickerTimestamp = cached?.timestamp;
        } catch (err) {
          tickerError = err;
        }

        const coinLogs = this.formatMarketDataLogs(
          coin,
          marketData,
          coinMs,
          tickerPrice,
          tickerTimestamp,
          tickerError
        );
        logs.push(...coinLogs);

        return { coin, ok: true, marketData, logs } as CoinResult;
      } catch (e) {
        logs.push(`   • ${coin}: failed to fetch market data (${(e as Error).message || e})`);
        return { coin, ok: false, logs } as CoinResult;
      }
    });

    const settled = await Promise.allSettled(tasks);
    const results: CoinResult[] = settled.map(s =>
      s.status === 'fulfilled' ? s.value : { coin: 'unknown', ok: false, logs: [String(s.reason)] }
    );

    const allMarketData: MarketData[] = [];
    let successCount = 0;
    let failCount = 0;

    // Emit logs per coin in configured order for stable output
    for (const coin of coins) {
      const r = results.find(x => x.coin === coin);
      if (!r) continue;
      if (r.ok && r.marketData) {
        successCount++;
        allMarketData.push(...r.marketData);
      } else {
        failCount++;
      }
      for (const line of r.logs) this.emitLog('info', line);
    }

    return { marketData: allMarketData, successCount, failCount };
  }

  /**
   * Process and display generated signals
   */
  private async processSignals(
    signals: TradingSignal[],
    tickerCache: Map<string, { price: number; timestamp: number }>
  ): Promise<void> {
    if (signals.length === 0) return;

    const getCachedPrice = createTickerPriceGetter(
      tickerCache,
      this.snapshotService,
      this.unifiedLogger,
      this.loggerContext
    );

    const signalSummary = `🤖 Generated ${signals.length} signal${signals.length > 1 ? 's' : ''}:`;
    if (this.isBackgroundMode) {
      this.emitLog('info', signalSummary);
    }

    // Log to structured logger for file output (background mode only to avoid buffering delays)
    if (this.isBackgroundMode) {
      this.unifiedLogger.info(
        'AI Signal Generation',
        {
          signalCount: signals.length,
          signals: signals.map(s => ({
            coin: s.coin,
            action: s.action,
            confidence: s.confidence,
            reasoning: s.reasoning,
          })),
        },
        this.loggerContext
      );
    }

    // Console output with formatting (only if not background mode)
    if (!this.isBackgroundMode) {
      const signalsFormatted = this.cycleDisplay.formatSignals(signals);
      this.cycleLogger.logFormatted(signalsFormatted);
    }

    // Push signals to UI buffer via event bus (decoupled)
    for (let i = 0; i < signals.length; i++) {
      const sig = signals[i];
      const action = sig.action;
      const symbol = `${sig.coin}/USDT`;
      const price = await getCachedPrice(symbol);
      this.emitEvent('signal:buffer', {
        id: `${sig.coin}-${Date.now()}-${i}-${Math.random().toString(36).slice(2, 6)}`,
        timestamp: Date.now(),
        symbol,
        action,
        confidence: sig.confidence,
        reasoning: sig.reasoning,
        price,
        strategy: 'AI',
        status: 'generated',
      });
    }
  }

  /**
   * Fetch market data for all coins (sequential mode)
   */
  private async fetchMarketDataSequential(
    coins: string[],
    timeframes: string[],
    tickerCache: Map<string, { price: number; timestamp: number }>,
    getTickerPrice: (symbol: string) => Promise<number>
  ): Promise<{ marketData: MarketData[]; successCount: number; failCount: number }> {
    const allMarketData: MarketData[] = [];
    let successCount = 0;
    let failCount = 0;

    for (const coin of coins) {
      const symbol = `${coin}/USDT`;
      try {
        const coinStart = Date.now();
        const marketData = await this.marketDataProvider.getMarketData(symbol, timeframes);
        const coinMs = Date.now() - coinStart;
        allMarketData.push(...marketData);
        successCount++;

        let tickerPrice: number | undefined;
        let tickerTimestamp: number | undefined;
        let tickerError: Error | unknown;
        try {
          const price = await getTickerPrice(symbol);
          tickerPrice = price;
          const cached = tickerCache.get(symbol);
          tickerTimestamp = cached?.timestamp;
        } catch (err) {
          tickerError = err;
        }

        const logs = this.formatMarketDataLogs(
          coin,
          marketData,
          coinMs,
          tickerPrice,
          tickerTimestamp,
          tickerError
        );
        for (const line of logs) this.emitLog('info', line);
      } catch (e) {
        failCount++;
        this.emitLog(
          'warn',
          `   • ${coin}: failed to fetch market data (${(e as Error).message || e})`
        );
      }
    }

    return { marketData: allMarketData, successCount, failCount };
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
      this.emitEvent('cycle:start', {
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

      // Helper to get ticker price with caching
      // Returns undefined if price is invalid or unavailable (caller must handle)
      const getTickerPrice = createTickerPriceGetter(
        tickerCache,
        this.snapshotService,
        this.unifiedLogger,
        this.loggerContext
      );

      // 2. Monitor existing positions
      this.unifiedLogger.startStage(cycleOperationId, 'monitor_positions', {
        positionsCount: positions.length,
      });
      let positionDecisionInfos: PositionDecisionInfo[] = [];

      if (positions.length > 0) {
        // Enrich positions with custom exit plans if getter is available
        const enrichedPositions = this.getCustomExitPlans
          ? positions.map(p => {
              const customPlan = this.getCustomExitPlans!(p.symbol, p.side);
              return {
                ...p,
                customStopLoss: customPlan.stopLoss,
                customTakeProfit: customPlan.takeProfit,
              };
            })
          : positions;

        const monitorStartTime = Date.now();
        positionDecisionInfos = await this.positionMonitor.monitorPositions(
          enrichedPositions,
          this.exchange,
          getTickerPrice
        );
        const monitorDuration = Date.now() - monitorStartTime;

        // Build decision path for monitor_positions
        const positionsWithDecisions = positionDecisionInfos.filter(p => p.decisions.length > 0);
        const totalDecisions = positionDecisionInfos.reduce(
          (sum, p) => sum + p.decisions.length,
          0
        );

        if (totalDecisions > 0) {
          // Group decisions by type
          const decisionsByType: Record<string, number> = {};
          for (const pos of positionDecisionInfos) {
            for (const decision of pos.decisions) {
              decisionsByType[decision.type] = (decisionsByType[decision.type] || 0) + 1;
            }
          }

          // Record validation checks for each position decision
          for (const pos of positionsWithDecisions) {
            for (const decision of pos.decisions) {
              const checkName = `${decision.type}_${pos.symbol}`;
              const checkReason = `${pos.symbol} (${pos.side}): ${decision.action} - ${decision.reason}`;

              this.unifiedLogger.recordValidationCheck(cycleOperationId, 'monitor_positions', {
                name: checkName,
                passed: true,
                reason: checkReason,
                details: {
                  symbol: pos.symbol,
                  side: pos.side,
                  decisionType: decision.type,
                  action: decision.action,
                  reason: decision.reason,
                  ...decision.details,
                },
              });
            }
          }

          // Build decision summary
          const decisionParts: string[] = [];
          if (decisionsByType['tp1']) {
            decisionParts.push(`${decisionsByType['tp1']} TP1 (50% close)`);
          }
          if (decisionsByType['breakeven']) {
            decisionParts.push(`${decisionsByType['breakeven']} breakeven`);
          }
          if (decisionsByType['auto_close']) {
            decisionParts.push(`${decisionsByType['auto_close']} auto-close`);
          }
          if (decisionsByType['stop_loss']) {
            decisionParts.push(`${decisionsByType['stop_loss']} stop loss`);
          }
          if (decisionsByType['take_profit']) {
            decisionParts.push(`${decisionsByType['take_profit']} take profit`);
          }
          if (decisionsByType['maintenance']) {
            decisionParts.push(`${decisionsByType['maintenance']} maintenance`);
          }
          if (decisionsByType['emergency']) {
            decisionParts.push(`${decisionsByType['emergency']} emergency`);
          }
          const decision =
            decisionParts.length > 0
              ? `Monitored ${positions.length} positions: ${decisionParts.join(', ')}`
              : `Monitored ${positions.length} positions: no actions`;

          // Build detailed reason
          const reasonParts: string[] = [];
          reasonParts.push(
            `Monitored ${positions.length} positions, ${totalDecisions} decisions made`
          );

          if (positionsWithDecisions.length > 0) {
            reasonParts.push(`\nPositions with actions (${positionsWithDecisions.length}):`);
            for (const pos of positionsWithDecisions.slice(0, 5)) {
              // Top 5
              const decisionSummary = pos.decisions.map(d => d.type).join(', ');
              reasonParts.push(`  • ${pos.symbol} (${pos.side}): ${decisionSummary}`);
              for (const decision of pos.decisions.slice(0, 2)) {
                reasonParts.push(`    → ${decision.action}: ${decision.reason}`);
              }
            }
            if (positionsWithDecisions.length > 5) {
              reasonParts.push(`  ... and ${positionsWithDecisions.length - 5} more`);
            }
          }

          const reason = reasonParts.join('\n');

          // Record operation-level decision path (append to existing)
          this.unifiedLogger.appendDecisionChoice(cycleOperationId, {
            step: 'monitor_positions',
            decision,
            reason,
            factors: {
              positions: positionDecisionInfos,
              summary: {
                total: positions.length,
                withDecisions: positionsWithDecisions.length,
                totalDecisions,
              },
              decisionsByType,
              decisionsDetail: positionDecisionInfos.map(p => ({
                symbol: p.symbol,
                side: p.side,
                decisions: p.decisions,
              })),
            },
          });
        }

        this.unifiedLogger.completeStage(cycleOperationId, 'monitor_positions', {
          duration: monitorDuration,
        });
      } else {
        this.unifiedLogger.completeStage(cycleOperationId, 'monitor_positions', {
          duration: 0,
        });
      }

      // Guard: check if stopped mid-cycle
      if (!this.state.isRunning) {
        return;
      }

      // 2.5. Refresh snapshot after monitoring (monitor may have closed positions)
      // This ensures AI signal generation and signal execution use the latest position state
      this.unifiedLogger.startStage(cycleOperationId, 'refresh_snapshot_after_monitoring', {});
      const refreshStartTime = Date.now();
      const { account: updatedAccount, positions: updatedPositions } =
        await this.snapshotService.getSnapshot();
      const refreshDuration = Date.now() - refreshStartTime;
      this.unifiedLogger.recordAPILatency('exchange.getAccount', refreshDuration);
      this.unifiedLogger.completeStage(cycleOperationId, 'refresh_snapshot_after_monitoring', {
        positionsCount: updatedPositions.length,
        positionsDiff: positions.length - updatedPositions.length,
        duration: refreshDuration,
      });

      // Log if positions changed after monitoring
      if (positions.length !== updatedPositions.length) {
        this.unifiedLogger.info(
          'Positions changed after monitoring',
          {
            before: positions.length,
            after: updatedPositions.length,
            closed: positions.length - updatedPositions.length,
          },
          this.loggerContext
        );
      }

      // 3. Get market data for all coins
      this.emitLog('info', chalk.gray('⏳ Fetching market data...'));
      this.unifiedLogger.startStage(cycleOperationId, 'fetch_market_data', {
        coins: this.config.coins,
        timeframes: this.config.marketTimeframes ?? ['3m', '4h'],
      });
      const fetchStart = Date.now();
      const timeframes = this.config.marketTimeframes ?? ['3m', '4h'];

      // Fetch market data based on configuration
      const marketDataResult =
        this.config.marketFetchParallel !== false
          ? await this.fetchMarketDataParallel(
              this.config.coins,
              timeframes,
              tickerCache,
              getTickerPrice
            )
          : await this.fetchMarketDataSequential(
              this.config.coins,
              timeframes,
              tickerCache,
              getTickerPrice
            );

      const { marketData: allMarketData, successCount, failCount } = marketDataResult;
      const fetchMs = Date.now() - fetchStart;

      // Calculate data quality metrics
      const expectedItems = this.config.coins.length * timeframes.length;
      const missingItems: string[] = [];
      const gaps: Array<{
        symbol: string;
        timeframe: string;
        missingFrom: number;
        missingTo: number;
      }> = [];
      let latestTimestamp = 0;
      let staleCount = 0;

      for (const coin of this.config.coins) {
        for (const timeframe of timeframes) {
          const key = `${coin}:${timeframe}`;
          const data = allMarketData.find(md => md.coin === coin && md.timeframe === timeframe);
          if (!data) {
            missingItems.push(key);
          } else {
            // Check for latest timestamp
            if (data.candlesticks.length > 0) {
              const lastCandle = data.candlesticks[data.candlesticks.length - 1];
              if (lastCandle.timestamp > latestTimestamp) {
                latestTimestamp = lastCandle.timestamp;
              }
            }
            // Check if stale
            if (data.isStale || (data.cacheAge && data.cacheAge > 60000)) {
              staleCount++;
            }
            // Detect gaps in candlesticks
            if (data.candlesticks.length > 1) {
              const timeframeMs = timeframe === '3m' ? 3 * 60 * 1000 : 4 * 60 * 60 * 1000;
              for (let i = 1; i < data.candlesticks.length; i++) {
                const gap = data.candlesticks[i].timestamp - data.candlesticks[i - 1].timestamp;
                if (gap > timeframeMs * 1.5) {
                  gaps.push({
                    symbol: `${coin}/USDT`,
                    timeframe,
                    missingFrom: data.candlesticks[i - 1].timestamp + timeframeMs,
                    missingTo: data.candlesticks[i].timestamp - timeframeMs,
                  });
                }
              }
            }
          }
        }
      }

      const dataQuality = {
        freshness: latestTimestamp > 0 ? Date.now() - latestTimestamp : 0,
        isStale: staleCount > 0,
        completeness: expectedItems > 0 ? allMarketData.length / expectedItems : 0,
        gapsCount: gaps.length,
      };

      this.unifiedLogger.recordDataQuality(cycleOperationId, 'fetch_market_data', dataQuality);

      const marketDataQuality = {
        expectedItems,
        actualItems: allMarketData.length,
        missingItems: missingItems.length > 0 ? missingItems : undefined,
        gaps: gaps.length > 0 ? gaps : undefined,
        staleCount,
        latestTimestamp,
      };

      this.unifiedLogger.completeStage(cycleOperationId, 'fetch_market_data', {
        itemsCount: allMarketData.length,
        successCount,
        failCount,
        duration: fetchMs,
        dataQuality: marketDataQuality,
      });

      // Record operation-level data quality metrics
      this.unifiedLogger.recordOperationDataQuality(cycleOperationId, {
        freshness: {
          latestTimestamp,
          ageMs: dataQuality.freshness,
          isStale: dataQuality.isStale,
        },
        completeness: {
          expectedItems,
          actualItems: allMarketData.length,
          missingItems: missingItems.length > 0 ? missingItems : undefined,
        },
        gaps: gaps.length > 0 ? gaps : undefined,
      });
      this.emitLog(
        'info',
        chalk.gray(
          `✅ Market data ready: ${allMarketData.length} items | ${successCount} ok / ${failCount} failed | ${this.config.coins.length} coin(s) in ${fetchMs}ms`
        )
      );

      // Validate market data before generating signals
      // If all market data fails or insufficient data, skip signal generation
      if (successCount === 0 || allMarketData.length === 0) {
        this.emitLog(
          'warn',
          `⚠️  No market data available - skipping signal generation for this cycle`
        );
        this.unifiedLogger.warn(
          'Cycle aborted due to insufficient market data',
          {
            cycleCount: this.state.cycleCount,
            successCount,
            failCount,
            coins: this.config.coins.length,
          },
          this.loggerContext
        );

        // Record error and complete cycle
        this.unifiedLogger.recordError(new Error('Insufficient market data'), {
          cycleId: this.state.cycleCount,
          operationId: cycleOperationId,
        });
        this.unifiedLogger.completeStage(
          cycleOperationId,
          'fetch_market_data',
          undefined,
          new Error('Insufficient market data')
        );
        this.unifiedLogger.completeOperation(
          cycleOperationId,
          'failed',
          undefined,
          new Error('Insufficient market data')
        );
        return; // Skip signal generation and execution
      }

      // 4. Generate AI signals
      this.emitLog('info', chalk.gray('⏳ Generating AI signals...'));
      this.unifiedLogger.startStage(cycleOperationId, 'generate_signals', {
        marketDataCount: allMarketData.length,
      });
      const context: AIContext = {
        startTime: this.state.startTime,
        currentTime: Date.now(),
        invokeCount: this.state.cycleCount,
        tradableCoins: this.config.coins,
        maxPositions: this.config.maxPositions,
        maxRiskPerTrade: this.config.riskParams.maxRiskPerTrade,
        maxLeverage: this.config.riskParams.maxLeverage,
        minLeverage: this.config.riskParams.minLeverage,
        defaultStopLoss: this.config.riskParams.defaultStopLoss,
        promptOptions: {
          candles3m: this.config.ai?.prompt?.candles?.m3 ?? 10,
          candles4h: this.config.ai?.prompt?.candles?.h4 ?? 5,
          sections: {
            candlesTA: this.config.ai?.prompt?.sections?.candlesTA ?? true,
            sentiment: this.config.ai?.prompt?.sections?.sentiment ?? true,
            technicalState: this.config.ai?.prompt?.sections?.technicalState ?? true,
          },
        },
      };

      const signalStartTime = Date.now();
      let signals: TradingSignal[] = [];
      let signalError: Error | undefined;

      try {
        // Calculate enriched position information for AI
        // This provides accurate stop-loss/take-profit prices and exit status
        const enrichedPositions: EnrichedPositionInfo[] = [];
        for (const position of updatedPositions) {
          // Get current price from ticker cache or market data
          let currentPrice: number | undefined = tickerCache.get(position.symbol)?.price;

          // If not in cache, try to get from market data
          if (!currentPrice) {
            const positionMarketData = allMarketData.find(md => md.coin === position.symbol);
            if (positionMarketData) {
              currentPrice = positionMarketData.currentPrice;
            }
          }

          // If still no price, skip enrichment for this position
          if (!currentPrice || !isFinite(currentPrice) || currentPrice <= 0) {
            this.unifiedLogger.warn(
              `Cannot enrich position ${position.symbol}: invalid current price`,
              {},
              this.loggerContext
            );
            continue;
          }

          // Calculate effective stop loss and take profit prices
          const effectiveStopLoss = this.riskManager.getEffectiveStopLossPrice(
            position,
            currentPrice
          );
          const effectiveTakeProfit = this.riskManager.getEffectiveTakeProfitPrice(
            position,
            currentPrice
          );

          // Calculate distance to stop loss/take profit as percentage
          let distanceToStopLoss: number;
          let distanceToTakeProfit: number;

          if (position.side === 'long') {
            distanceToStopLoss = ((currentPrice - effectiveStopLoss) / effectiveStopLoss) * 100;
            distanceToTakeProfit = ((effectiveTakeProfit - currentPrice) / currentPrice) * 100;
          } else {
            // For short positions, stop loss is above entry, take profit is below
            distanceToStopLoss = ((effectiveStopLoss - currentPrice) / effectiveStopLoss) * 100;
            distanceToTakeProfit = ((currentPrice - effectiveTakeProfit) / currentPrice) * 100;
          }

          // Check for trailing stop, custom stop loss/take profit
          const hasTrailingStop =
            position.trailingStopPrice !== undefined && position.trailingStopPrice !== null;
          const hasCustomStopLoss =
            position.customStopLoss !== undefined && position.customStopLoss !== null;
          const hasCustomTakeProfit =
            position.customTakeProfit !== undefined && position.customTakeProfit !== null;

          // Get TP1 status from position monitor
          const tp1Executed = this.positionMonitor.getTp1Status(position.symbol);

          // Calculate R-multiple
          const rMultiple = this.riskManager.computeRMultiple(position, currentPrice);

          enrichedPositions.push({
            position,
            effectiveStopLoss,
            effectiveTakeProfit,
            currentPrice,
            distanceToStopLoss,
            distanceToTakeProfit,
            hasTrailingStop,
            hasCustomStopLoss,
            hasCustomTakeProfit,
            tp1Executed,
            rMultiple,
          });
        }

        // Use updated positions and account after monitoring
        // This ensures AI sees the latest state (positions closed by monitor, account updated by closed positions)
        // Pass enriched position information for accurate exit decision making
        signals = await this.aiAgent.generateTradingSignal(
          allMarketData,
          updatedAccount,
          updatedPositions,
          context,
          enrichedPositions
        );
        this.state.totalSignals += signals.length;
        const signalDuration = Date.now() - signalStartTime;
        this.unifiedLogger.recordAPILatency('ai.generateSignal', signalDuration);

        // Calculate signal quality metrics
        const actionCounts: Record<string, number> = {};
        const confidenceScores: number[] = [];
        for (const signal of signals) {
          actionCounts[signal.action] = (actionCounts[signal.action] || 0) + 1;
          confidenceScores.push(signal.confidence);
        }
        const avgConfidence =
          confidenceScores.length > 0
            ? confidenceScores.reduce((a, b) => a + b, 0) / confidenceScores.length
            : 0;
        const minConfidence = confidenceScores.length > 0 ? Math.min(...confidenceScores) : 0;
        const maxConfidence = confidenceScores.length > 0 ? Math.max(...confidenceScores) : 0;

        // Record decision metrics for signal generation
        if (signals.length > 0) {
          const decisionMetrics = {
            confidence: avgConfidence,
            threshold: 0.55, // MIN_CONFIDENCE from SIGNAL_VALIDATION
            reasoning: `Generated ${signals.length} signals from ${allMarketData.length} market data items`,
            factors: {
              actionDistribution: actionCounts,
              confidenceRange: { min: minConfidence, max: maxConfidence, avg: avgConfidence },
              marketDataCount: allMarketData.length,
              promptOptions: context.promptOptions,
            },
          };

          this.unifiedLogger.recordDecisionMetrics(
            cycleOperationId,
            'generate_signals',
            decisionMetrics
          );

          // Build enriched decision path with AI reasoning
          const decision = this.buildSignalDecisionString(signals);
          const reason = this.buildSignalDecisionReason(signals, allMarketData.length);
          const decisionConfidence = this.calculatePrimaryDecisionConfidence(
            signals,
            confidenceScores,
            avgConfidence
          );

          // Record operation-level decision path with enriched information
          this.unifiedLogger.recordDecisionPath(cycleOperationId, {
            choices: [
              {
                step: 'generate_signals',
                decision,
                reason,
                confidence: decisionConfidence,
                threshold: 0.55,
                factors: {
                  signals: signals.map(s => ({
                    coin: s.coin,
                    action: s.action,
                    confidence: s.confidence,
                    reasoning: s.reasoning,
                    entryPrice: s.entry_price,
                    positionSize: s.position_size,
                    stopLoss: s.stop_loss,
                    profitTarget: s.profit_target,
                    invalidationCondition: s.invalidation_condition,
                  })),
                  actionDistribution: actionCounts,
                  confidenceRange: { min: minConfidence, max: maxConfidence, avg: avgConfidence },
                  marketDataCount: allMarketData.length,
                  promptOptions: context.promptOptions,
                },
              },
            ],
          });
        }

        this.unifiedLogger.completeStage(cycleOperationId, 'generate_signals', {
          signalCount: signals.length,
          duration: signalDuration,
          signalQuality: {
            actionDistribution: actionCounts,
            confidenceStats: {
              min: minConfidence,
              max: maxConfidence,
              avg: avgConfidence,
            },
            aiContext: {
              invokeCount: context.invokeCount,
              tradableCoins: context.tradableCoins.length,
              maxPositions: context.maxPositions,
              promptOptions: context.promptOptions,
            },
          },
        });
      } catch (error) {
        signalError = error instanceof Error ? error : new Error(String(error));
        this.unifiedLogger.recordError(signalError, {
          cycleId: this.state.cycleCount,
          operationId: cycleOperationId,
        });
        this.unifiedLogger.completeStage(
          cycleOperationId,
          'generate_signals',
          undefined,
          signalError
        );
        throw error;
      }

      // Emit signals generated event
      this.emitEvent('cycle:signals', {
        cycleCount: this.state.cycleCount,
        timestamp: Date.now(),
        signalCount: signals.length,
        signals: signals.map(s => ({ coin: s.coin, action: s.action, confidence: s.confidence })),
      });

      // 5. Process and display signals
      await this.processSignals(signals, tickerCache);

      // 6. Execute all signals
      const getCachedPrice = createTickerPriceGetter(
        tickerCache,
        this.snapshotService,
        this.unifiedLogger,
        this.loggerContext
      );

      // Track trades before execution to compute per-cycle tradeCount delta
      const tradesBefore = this.state.totalTrades;
      // Use fresh positions array that gets updated after each signal execution
      // Start with updated positions from after monitoring (monitor may have closed positions)
      // This ensures each signal sees the current state (positions opened by previous signals, or closed by monitor)
      let currentPositions = updatedPositions;
      let currentAccount = updatedAccount;

      // Start execute_signals stage BEFORE executing signals
      // This ensures the stage exists when executeSignal tries to record validation checks
      this.unifiedLogger.startStage(cycleOperationId, 'execute_signals', {
        signalCount: signals.length,
        actionableSignals: signals.filter(s => s.action !== 'HOLD').length,
      });
      const executeStartTime = Date.now();

      // Accumulate decision information for all signals
      const signalDecisionInfos: SignalDecisionInfo[] = [];

      for (const signal of signals) {
        if (!this.state.isRunning) {
          break; // Stop processing signals if workflow stopped
        }
        const symbol = `${signal.coin}/USDT`;
        const currentPrice = await getCachedPrice(symbol);

        // Skip signal execution if price is unavailable
        // Using 0 as fallback would cause invalid position sizing and risk calculations
        if (currentPrice === undefined || currentPrice <= 0) {
          this.emitLog(
            'warn',
            `⚠️  ${signal.coin}: Skipping signal execution - price unavailable (${currentPrice === undefined ? 'undefined' : `$${currentPrice.toFixed(2)}`})`
          );
          this.unifiedLogger.warn(
            'Signal execution skipped due to unavailable price',
            {
              coin: signal.coin,
              symbol,
              action: signal.action,
              price: currentPrice,
            },
            this.loggerContext
          );
          // Record decision info for skipped signal
          signalDecisionInfos.push({
            coin: signal.coin,
            action: signal.action,
            validation: { passed: false, reason: 'Price unavailable' },
            sizing: { passed: false },
            execution: { expectedPrice: currentPrice ?? undefined }, // Use undefined instead of 0 for invalid price
          });
          continue; // Skip this signal and continue with next
        }

        // Extract indicators from market data for this coin
        const coinMarketData = allMarketData.find(
          md => md.coin === signal.coin && md.timeframe === '3m'
        );
        const atr14 = coinMarketData?.indicators.atr14;
        const indicators = coinMarketData?.indicators;

        const result = await this.executeSignal(
          cycleOperationId,
          signal,
          currentAccount,
          currentPositions,
          tickerCache,
          currentPrice,
          atr14,
          indicators
        );

        // Collect decision information
        if (result.decisionInfo) {
          signalDecisionInfos.push(result.decisionInfo);
        }

        // Refresh positions and account after successful signal execution
        // This ensures subsequent signals see the updated state
        if (
          result.success &&
          (signal.action === 'LONG' || signal.action === 'SHORT' || signal.action === 'CLOSE')
        ) {
          try {
            const snapshot = await this.snapshotService.getSnapshot();
            currentPositions = snapshot.positions;
            currentAccount = snapshot.account;
          } catch (error) {
            this.unifiedLogger.warn(
              'Failed to refresh positions after signal execution - aborting remaining signals',
              {
                coin: signal.coin,
                action: signal.action,
                error: error instanceof Error ? error.message : String(error),
              },
              this.loggerContext
            );
            // If position refresh fails after executing a signal, abort remaining signals
            // to prevent stale state from causing duplicate positions or risk violations
            break; // Exit signal loop to prevent using stale positions
          }
        }
      }

      // Emit execution phase event
      this.emitEvent('cycle:execution', {
        cycleCount: this.state.cycleCount,
        timestamp: Date.now(),
        executedSignals: signals.filter(s => s.action !== 'HOLD').length,
        totalTrades: this.state.totalTrades,
      });

      // 5.5. Refresh account and positions after executing signals using a single snapshot
      // This is the final state after all signal executions
      const { account: finalAccount, positions: finalPositions } =
        await this.snapshotService.getSnapshot();

      const executeDuration = Date.now() - executeStartTime;

      // Build decision path for execute_signals
      const acceptedSignals = signalDecisionInfos.filter(
        d => d.validation.passed && d.sizing.passed
      );
      const rejectedValidation = signalDecisionInfos.filter(d => !d.validation.passed);
      const rejectedSizing = signalDecisionInfos.filter(
        d => d.validation.passed && !d.sizing.passed
      );
      const executedSignals = signalDecisionInfos.filter(d => d.execution.orderId);

      // Build decision summary
      const decisionParts: string[] = [];
      if (acceptedSignals.length > 0) {
        const byAction: Record<string, string[]> = {};
        for (const sig of acceptedSignals) {
          if (!byAction[sig.action]) byAction[sig.action] = [];
          byAction[sig.action].push(sig.coin);
        }
        const actionSummary = Object.entries(byAction)
          .map(([action, coins]) => `${action}: ${coins.join(', ')}`)
          .join('; ');
        decisionParts.push(`Accepted: ${acceptedSignals.length} (${actionSummary})`);
      }
      if (rejectedValidation.length > 0) {
        const reasons = rejectedValidation
          .map(s => `${s.coin}(${s.validation.reason || 'unknown'})`)
          .join(', ');
        decisionParts.push(`Rejected (validation): ${rejectedValidation.length} (${reasons})`);
      }
      if (rejectedSizing.length > 0) {
        const coins = rejectedSizing.map(s => s.coin).join(', ');
        decisionParts.push(`Rejected (sizing): ${rejectedSizing.length} (${coins})`);
      }
      const decision = decisionParts.length > 0 ? decisionParts.join('; ') : 'No signals processed';

      // Build concise reason for decision path (detailed info in validation checks)
      const reasonParts: string[] = [];
      reasonParts.push(
        `Processed ${signalDecisionInfos.length} signals, executed ${executedSignals.length} orders`
      );
      if (acceptedSignals.length > 0) {
        reasonParts.push(`Accepted: ${acceptedSignals.length}`);
      }
      if (rejectedValidation.length > 0) {
        reasonParts.push(`Rejected (validation): ${rejectedValidation.length}`);
      }
      if (rejectedSizing.length > 0) {
        reasonParts.push(`Rejected (sizing): ${rejectedSizing.length}`);
      }

      const reason = reasonParts.join('\n');

      // Record operation-level decision path (append to existing if any)
      this.unifiedLogger.appendDecisionChoice(cycleOperationId, {
        step: 'execute_signals',
        decision,
        reason,
        factors: {
          signals: signalDecisionInfos,
          summary: {
            total: signalDecisionInfos.length,
            accepted: acceptedSignals.length,
            rejectedValidation: rejectedValidation.length,
            rejectedSizing: rejectedSizing.length,
            executed: executedSignals.length,
          },
          validationSummary: {
            passed: acceptedSignals.length + rejectedSizing.length,
            failed: rejectedValidation.length,
            reasons: rejectedValidation.map(s => ({ coin: s.coin, reason: s.validation.reason })),
          },
          sizingSummary: {
            passed: acceptedSignals.length,
            failed: rejectedSizing.length,
            details: acceptedSignals.map(s => ({
              coin: s.coin,
              leverage: s.sizing.leverage,
              size: s.sizing.suggestedSize,
              riskAmount: s.sizing.riskAmount,
              regime: s.sizing.regime,
              atrAdjustment: s.sizing.atrAdjustment,
            })),
          },
          executionSummary: {
            executed: executedSignals.length,
            details: executedSignals.map(s => ({
              coin: s.coin,
              expectedPrice: s.execution.expectedPrice,
              actualPrice: s.execution.actualPrice,
              slippage: s.execution.slippage,
              slippageAbs: s.execution.slippageAbs,
              orderId: s.execution.orderId,
            })),
          },
        },
      });

      // Complete signal execution stage
      this.unifiedLogger.completeStage(cycleOperationId, 'execute_signals', {
        executedCount: this.state.totalTrades - tradesBefore,
        duration: executeDuration,
      });

      // Aggregate once per cycle for reuse
      const aggregates = aggregatePositionMetrics(finalPositions);

      // 6. Update performance metrics with latest data
      this.updatePerformanceMetrics(finalAccount, aggregates);

      // Record cycle execution time
      const cycleDuration = Date.now() - cycleStartTime;
      this.unifiedLogger.recordCycleTime(this.state.cycleCount, cycleDuration);

      // 7. Log cycle summary with latest data
      const tradeCountCycle = this.state.totalTrades - tradesBefore;
      this.logCycleSummary(finalAccount, finalPositions, signals, aggregates, {
        rejectedSignalsCycle: this.state.rejectedSignalsCycle,
        tradeCountCycle,
      });

      // Create system snapshot for state tracking
      this.unifiedLogger.startStage(cycleOperationId, 'create_snapshot', {});
      const circuitBreakers = this.getCircuitBreakerStates();
      const recentOperations = this.getRecentOperationsSummary();

      this.unifiedLogger.createSnapshot(
        this.state.cycleCount,
        {
          equity: finalAccount.equity,
          balance: finalAccount.balance,
          marginUsed: aggregates.totalMarginUsed, // Use actual margin used from positions
          availableMargin: finalAccount.availableMargin, // Use actual available margin
        },
        finalPositions.map(p => ({
          symbol: p.symbol,
          side: p.side,
          size: p.size,
          entryPrice: p.entryPrice,
          unrealizedPnl: p.unrealizedPnl,
        })),
        circuitBreakers,
        recentOperations
      );
      this.unifiedLogger.completeStage(cycleOperationId, 'create_snapshot', {
        positionsCount: finalPositions.length,
      });

      // Prepare per-cycle action distribution
      const actionCounts = { LONG: 0, SHORT: 0, CLOSE: 0, HOLD: 0 } as {
        LONG: number;
        SHORT: number;
        CLOSE: number;
        HOLD: number;
      };
      for (const s of signals) {
        const a = s.action as 'LONG' | 'SHORT' | 'CLOSE' | 'HOLD';
        if (a in actionCounts) actionCounts[a]++;
      }

      // Notify cycle completion via event bus (include per-cycle deltas)
      this.emitEvent('cycle:complete', {
        cycleCount: this.state.cycleCount,
        timestamp: Date.now(),
        duration: Date.now() - this.state.lastUpdate,
        totalSignals: this.state.totalSignals,
        totalTrades: this.state.totalTrades,
        totalPnl: this.state.totalPnl,
        signalCount: signals.length,
        tradeCount: this.state.totalTrades - tradesBefore,
        cyclePnl: this.state.cyclePnl ?? 0,
        actionCounts,
      });

      // Aggregate validation checks from execute_signals stage before completing operation
      this.unifiedLogger.aggregateValidationResults(cycleOperationId, 'execute_signals');

      // Complete cycle operation
      this.unifiedLogger.completeStage(cycleOperationId, 'cycle_start', {
        cycleCount: this.state.cycleCount,
      });
      this.unifiedLogger.completeOperation(cycleOperationId, 'completed', {
        cycleCount: this.state.cycleCount,
        duration: cycleDuration,
        signalsGenerated: signals.length,
        tradesExecuted: tradeCountCycle,
        totalPnl: this.state.totalPnl,
      });
    } catch (error) {
      const cycleError = error instanceof Error ? error : new Error(String(error));
      this.emitLog('error', `Error in trading cycle: ${error}`);

      // Record error in unified logger
      this.unifiedLogger.recordError(cycleError, {
        cycleId: this.state.cycleCount,
        operationId: cycleOperationId,
      });

      // Emit cycle error event
      this.emitEvent('cycle:error', {
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
      const sizing = this.riskManager.calculatePositionSizing(
        signal,
        account,
        positions,
        currentPrice,
        atr14,
        indicators
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
   * Build decision string from signals grouped by action
   */
  private buildSignalDecisionString(signals: TradingSignal[]): string {
    const signalsByAction: Record<string, Array<{ coin: string; confidence: number }>> = {};

    for (const signal of signals) {
      if (!signalsByAction[signal.action]) {
        signalsByAction[signal.action] = [];
      }
      signalsByAction[signal.action].push({
        coin: signal.coin,
        confidence: signal.confidence,
      });
    }

    const decisionParts: string[] = [];
    for (const [action, signalList] of Object.entries(signalsByAction)) {
      const signalSummary = signalList
        .map(s => `${s.coin}(${(s.confidence * 100).toFixed(0)}%)`)
        .join(', ');
      decisionParts.push(`${action}: ${signalSummary}`);
    }

    return decisionParts.join('; ');
  }

  /**
   * Build decision reason with AI reasoning summary
   */
  private buildSignalDecisionReason(signals: TradingSignal[], marketDataCount: number): string {
    const reasonParts: string[] = [
      `Generated ${signals.length} signals from ${marketDataCount} market data items`,
    ];

    const reasoningSummary = this.extractAIReasoningSummary(signals);
    if (reasoningSummary) {
      reasonParts.push(`Key reasoning: ${reasoningSummary}`);
    }

    return reasonParts.join('\n');
  }

  /**
   * Extract AI reasoning summary from primary signals (non-HOLD signals have priority)
   */
  private extractAIReasoningSummary(
    signals: TradingSignal[],
    maxLength: number = 150
  ): string | null {
    const primarySignals = signals.filter(s => s.action !== 'HOLD');
    const reasoningSource = primarySignals.length > 0 ? primarySignals : signals;

    // Select the highest confidence signal's reasoning
    const bestSignal = reasoningSource.sort((a, b) => b.confidence - a.confidence)[0];

    if (!bestSignal?.reasoning) {
      return null;
    }

    // Extract key reasoning (first maxLength characters or until sentence end)
    let reasoningSummary = bestSignal.reasoning.trim();
    if (reasoningSummary.length > maxLength) {
      // Try to cut at sentence boundary
      const sentenceEnd = reasoningSummary.substring(0, maxLength).lastIndexOf('.');
      if (sentenceEnd > maxLength * 0.67) {
        // Only cut at sentence if it's reasonably far into the text (2/3 of maxLength)
        reasoningSummary = reasoningSummary.substring(0, sentenceEnd + 1);
      } else {
        reasoningSummary = reasoningSummary.substring(0, maxLength) + '...';
      }
    }

    return reasoningSummary;
  }

  /**
   * Calculate confidence for primary decisions (non-HOLD signals)
   * Uses primary signals' confidence if available, otherwise uses average
   */
  private calculatePrimaryDecisionConfidence(
    signals: TradingSignal[],
    _allConfidenceScores: number[],
    overallAvgConfidence: number
  ): number {
    const primarySignals = signals.filter(s => s.action !== 'HOLD');

    if (primarySignals.length === 0) {
      // If only HOLD signals, use overall average
      return overallAvgConfidence;
    }

    // Calculate average confidence of primary signals
    const primaryConfidences = primarySignals.map(s => s.confidence);
    return primaryConfidences.reduce((a, b) => a + b, 0) / primaryConfidences.length;
  }

  private updatePerformanceMetrics(account: Account, aggregates: PositionAggregates): void {
    // Update unrealized P&L from open positions using pre-computed aggregates
    this.state.unrealizedPnl = aggregates.totalPnl;

    // Calculate total P&L: (Current Equity - Initial Balance)
    // This includes both realized P&L from closed trades and unrealized P&L from open positions
    // Guard: ensure initialBalance is set before calculating P&L
    if (this.state.initialBalance > 0) {
      this.state.totalPnl = account.equity - this.state.initialBalance;
    } else {
      // If initialBalance is not set, use 0 as default (prevents incorrect calculations)
      this.state.totalPnl = 0;
      this.unifiedLogger.warn(
        'Cannot calculate total P&L: initial balance not set',
        {
          cycleCount: this.state.cycleCount,
          equity: account.equity,
        },
        this.loggerContext
      );
    }

    // Calculate win rate from completed trades
    this.state.winRate = this.calculateWinRate();

    // Update performance tracker with completed trades for adaptive parameters
    if (this.exchange.getCompletedTrades) {
      const completedTrades = this.exchange.getCompletedTrades();
      if (completedTrades.length > 0) {
        this.riskManager.updatePerformanceStats(completedTrades);
      }
    }
  }

  /**
   * Calculate win rate from completed trades
   * Win rate should only be based on closed positions, not open positions
   */
  private calculateWinRate(): number {
    // Skip if exchange doesn't support completed trades tracking
    if (!this.exchange.getCompletedTrades) {
      return this.state.winRate;
    }

    const completedTrades = this.exchange.getCompletedTrades();

    // No completed trades yet
    if (completedTrades.length === 0) {
      return this.state.totalTrades === 0 ? 0 : this.state.winRate;
    }

    // Calculate win rate from completed trades
    const winningTrades = completedTrades.filter(trade => trade.pnl > 0).length;
    return (winningTrades / completedTrades.length) * 100;
  }

  /**
   * Calculate and update P&L metrics for the cycle
   */
  private calculatePnLMetrics(
    account: Account,
    aggregates: PositionAggregates
  ): {
    totalPnl: number;
    totalPnlPercent: number;
    totalPnlColor: (str: string) => string;
    unrealizedPnl: number;
    unrealizedPnlPercent: number;
    unrealizedPnlColor: (str: string) => string;
    cyclePnlChange: number;
    cyclePnlPercent: number;
    cyclePnlColor: (str: string) => string;
    realizedCyclePnl: number;
  } {
    const unrealizedPnl = aggregates.totalPnl;
    const totalPnl = this.state.totalPnl;
    const totalPnlPercent =
      this.state.initialBalance > 0 ? (totalPnl / this.state.initialBalance) * 100 : 0;
    const totalPnlColor = totalPnl >= 0 ? chalk.green : chalk.red;

    const unrealizedPnlPercent = account.equity > 0 ? (unrealizedPnl / account.equity) * 100 : 0;
    const unrealizedPnlColor = unrealizedPnl >= 0 ? chalk.green : chalk.red;

    const cyclePnlChange = this.state.previousEquity
      ? account.equity - this.state.previousEquity
      : 0;
    const cyclePnlPercent = this.state.previousEquity
      ? (cyclePnlChange / this.state.previousEquity) * 100
      : 0;
    const cyclePnlColor = cyclePnlChange >= 0 ? chalk.green : chalk.red;

    this.state.previousEquity = account.equity;
    this.state.cyclePnl = cyclePnlChange;

    const realizedCyclePnl = this.state.previousBalance
      ? account.balance - this.state.previousBalance
      : 0;
    this.state.previousBalance = account.balance;

    return {
      totalPnl,
      totalPnlPercent,
      totalPnlColor,
      unrealizedPnl,
      unrealizedPnlPercent,
      unrealizedPnlColor,
      cyclePnlChange,
      cyclePnlPercent,
      cyclePnlColor,
      realizedCyclePnl,
    };
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

  /**
   * Calculate runtime metrics from start time
   */
  private calculateRuntimeMetrics(): {
    minutes: number;
    seconds: number;
    string: string;
  } {
    const runtime = Date.now() - this.state.startTime;
    const minutes = Math.floor(runtime / (1000 * 60));
    const seconds = Math.floor((runtime / 1000) % 60);
    return {
      minutes,
      seconds,
      string: `${minutes}m ${seconds}s`,
    };
  }

  /**
   * Calculate cycle summary metrics (efficiency, margin usage, risk level, etc.)
   */
  private calculateCycleMetrics(
    account: Account,
    positions: Position[],
    signals: TradingSignal[],
    aggregates: PositionAggregates,
    cycleMetrics: { rejectedSignalsCycle: number; tradeCountCycle: number }
  ): {
    signalsCount: number;
    executedTrades: number;
    rejectedSignals: number;
    openPositions: number;
    maxPositions: number;
    efficiency: number;
    marginUsage: number;
    riskLevel: 'LOW' | 'MEDIUM' | 'HIGH';
    averageLeverage: number;
  } {
    const signalsCount = signals.length;
    const executedTrades = cycleMetrics.tradeCountCycle;
    const rejectedSignals = cycleMetrics.rejectedSignalsCycle;
    const openPositions = positions.length;
    const maxPositions = this.config.maxPositions;

    const efficiency = signalsCount > 0 ? (executedTrades / signalsCount) * 100 : 0;
    const totalMarginUsed = aggregates.totalMarginUsed;
    const marginUsage = account.equity > 0 ? (totalMarginUsed / account.equity) * 100 : 0;

    let riskLevel: 'LOW' | 'MEDIUM' | 'HIGH' = 'LOW';
    if (marginUsage >= 80) {
      riskLevel = 'HIGH';
    } else if (marginUsage >= 50) {
      riskLevel = 'MEDIUM';
    }

    const averageLeverage =
      positions.length > 0
        ? positions.reduce((sum, p) => sum + (p.leverage || 1), 0) / positions.length
        : 0;

    return {
      signalsCount,
      executedTrades,
      rejectedSignals,
      openPositions,
      maxPositions,
      efficiency,
      marginUsage,
      riskLevel,
      averageLeverage,
    };
  }

  /**
   * Calculate countdown to next cycle
   */
  private calculateNextCycleCountdown(): string {
    const nextCycleTime = Date.now() + this.config.cyclePeriod;
    const remainingMs = nextCycleTime - Date.now();
    const remainingMinutes = Math.floor(remainingMs / (1000 * 60));
    const remainingSeconds = Math.floor((remainingMs % (1000 * 60)) / 1000);
    return remainingMinutes > 0
      ? `${remainingMinutes}m ${remainingSeconds}s`
      : `${remainingSeconds}s`;
  }

  private logCycleSummary(
    account: Account,
    positions: Position[],
    signals: TradingSignal[],
    aggregates: PositionAggregates,
    cycleMetrics: { rejectedSignalsCycle: number; tradeCountCycle: number }
  ): void {
    const runtime = this.calculateRuntimeMetrics();
    const pnlMetrics = this.calculatePnLMetrics(account, aggregates);
    const cycleMetricsData = this.calculateCycleMetrics(
      account,
      positions,
      signals,
      aggregates,
      cycleMetrics
    );

    // Validate account consistency
    this.validateAccountConsistency(account, positions, aggregates.totalMarginUsed);

    // Format cycle summary for structured logs
    const formattedSummary = this.formatCycleSummary(
      runtime.string,
      cycleMetricsData,
      account,
      positions,
      aggregates,
      pnlMetrics
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
  }

  /**
   * Format cycle summary for display
   */
  private formatCycleSummary(
    runtimeString: string,
    cycleMetrics: {
      signalsCount: number;
      executedTrades: number;
      rejectedSignals: number;
      openPositions: number;
      maxPositions: number;
      efficiency: number;
      marginUsage: number;
      riskLevel: 'LOW' | 'MEDIUM' | 'HIGH';
      averageLeverage: number;
    },
    account: Account,
    positions: Position[],
    aggregates: PositionAggregates,
    pnlMetrics: ReturnType<TradingWorkflow['calculatePnLMetrics']>
  ): string | undefined {
    try {
      return this.cycleDisplay.formatCycleSummary({
        runtime: runtimeString,
        cycleCount: this.state.cycleCount,
        signalsCount: cycleMetrics.signalsCount,
        executedTrades: cycleMetrics.executedTrades,
        rejectedSignals: cycleMetrics.rejectedSignals,
        openPositions: cycleMetrics.openPositions,
        maxPositions: cycleMetrics.maxPositions,
        efficiency: cycleMetrics.efficiency,
        account,
        positions,
        totalMarginUsed: aggregates.totalMarginUsed,
        totalUnleveredExposure: aggregates.totalUnleveredExposure,
        totalPnl: pnlMetrics.totalPnl,
        totalPnlPercent: pnlMetrics.totalPnlPercent,
        unrealizedPnl: pnlMetrics.unrealizedPnl,
        unrealizedPnlPercent: pnlMetrics.unrealizedPnlPercent,
        cyclePnl: pnlMetrics.cyclePnlChange,
        cyclePnlPercent: pnlMetrics.cyclePnlPercent,
        realizedCyclePnl: pnlMetrics.realizedCyclePnl,
        marginUsage: cycleMetrics.marginUsage,
        riskLevel: cycleMetrics.riskLevel,
        averageLeverage: cycleMetrics.averageLeverage,
        winRate: this.state.winRate,
        countdown: this.calculateNextCycleCountdown(),
        previousEquity: this.state.previousEquity,
      });
    } catch (error) {
      this.unifiedLogger.error(
        'Failed to format cycle summary',
        error as Error,
        this.loggerContext
      );
      return undefined;
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

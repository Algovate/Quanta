import { EventEmitter } from 'events';
import { TradingWorkflow } from '../core/workflow.js';
import type { BarTimeframe } from '../core/scheduler.js';
import { isTimeframe, timeframeToMs, type Timeframe } from '../utils/timeframe.js';
import { StreamingIngestion, type StreamingConfig } from '../data/index.js';
import type { Exchange } from '../exchange/types.js';
import type { MarketDataProvider } from '../data/market.js';
import type { OpenRouterClient } from '../ai/agent.js';
import type { UnifiedLogger } from '../logging/index.js';
import type { OrderEvent, RiskSnapshot, SignalEvent, TradeEvent } from './types.js';
import { EventBus } from '../core/event-bus.js';
import { createLogger } from './utils/logger.js';
import { RiskSnapshotAggregator } from './risk-snapshot-aggregator.js';
import { ExecutionSessionManager } from './execution-session-manager.js';

export interface TradingState {
  isRunning: boolean;
  cycleCount: number;
  startTime: number;
  lastUpdate: number;
  totalSignals: number;
  totalTrades: number;
  totalPnl: number;
  winRate: number;
  actionTotals?: {
    LONG: number;
    SHORT: number;
    CLOSE: number;
    HOLD: number;
  };
}

export class TradingManager extends EventEmitter {
  private static instance: TradingManager;
  private workflow: TradingWorkflow | null = null;
  private state: TradingState;
  private logger: UnifiedLogger;
  private readonly context: string;
  private riskAggregator: RiskSnapshotAggregator;
  private signals: SignalEvent[] = [];
  private orders: OrderEvent[] = [];
  private trades: TradeEvent[] = [];
  private equityHistory: Array<{ timestamp: number; equity: number }> = [];
  private latestRisk: RiskSnapshot | null = null;
  private updateIntervalId?: NodeJS.Timeout;
  private streaming?: StreamingIngestion;
  // Caches attached by APIServer
  _priceCache?: Map<string, { price: number; ts: number }>;
  _klineCache?: Map<string, { candle: any; ts: number }>;
  // Health check dependencies
  private exchange?: Exchange;
  private marketDataProvider?: MarketDataProvider;
  private aiAgent?: OpenRouterClient;
  // Custom exit plans storage (position key -> exit plan)
  private customExitPlans: Map<string, { stopLoss?: number; takeProfit?: number }> = new Map();

  private constructor() {
    super();
    const { logger, context } = createLogger('TradingManager');
    this.logger = logger;
    this.context = context;
    this.riskAggregator = new RiskSnapshotAggregator(logger, context);
    this.state = {
      isRunning: false,
      cycleCount: 0,
      startTime: Date.now(),
      lastUpdate: Date.now(),
      totalSignals: 0,
      totalTrades: 0,
      totalPnl: 0,
      winRate: 0,
      actionTotals: { LONG: 0, SHORT: 0, CLOSE: 0, HOLD: 0 },
    };
  }

  static getInstance(): TradingManager {
    if (!TradingManager.instance) {
      TradingManager.instance = new TradingManager();
      TradingManager.instance.subscribeToBus();
    }
    return TradingManager.instance;
  }

  private subscribeToBus(): void {
    EventBus.on('cycle:start', payload => this.emit('cycle:start', payload));
    EventBus.on('cycle:signals', payload => this.emit('cycle:signals', payload));
    EventBus.on('cycle:execution', payload => this.emit('cycle:execution', payload));
    EventBus.on('cycle:complete', payload => {
      // update cumulative state from payload
      this.state.cycleCount = payload.cycleCount;
      this.state.lastUpdate = payload.timestamp;
      this.state.totalSignals = payload.totalSignals;
      this.state.totalTrades = payload.totalTrades;
      this.state.totalPnl = payload.totalPnl;

      // accumulate totals by action
      if (!this.state.actionTotals) {
        this.state.actionTotals = { LONG: 0, SHORT: 0, CLOSE: 0, HOLD: 0 };
      }
      const at = this.state.actionTotals;
      at.LONG += payload.actionCounts?.LONG ?? 0;
      at.SHORT += payload.actionCounts?.SHORT ?? 0;
      at.CLOSE += payload.actionCounts?.CLOSE ?? 0;
      at.HOLD += payload.actionCounts?.HOLD ?? 0;

      // emit updates
      this.emit('cycle:complete', payload);
      this.emit('system:state', { ...this.state });
    });
    EventBus.on('cycle:error', payload => this.emit('cycle:error', payload));
    EventBus.on('signal:buffer', payload =>
      this.pushSignal({
        id: payload.id,
        timestamp: payload.timestamp,
        symbol: payload.symbol,
        action: payload.action as SignalEvent['action'],
        confidence: payload.confidence,
        reasoning: payload.reasoning,
        price: payload.price,
        strategy: payload.strategy,
        status: (payload.status as SignalEvent['status']) || 'generated',
      } as SignalEvent)
    );
  }

  async start(
    exchange: Exchange,
    marketDataProvider: MarketDataProvider,
    aiAgent: OpenRouterClient,
    config: {
      coins: string[];
      cyclePeriod: number;
      maxPositions: number;
      riskParams: {
        maxRiskPerTrade: number;
        maxTotalRisk: number;
        defaultStopLoss: number;
        maxLeverage: number;
        minLeverage: number;
        maxPositions: number;
      };
    }
  ): Promise<void> {
    if (this.workflow) {
      throw new Error('Trading workflow is already running');
    }

    this.logger.info('Starting trading workflow...');

    const sessionManager = ExecutionSessionManager.getInstance();
    let sessionAcquired = false;

    try {
      // Acquire exclusive execution session (mode: 'strategy')
      const session = sessionManager.createWorkflowSession();
      sessionManager.acquire(session);
      sessionAcquired = true;

      this.logger.info(
        'Trading workflow execution session started',
        {
          executionSession: {
            mode: session.mode,
            env: session.env,
            id: session.id,
            startTime: session.startTime,
          },
        },
        this.context
      );

      // Store references for health checks
      this.exchange = exchange;
      this.marketDataProvider = marketDataProvider;
      this.aiAgent = aiAgent;

      // Create workflow - both CLI and API server modes use structured logs only
      this.workflow = new TradingWorkflow(exchange, marketDataProvider, aiAgent, config);

      // Set up custom exit plans getter
      this.workflow.setCustomExitPlansGetter((symbol, side) =>
        this.getCustomExitPlan(symbol, side)
      );

      // Wrap the workflow methods to emit events
      this.setupEventEmitters();

      // Optionally enable bar-driven scheduling if marketTimeframes are provided
      try {
        const tfs = (config as any).marketTimeframes as string[] | undefined;
        if (Array.isArray(tfs) && tfs.length > 0) {
          const symbols = (config.coins || []).map(c => `${c}/USDT`);
          const timeframes = tfs.filter(isTimeframe) as Timeframe[];
          this.workflow.enableBarDrivenScheduling({
            symbols,
            timeframes: timeframes as BarTimeframe[],
            pollIntervalMs: 5_000,
          });

          // Start streaming ingestion for gap detection and future WS migration (non-intrusive)
          const sCfg: StreamingConfig = { symbols, timeframes };
          this.streaming = new StreamingIngestion(exchange, sCfg);
          this.streaming.on('gap:detected', async gap => {
            this.logger.warn(
              'Market data gap detected',
              { gap } as Record<string, unknown>,
              this.context
            );
            // Attempt a lightweight targeted backfill to warm caches (best-effort)
            try {
              const tf = gap.timeframe as Timeframe;
              const tfMs = timeframeToMs(tf);
              const estBars = Math.min(
                500,
                Math.max(1, Math.floor((gap.missingTo - gap.missingFrom) / tfMs))
              );
              await exchange.getCandlesticks(gap.symbol, tf, estBars);
            } catch (e) {
              this.logger.warn(
                'Backfill attempt failed',
                { error: (e as Error)?.message },
                this.context
              );
            }
          });
          this.streaming.on('stream:error', e =>
            this.logger.warn(
              'Streaming error',
              e instanceof Error ? { error: e.message } : { error: String(e) },
              this.context
            )
          );
          this.streaming.start(5_000);
        }
      } catch (e) {
        this.logger.warn(
          'Failed to enable bar-driven scheduling; falling back to timer',
          e instanceof Error ? { error: e.message } : { error: String(e) },
          this.context
        );
      }

      this.workflow.start().catch(error => {
        this.logger.error(
          'Trading workflow error',
          error instanceof Error ? error : new Error(String(error)),
          this.context
        );
        this.emit('error', error);
        // Release session on workflow error
        if (sessionAcquired) {
          try {
            sessionManager.release('workflow');
          } catch (releaseError) {
            this.logger.warn(
              'Failed to release session on workflow error',
              releaseError instanceof Error ? releaseError : new Error(String(releaseError)),
              this.context
            );
          }
          sessionAcquired = false;
        }
      });

      this.state.isRunning = true;
      this.state.startTime = Date.now();
      this.emit('system:state', { ...this.state });
    } catch (error) {
      // Release session if we failed after acquiring
      if (sessionAcquired) {
        try {
          sessionManager.release('workflow');
        } catch (releaseError) {
          this.logger.warn(
            'Failed to release session on start error',
            releaseError instanceof Error ? releaseError : new Error(String(releaseError)),
            this.context
          );
        }
      }

      this.logger.error(
        'Failed to start trading workflow',
        error instanceof Error ? error : new Error(String(error)),
        this.context
      );
      throw error;
    }
  }

  // timeframeToMs from utils/timeframe is used

  async stop(): Promise<void> {
    if (!this.workflow) {
      throw new Error('No trading workflow is running');
    }

    this.logger.info('Stopping trading workflow...', {}, this.context);
    await this.workflow.stop();
    this.workflow = null;

    // Stop streaming ingestion if active
    try {
      if (this.streaming) this.streaming.stop();
      this.streaming = undefined;
    } catch (error) {
      // Log but don't fail on streaming stop errors
      this.logger.warn(
        'Error stopping streaming ingestion',
        error instanceof Error ? error : new Error(String(error)),
        this.context
      );
    }

    this.state.isRunning = false;
    this.emit('system:state', { ...this.state });

    // Release exclusive session
    const sessionManager = ExecutionSessionManager.getInstance();
    const activeSession = sessionManager.getActive();
    sessionManager.release('workflow');

    this.logger.info(
      'Trading workflow execution session stopped',
      {
        executionSession: activeSession
          ? {
              mode: activeSession.mode,
              env: activeSession.env,
              id: activeSession.id,
              duration: Date.now() - activeSession.startTime,
            }
          : undefined,
      },
      this.context
    );
  }

  async pause(): Promise<void> {
    this.logger.info('Pausing trading workflow...', {}, this.context);
    // Note: Workflow doesn't have pause yet, this is a placeholder
    this.emit('system:state', { ...this.state, paused: true });
  }

  private setupEventEmitters(): void {
    // Emit periodic updates while running
    this.updateIntervalId = setInterval(async () => {
      if (this.workflow && this.state.isRunning) {
        try {
          const exchange = this.workflow.getExchange();
          const account = await exchange.getAccount();
          const positions = await exchange.getPositions();

          // Enrich positions with custom exit plans or default (config-activated) plan
          const enrichedPositions = positions.map(p => {
            const customPlan = this.getCustomExitPlan(p.symbol, p.side);
            let customStopLoss = customPlan.stopLoss;
            let customTakeProfit = customPlan.takeProfit;

            // If no custom/trailing values, fall back to default from workflow config (if activated)
            if (!customStopLoss && !p.trailingStopPrice) {
              try {
                const cfg = this.workflow?.getConfig();
                const slPct = cfg?.riskParams?.defaultStopLoss;
                if (typeof slPct === 'number' && slPct > 0) {
                  const isLong = p.side === 'long';
                  const entry = p.entryPrice;
                  const defaultSL = isLong ? entry * (1 - slPct) : entry * (1 + slPct);
                  customStopLoss = defaultSL;
                  // Default TP: 2x SL distance
                  const tpPct = slPct * 2;
                  const defaultTP = isLong ? entry * (1 + tpPct) : entry * (1 - tpPct);
                  customTakeProfit = customTakeProfit ?? defaultTP;
                }
              } catch {
                // best-effort enrichment only
              }
            }

            return {
              ...p,
              customStopLoss,
              customTakeProfit,
            };
          });

          this.emit('account:update', account);
          this.emit('position:update', enrichedPositions);

          // Store equity snapshot
          if (account && account.equity !== undefined && account.timestamp) {
            this.pushEquitySnapshot({
              timestamp: account.timestamp,
              equity: account.equity,
            });
          }

          // Emit risk snapshot using aggregator
          const risk = await this.riskAggregator.generateRiskSnapshot(
            account,
            enrichedPositions,
            exchange
          );
          if (risk) {
            this.latestRisk = risk;
            this.emit('risk:update', risk);
          }
        } catch (error) {
          this.logger.error(
            'Error emitting updates',
            error instanceof Error ? error : new Error(String(error)),
            this.context
          );
        }
      }
    }, 5000); // Emit updates every 5 seconds
  }

  getState(): TradingState {
    return { ...this.state };
  }

  getExchange(): Exchange | undefined {
    return this.exchange;
  }

  getMarketDataProvider(): MarketDataProvider | undefined {
    return this.marketDataProvider;
  }

  getAIAgent(): OpenRouterClient | undefined {
    return this.aiAgent;
  }

  getWorkflow(): TradingWorkflow | null {
    return this.workflow;
  }

  // Signals buffer management
  pushSignal(signal: SignalEvent): void {
    // Check if signal already exists and update it instead of creating duplicate
    const existingIndex = this.signals.findIndex(s => s.id === signal.id);

    if (existingIndex >= 0) {
      // Update existing signal
      this.signals[existingIndex] = { ...this.signals[existingIndex], ...signal };
    } else {
      // Add new signal
      this.signals.unshift(signal);
      this.signals = this.signals.slice(0, 50);
    }

    this.emit('signal:generated', signal);
  }

  getSignals(limit: number = 50): SignalEvent[] {
    return this.signals.slice(0, limit);
  }

  // Orders buffer management
  pushOrder(orderEvent: OrderEvent): void {
    // Check if order already exists and update it instead of creating duplicate
    const existingIndex = this.orders.findIndex(o => o.id === orderEvent.id);

    if (existingIndex >= 0) {
      // Update existing order
      this.orders[existingIndex] = { ...this.orders[existingIndex], ...orderEvent };
    } else {
      // Add new order
      this.orders.unshift(orderEvent);
      this.orders = this.orders.slice(0, 50);
    }

    // Update matching signal status based on order status
    const signalIdx = this.signals.findIndex(s => s.symbol === orderEvent.symbol);
    if (signalIdx >= 0) {
      const signal = { ...this.signals[signalIdx] };
      if (
        orderEvent.status === 'filled' ||
        orderEvent.status === 'executed' ||
        orderEvent.status === 'open'
      ) {
        signal.status = 'executed';
      } else if (
        orderEvent.status === 'rejected' ||
        orderEvent.status === 'cancelled' ||
        orderEvent.status === 'failed'
      ) {
        signal.status = 'rejected';
      }
      this.signals[signalIdx] = signal;
    }

    this.emit('order:update', orderEvent);
  }

  getOrders(limit: number = 50): OrderEvent[] {
    return this.orders.slice(0, limit);
  }

  // Trades buffer management
  pushTrade(tradeEvent: TradeEvent): void {
    // Trades are immutable - just append
    this.trades.unshift(tradeEvent);
    this.trades = this.trades.slice(0, 50);

    this.emit('trade:executed', tradeEvent);
  }

  getTrades(limit: number = 50): TradeEvent[] {
    return this.trades.slice(0, limit);
  }

  // Equity history buffer management
  pushEquitySnapshot(snapshot: { timestamp: number; equity: number }): void {
    // Add new snapshot
    this.equityHistory.unshift(snapshot);
    // Keep last 500 snapshots (same as frontend store limit)
    this.equityHistory = this.equityHistory.slice(0, 500);
  }

  getEquityHistory(limit: number = 500): Array<{ timestamp: number; equity: number }> {
    // Return in chronological order (oldest first) to match frontend expectations
    // Backend stores with unshift (newest first), so we reverse to get oldest-first,
    // then take the most recent N items, which will be at the end after reverse
    const reversed = [...this.equityHistory].reverse(); // [oldest, ..., newest]
    return reversed.slice(-limit); // Take last N items (most recent, in chronological order)
  }

  // Risk snapshot
  getRisk(): RiskSnapshot | null {
    return this.latestRisk;
  }

  // Custom exit plans management
  setCustomExitPlan(
    symbol: string,
    side: 'long' | 'short',
    stopLoss?: number,
    takeProfit?: number
  ): void {
    const key = `${symbol}:${side}`;
    if (stopLoss === undefined && takeProfit === undefined) {
      this.customExitPlans.delete(key);
      this.logger.info(`Cleared custom exit plan for ${key}`, {}, this.context);
    } else {
      this.customExitPlans.set(key, { stopLoss, takeProfit });
      this.logger.info(
        `Set custom exit plan for ${key}: SL=${stopLoss}, TP=${takeProfit}`,
        {},
        this.context
      );
    }
  }

  getCustomExitPlan(
    symbol: string,
    side: 'long' | 'short'
  ): {
    stopLoss?: number;
    takeProfit?: number;
  } {
    const key = `${symbol}:${side}`;
    return this.customExitPlans.get(key) || {};
  }

  stopIntervals(): void {
    if (this.updateIntervalId) {
      clearInterval(this.updateIntervalId);
      this.updateIntervalId = undefined;
    }
  }
}

import { EventEmitter } from 'events';
import { TradingWorkflow } from '../core/workflow.js';
import type { BarTimeframe } from '../core/scheduler.js';
import { isTimeframe, timeframeToMs, type Timeframe } from '../utils/timeframe.js';
import { StreamingIngestion, type StreamingConfig } from '../data/index.js';
import type { Exchange } from '../exchange/types.js';
import type { MarketDataProvider } from '../data/market.js';
import type { OpenRouterClient } from '../ai/agent.js';
import { Logger } from '../utils/logger.js';
import type { OrderEvent, RiskSnapshot, SignalEvent } from './types.js';
import { EventBus } from '../core/event-bus.js';

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
  private logger: Logger;
  private signals: SignalEvent[] = [];
  private orders: OrderEvent[] = [];
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
    this.logger = Logger.getInstance('TradingManager');
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

    // Store references for health checks
    this.exchange = exchange;
    this.marketDataProvider = marketDataProvider;
    this.aiAgent = aiAgent;

    this.workflow = new TradingWorkflow(exchange, marketDataProvider, aiAgent, config);

    // Set up custom exit plans getter
    this.workflow.setCustomExitPlansGetter((symbol, side) => this.getCustomExitPlan(symbol, side));

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
          this.logger.warn('Market data gap detected', { gap } as Record<string, unknown>);
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
            this.logger.warn('Backfill attempt failed', { error: (e as Error)?.message });
          }
        });
        this.streaming.on('stream:error', e => this.logger.warn('Streaming error', e));
        this.streaming.start(5_000);
      }
    } catch (e) {
      this.logger.warn('Failed to enable bar-driven scheduling; falling back to timer', e);
    }

    this.workflow.start().catch(error => {
      this.logger.error('Trading workflow error', error);
      this.emit('error', error);
    });

    this.state.isRunning = true;
    this.state.startTime = Date.now();
    this.emit('system:state', { ...this.state });
  }

  // timeframeToMs from utils/timeframe is used

  async stop(): Promise<void> {
    if (!this.workflow) {
      throw new Error('No trading workflow is running');
    }

    this.logger.info('Stopping trading workflow...');
    await this.workflow.stop();
    this.workflow = null;

    // Stop streaming ingestion if active
    try {
      if (this.streaming) this.streaming.stop();
      this.streaming = undefined;
    } catch {
      // ignore
    }

    this.state.isRunning = false;
    this.emit('system:state', { ...this.state });
  }

  async pause(): Promise<void> {
    this.logger.info('Pausing trading workflow...');
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

          // Enrich positions with custom exit plans
          const enrichedPositions = positions.map(p => {
            const customPlan = this.getCustomExitPlan(p.symbol, p.side);
            return {
              ...p,
              customStopLoss: customPlan.stopLoss,
              customTakeProfit: customPlan.takeProfit,
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

          // Emit risk snapshot if portfolio metrics are available
          type ExchangeWithPM = Exchange & {
            getPortfolioMetrics: () => Promise<{
              leverage: number;
              totalExposure: number;
              exposureBySymbol: Record<string, number>;
              totalUnrealizedPnl: number;
            }>;
          };
          const maybePM = exchange as unknown as Partial<ExchangeWithPM>;
          if (typeof maybePM.getPortfolioMetrics === 'function') {
            try {
              const pm = await maybePM.getPortfolioMetrics();
              // Derive additional portfolio quality metrics from current positions
              const avgLev = enrichedPositions.length
                ? enrichedPositions.reduce((sum, p) => sum + (p.leverage || 0), 0) /
                  enrichedPositions.length
                : 0;
              // Simple correlation/diversification proxies aligned with PositionMonitorService
              const sides = enrichedPositions.map(p => p.side);
              const allSameSide = sides.length > 0 && sides.every(side => side === sides[0]);
              let correlationScore = allSameSide ? 0.8 : 0.3;
              correlationScore = Math.min(
                1,
                correlationScore * (enrichedPositions.length > 0 ? 3 / enrichedPositions.length : 1)
              );
              const uniqueSymbols = new Set(enrichedPositions.map(p => p.symbol)).size;
              const diversificationBase =
                enrichedPositions.length > 1 ? uniqueSymbols / enrichedPositions.length : 1;
              const diversificationScore = allSameSide
                ? diversificationBase * 0.7
                : diversificationBase;

              const risk: RiskSnapshot = {
                timestamp: Date.now(),
                marginRatio: account.marginRatio,
                usedMargin: account.usedMargin,
                availableMargin: account.availableMargin,
                leverage: pm.leverage,
                totalExposure: pm.totalExposure,
                exposureBySymbol: pm.exposureBySymbol,
                averageLeverage: Number.isFinite(avgLev) ? avgLev : 0,
                correlationScore: Math.max(0, Math.min(1, correlationScore)),
                diversificationScore: Math.max(0, Math.min(1, diversificationScore)),
                flags: [],
              };
              if (risk.marginRatio > 0.5) risk.flags.push('High margin usage');
              if (pm.totalUnrealizedPnl < -account.equity * 0.05) risk.flags.push('Drawdown > 5%');
              this.latestRisk = risk;
              this.emit('risk:update', risk);
            } catch (error) {
              this.logger.warn('Risk snapshot failed', error);
            }
          } else {
            // Fallback risk snapshot when exchange lacks getPortfolioMetrics
            try {
              // Compute exposure by symbol (unlevered)
              const exposureBySymbol: Record<string, number> = {};
              let totalExposure = 0;
              for (const p of enrichedPositions) {
                // Validate markPrice before calculating exposure
                // Only include positions with valid prices in exposure calculation
                const validPrice = p.markPrice > 0 && isFinite(p.markPrice) ? p.markPrice : 0;
                const value = Math.abs((p.size || 0) * validPrice);
                exposureBySymbol[p.symbol] = (exposureBySymbol[p.symbol] || 0) + value;
                totalExposure += value;
              }
              const leverage = account.equity > 0 ? totalExposure / account.equity : 0;

              // Derive additional portfolio quality metrics from current positions
              const avgLev = enrichedPositions.length
                ? enrichedPositions.reduce((sum, p) => sum + (p.leverage || 0), 0) /
                  enrichedPositions.length
                : 0;
              const sides = enrichedPositions.map(p => p.side);
              const allSameSide = sides.length > 0 && sides.every(side => side === sides[0]);
              let correlationScore = allSameSide ? 0.8 : 0.3;
              correlationScore = Math.min(
                1,
                correlationScore * (enrichedPositions.length > 0 ? 3 / enrichedPositions.length : 1)
              );
              const uniqueSymbols = new Set(enrichedPositions.map(p => p.symbol)).size;
              const diversificationBase =
                enrichedPositions.length > 1 ? uniqueSymbols / enrichedPositions.length : 1;
              const diversificationScore = allSameSide
                ? diversificationBase * 0.7
                : diversificationBase;

              const risk: RiskSnapshot = {
                timestamp: Date.now(),
                marginRatio: account.marginRatio,
                usedMargin: account.usedMargin,
                availableMargin: account.availableMargin,
                leverage,
                totalExposure,
                exposureBySymbol,
                averageLeverage: Number.isFinite(avgLev) ? avgLev : 0,
                correlationScore: Math.max(0, Math.min(1, correlationScore)),
                diversificationScore: Math.max(0, Math.min(1, diversificationScore)),
                flags: [],
              };
              if (risk.marginRatio > 0.5) risk.flags.push('High margin usage');
              // Approximate unrealized PnL sum for drawdown flag when pm unavailable
              const totalUnrealizedPnl = enrichedPositions.reduce(
                (s, p) => s + (p.unrealizedPnl || 0),
                0
              );
              if (account.equity > 0 && totalUnrealizedPnl < -account.equity * 0.05) {
                risk.flags.push('Drawdown > 5%');
              }
              this.latestRisk = risk;
              this.emit('risk:update', risk);
            } catch (error) {
              this.logger.warn('Fallback risk snapshot failed', error);
            }
          }
        } catch (error) {
          this.logger.error('Error emitting updates', error);
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
      this.logger.info(`Cleared custom exit plan for ${key}`);
    } else {
      this.customExitPlans.set(key, { stopLoss, takeProfit });
      this.logger.info(`Set custom exit plan for ${key}: SL=${stopLoss}, TP=${takeProfit}`);
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

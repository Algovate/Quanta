import { EventEmitter } from 'events';
import { TradingWorkflow } from '../core/workflow.js';
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
    EventBus.on('cycle:complete', payload => this.emit('cycle:complete', payload));
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

    this.workflow = new TradingWorkflow(exchange, marketDataProvider, aiAgent, config);

    // Wrap the workflow methods to emit events
    this.setupEventEmitters();

    this.workflow.start().catch(error => {
      this.logger.error('Trading workflow error', error);
      this.emit('error', error);
    });

    this.state.isRunning = true;
    this.state.startTime = Date.now();
    this.emit('system:state', { ...this.state });
  }

  async stop(): Promise<void> {
    if (!this.workflow) {
      throw new Error('No trading workflow is running');
    }

    this.logger.info('Stopping trading workflow...');
    await this.workflow.stop();
    this.workflow = null;

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

          this.emit('account:update', account);
          this.emit('position:update', positions);

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
              const risk: RiskSnapshot = {
                timestamp: Date.now(),
                marginRatio: account.marginRatio,
                usedMargin: account.usedMargin,
                availableMargin: account.availableMargin,
                leverage: pm.leverage,
                totalExposure: pm.totalExposure,
                exposureBySymbol: pm.exposureBySymbol,
                flags: [],
              };
              if (risk.marginRatio > 0.5) risk.flags.push('High margin usage');
              if (pm.totalUnrealizedPnl < -account.equity * 0.05) risk.flags.push('Drawdown > 5%');
              this.latestRisk = risk;
              this.emit('risk:update', risk);
            } catch (error) {
              this.logger.warn('Risk snapshot failed', error);
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

  stopIntervals(): void {
    if (this.updateIntervalId) {
      clearInterval(this.updateIntervalId);
      this.updateIntervalId = undefined;
    }
  }
}

/**
 * Drone Instance - Wrapper around TradingWorkflow with isolation
 *
 * Manages a single drone's lifecycle within an arena with:
 * - Isolated exchange instances
 * - Event namespacing
 * - Logger context isolation
 * - Metrics tracking
 */

import { EventEmitter } from 'events';
import { TradingWorkflow } from '../core/workflow.js';
import { MarketDataProvider } from '../data/market.js';
import { SimulatorExchange } from '../exchange/simulator.js';
import { PaperExchange } from '../exchange/paper.js';
import { OKXExchange } from '../exchange/okx.js';
import { BinanceExchange } from '../exchange/binance.js';
import { CoinbaseExchange } from '../exchange/coinbase.js';
import { HyperliquidExchange } from '../exchange/hyperliquid.js';
import { EventBus } from '../core/event-bus.js';
import type { DroneConfig, DroneMetrics } from './types.js';
import type { ArenaConfig } from './types.js';
import { DroneAIAgent } from './drone-ai-agent.js';
import type { AICallQueue } from './ai-call-queue.js';
import type { WorkflowConfig } from '../types/index.js';
import type { Exchange } from '../exchange/types.js';
import { UnifiedLogger } from '../logging/index.js';
import { getConfig, getExchangeConfig } from '../config/settings.js';
import { ExecutionSessionManager } from '../core/execution-session-manager.js';

export class DroneInstance extends EventEmitter {
  private workflow: TradingWorkflow;
  private exchange: Exchange; // Can be SimulatorExchange or PaperExchange
  private aiAgent: DroneAIAgent;
  private marketProvider: MarketDataProvider;
  private metrics: DroneMetrics;
  private initialBalance: number;
  private snapshots: Array<{ timestamp: number; equity: number }> = [];

  constructor(
    private arenaId: string,
    private config: DroneConfig,
    private aiCallQueue: AICallQueue,
    apiKey: string,
    _arenaConfig?: ArenaConfig
  ) {
    super();
    this.initialBalance = config.initialBalance;

    const logger = UnifiedLogger.getInstance();
    logger.info(
      `Creating DroneInstance ${config.id}`,
      {
        arenaId,
        droneId: config.id,
        droneName: config.name,
      },
      'DroneInstance'
    );

    // Create exchange - Arena only supports paper mode (real market data with simulated execution)
    const globalConfig = getConfig();
    const exchangeConfig = getExchangeConfig(globalConfig);

    if (exchangeConfig.name !== 'simulator') {
      try {
        const realExchange = this.createRealExchange(
          exchangeConfig.name,
          exchangeConfig.apiKey,
          exchangeConfig.apiSecret,
          exchangeConfig.testnet ?? true
        );
        this.exchange = new PaperExchange(realExchange, config.initialBalance);
        logger.info(
          `Created PaperExchange for drone ${config.id}`,
          {
            exchange: exchangeConfig.name,
            testnet: exchangeConfig.testnet,
            droneId: config.id,
          },
          'DroneInstance'
        );
      } catch (error) {
        logger.warn(
          `Failed to create real exchange for PaperExchange, falling back to SimulatorExchange`,
          {
            error: error instanceof Error ? error.message : String(error),
            exchange: exchangeConfig.name,
            droneId: config.id,
          },
          'DroneInstance'
        );
        // Fallback to SimulatorExchange if real exchange creation fails
        this.exchange = new SimulatorExchange(config.initialBalance);
      }
    } else {
      // Simulator exchange specified, use SimulatorExchange
      this.exchange = new SimulatorExchange(config.initialBalance);
    }

    // Create drone-specific AI agent with queue
    this.aiAgent = new DroneAIAgent(
      apiKey,
      config.aiConfig?.model || 'deepseek/deepseek-chat',
      config.aiConfig?.temperature || 0.7,
      config.id,
      this.aiCallQueue,
      config.promptPack
    );

    // Create market provider
    this.marketProvider = new MarketDataProvider(this.exchange);

    // Build workflow config
    const workflowConfig = this.buildWorkflowConfig();

    // Create workflow with event isolation
    // Type cast because DroneAIAgent has same interface as OpenRouterClient
    this.workflow = new TradingWorkflow(
      this.exchange,
      this.marketProvider,
      this.aiAgent as any,
      workflowConfig,
      {
        eventPrefix: `drone:${config.id}:`,
        loggerContext: `Arena:${arenaId}:Drone:${config.id}:${config.name}`,
      }
    );

    // Initialize metrics
    this.metrics = this.initializeMetrics();

    // Subscribe to drone events for metric tracking
    this.setupEventListeners();
  }

  private createRealExchange(
    name: string,
    apiKey?: string,
    apiSecret?: string,
    testnet: boolean = true
  ): Exchange {
    switch (name.toLowerCase()) {
      case 'okx':
        return new OKXExchange(apiKey, apiSecret, testnet);
      case 'binance':
        return new BinanceExchange(apiKey, apiSecret, testnet);
      case 'coinbase':
        return new CoinbaseExchange(apiKey, apiSecret, testnet);
      case 'hyperliquid':
        return new HyperliquidExchange(apiKey, apiSecret, testnet);
      default:
        throw new Error(
          `Unsupported exchange for arena data source: ${name}. Supported: okx, binance, coinbase, hyperliquid`
        );
    }
  }

  private buildWorkflowConfig(): WorkflowConfig {
    return {
      coins: this.config.coins,
      cyclePeriod: 60000, // 1 minute default
      maxPositions: this.config.riskParams.maxPositions,
      riskParams: {
        maxRiskPerTrade: this.config.riskParams.maxRiskPerTrade,
        maxTotalRisk: this.config.riskParams.maxTotalRisk,
        defaultStopLoss: this.config.riskParams.defaultStopLoss,
        maxLeverage: this.config.riskParams.maxLeverage,
        minLeverage: this.config.riskParams.minLeverage,
        maxPositions: this.config.riskParams.maxPositions,
      },
    };
  }

  private initializeMetrics(): DroneMetrics {
    return {
      droneId: this.config.id,
      name: this.config.name,
      cycleCount: 0,
      equity: this.initialBalance,
      balance: this.initialBalance,
      pnl: 0,
      pnlPercent: 0,
      totalSignals: 0,
      totalTrades: 0,
      winRate: 0,
      sharpeRatio: 0,
      maxDrawdown: 0,
      maxDrawdownValue: 0,
      totalReturn: 0,
      annualizedReturn: 0,
      profitFactor: 0,
      aiCost: 0,
      aiTokens: 0,
      aiCallCount: 0,
      lastUpdate: Date.now(),
    };
  }

  private setupEventListeners(): void {
    // Listen for this drone's prefixed events
    EventBus.on(`drone:${this.config.id}:cycle:complete` as any, async payload => {
      await this.updateMetrics(payload);
      this.emit('metrics:updated', this.metrics);
    });

    EventBus.on(`drone:${this.config.id}:cycle:start` as any, () => {
      // Track cycle start
    });

    // Listen to cycle:signals for metrics tracking
    EventBus.on(`drone:${this.config.id}:cycle:signals` as any, () => {
      this.metrics.totalSignals++;
    });

    // Listen to signal:buffer for complete signal data (including reasoning)
    EventBus.on(`drone:${this.config.id}:signal:buffer` as any, (payload: any) => {
      // Emit signal:generated with complete signal data including reasoning
      this.emit('signal:generated', {
        symbol: payload.symbol,
        coin: payload.symbol?.replace('/USDT', ''),
        action: payload.action,
        confidence: payload.confidence,
        reasoning: payload.reasoning,
        price: payload.price,
        strategy: payload.strategy,
        status: payload.status,
      });
    });
  }

  private async updateMetrics(payload: any): Promise<void> {
    try {
      // Update from payload
      this.metrics.cycleCount = payload.cycleCount;
      this.metrics.totalSignals = payload.totalSignals;
      this.metrics.totalTrades = payload.totalTrades;
      this.metrics.pnl = payload.totalPnl;
      this.metrics.lastUpdate = Date.now();

      // Update equity and balance from exchange (await to ensure equity is updated before snapshot)
      // Even if this fails, we'll still add a snapshot with the current metrics.equity
      try {
        await this.refreshMetricsFromExchange();
      } catch (err) {
        // Log error but continue - we'll use current metrics.equity for snapshot
        const logger = UnifiedLogger.getInstance();
        logger.warn(
          `Failed to refresh metrics from exchange for drone ${this.config.id}`,
          err,
          'DroneInstance'
        );
      }

      // Calculate derived metrics
      this.metrics.pnlPercent = (this.metrics.pnl / this.initialBalance) * 100;
      this.metrics.totalReturn = this.metrics.pnlPercent;

      // Track equity snapshots for drawdown calculation (use payload timestamp if available, otherwise use current time)
      const snapshotTimestamp = payload.timestamp || Date.now();
      this.snapshots.push({
        timestamp: snapshotTimestamp,
        equity: this.metrics.equity,
      });

      // Keep only recent snapshots (last 1000)
      if (this.snapshots.length > 1000) {
        this.snapshots.shift();
      }

      // Calculate drawdown
      this.calculateDrawdown();

      // Get AI costs
      const aiMetrics = this.aiAgent.getCostMetrics();
      this.metrics.aiCost = aiMetrics.totalCost;
      this.metrics.aiTokens = aiMetrics.totalTokens;
      this.metrics.aiCallCount = aiMetrics.callCount;

      // Calculate win rate (simplified - would need completed trades)
      // TODO: Get from exchange or workflow
    } catch (error) {
      // Ensure we log any errors but don't throw - we want metrics updates to be resilient
      const logger = UnifiedLogger.getInstance();
      logger.error(`Error updating metrics for drone ${this.config.id}`, error, 'DroneInstance');
    }
  }

  private async refreshMetricsFromExchange(): Promise<void> {
    // Get current account state
    try {
      const account = await this.exchange.getAccount();
      this.metrics.equity = account.equity;
      this.metrics.balance = account.balance;
    } catch (err) {
      const logger = UnifiedLogger.getInstance();
      logger.error('Failed to refresh metrics from exchange', err, 'DroneInstance');
    }
  }

  private calculateDrawdown(): void {
    if (this.snapshots.length < 2) {
      return;
    }

    let maxEquity = this.snapshots[0].equity;
    let maxDrawdown = 0;
    let maxDrawdownValue = 0;

    for (let i = 1; i < this.snapshots.length; i++) {
      const equity = this.snapshots[i].equity;

      if (equity > maxEquity) {
        maxEquity = equity;
      }

      const drawdown = ((equity - maxEquity) / maxEquity) * 100;
      const drawdownValue = equity - maxEquity;

      if (drawdown < maxDrawdown) {
        maxDrawdown = drawdown;
      }

      if (drawdownValue < maxDrawdownValue) {
        maxDrawdownValue = drawdownValue;
      }
    }

    this.metrics.maxDrawdown = maxDrawdown;
    this.metrics.maxDrawdownValue = maxDrawdownValue;
  }

  async start(): Promise<void> {
    const logger = UnifiedLogger.getInstance();
    const sessionManager = ExecutionSessionManager.getInstance();
    const activeSession = sessionManager.getActive();

    logger.info(
      `Starting drone ${this.config.id}`,
      {
        arenaId: this.arenaId,
        droneId: this.config.id,
        droneName: this.config.name,
        executionSession: activeSession
          ? {
              mode: activeSession.mode,
              env: activeSession.env,
              id: activeSession.id,
            }
          : undefined,
      },
      'DroneInstance'
    );

    await this.workflow.start();
  }

  async stop(): Promise<void> {
    const logger = UnifiedLogger.getInstance();
    const sessionManager = ExecutionSessionManager.getInstance();
    const activeSession = sessionManager.getActive();

    logger.info(
      `Stopping drone ${this.config.id}`,
      {
        arenaId: this.arenaId,
        droneId: this.config.id,
        droneName: this.config.name,
        executionSession: activeSession
          ? {
              mode: activeSession.mode,
              env: activeSession.env,
              id: activeSession.id,
            }
          : undefined,
      },
      'DroneInstance'
    );

    await this.workflow.stop();
  }

  getMetrics(): DroneMetrics {
    return { ...this.metrics };
  }

  /**
   * Get historical equity snapshots
   */
  getSnapshots(): Array<{ timestamp: number; equity: number }> {
    return [...this.snapshots];
  }

  getId(): string {
    return this.config.id;
  }

  getName(): string {
    return this.config.name;
  }

  getConfig(): DroneConfig {
    return { ...this.config };
  }

  getWorkflow(): TradingWorkflow {
    return this.workflow;
  }
}

import {
  BacktestExchange,
  type Account,
  type Position,
  type TradingSignal,
} from '../exchange/index.js';
import { HistoricalDataProvider, MarketDataProvider, type MarketData } from '../data/index.js';
import { MockAIAgent } from '../ai/index.js';
import { RiskManager, OrderExecutor, PositionMonitorService } from '../execution/index.js';
import {
  type BacktestResult,
  type BacktestConfig,
  type EquitySnapshot,
  type CompletedTrade,
  type PerformanceMetrics,
} from '../types/index.js';
import { PerformanceAnalytics } from '../analytics/index.js';
import { Logger, parseUTCDateString } from '../utils/index.js';
import cliProgress from 'cli-progress';

// Constants
const TIME_CONSTANTS = {
  MINUTE_MS: 60 * 1000,
  SIMULATION_INTERVAL: 3 * 60 * 1000, // 3 minutes
  SNAPSHOT_INTERVAL: 15 * 60 * 1000, // 15 minutes
  PROGRESS_UPDATE_THRESHOLD: 5, // percentage
} as const;

// Progress bar configuration
const PROGRESS_BAR_CONFIG = {
  format: '{bar} | {percentage}% | {duration}s',
  barCompleteChar: '\u2588',
  barIncompleteChar: '\u2591',
  hideCursor: true,
  clearOnComplete: false,
  linewrap: false,
} as const;

interface TradingCycleContext {
  account: Account;
  positions: Position[];
  currentTime: number;
}

type BacktestPhase = 'loading' | 'running' | 'finalizing' | 'completed';

export interface BacktestEngineCallbacks {
  onPhase?: (phase: BacktestPhase) => void;
  onProgress?: (progressPercent: number, elapsedSec: number) => void;
  onCycle?: (info: {
    cycleCount: number;
    timestamp: number;
    equity: number;
    exposure?: number;
    leverage?: number;
    positions: number;
    generatedSignals: number;
    acceptedSignals: number;
    rejectedSignals: number;
    unrealizedPnl: number;
  }) => void;
  onSnapshot?: (snapshot: EquitySnapshot) => void;
}

/**
 * Progress tracker for backtest progress reporting
 */
class ProgressTracker {
  private startSimulationTime: number;
  private lastProgressUpdate: number = 0;
  private simulationStartTime: number;
  private simulationEndTime: number;

  constructor(startTime: number, endTime: number) {
    this.simulationStartTime = startTime;
    this.simulationEndTime = endTime;
    this.startSimulationTime = Date.now();
  }

  startProgressBar(): cliProgress.SingleBar {
    const bar = new cliProgress.SingleBar(PROGRESS_BAR_CONFIG, cliProgress.Presets.shades_classic);
    bar.start(100, 0);
    return bar;
  }

  async updateProgress(currentTime: number, bar: cliProgress.SingleBar): Promise<void> {
    const totalDuration = this.simulationEndTime - this.simulationStartTime;
    const progress = Math.max(0, ((currentTime - this.simulationStartTime) / totalDuration) * 100);

    // Update on first call and every 0.5% progress to show real-time feedback
    if (this.lastProgressUpdate > 0 && progress - this.lastProgressUpdate < 0.5) {
      return;
    }

    // Calculate elapsed time in seconds
    const elapsedMs = Date.now() - this.startSimulationTime;
    const elapsedSec = Math.floor(elapsedMs / 1000);

    const progressValue = Math.floor(Math.min(progress, 100));
    bar.update(progressValue, {
      duration: elapsedSec,
    });
    this.lastProgressUpdate = progress;
  }

  stopProgressBar(bar: cliProgress.SingleBar): void {
    bar.update(100);
    bar.stop();
  }

  getElapsedTime(): number {
    return Date.now() - this.startSimulationTime;
  }
}

export class BacktestEngine {
  private exchange: BacktestExchange;
  private marketDataProvider: MarketDataProvider;
  private historicalDataProvider: HistoricalDataProvider;
  private aiAgent: MockAIAgent;
  private riskManager: RiskManager;
  private orderExecutor: OrderExecutor;
  private positionMonitor: PositionMonitorService;
  private config: BacktestConfig;
  private snapshots: EquitySnapshot[] = [];
  private startTime: number;
  private endTime: number;
  private dataSourceInfo: {
    totalCandles: number;
    details: string[];
    timeframes: string;
  } | null = null;
  private signalStats = { generated: 0, accepted: 0, rejected: 0 };
  private errorCount: number = 0;
  private logger = Logger.getInstance('BacktestEngine');
  private rng: () => number;
  private callbacks?: BacktestEngineCallbacks;

  constructor(config: BacktestConfig, callbacks?: BacktestEngineCallbacks) {
    this.config = config;
    // Initialize RNG (seeded if provided)
    this.rng = this.createRng(config.seed);
    this.callbacks = callbacks;

    // Convert dates to timestamps (using UTC to ensure consistency across timezones)
    this.startTime = parseUTCDateString(config.startDate);
    this.endTime = parseUTCDateString(config.endDate);

    if (this.startTime >= this.endTime) {
      throw new Error('Start date must be before end date');
    }

    // Initialize exchange with historical data provider (deterministic if seeded)
    this.historicalDataProvider = new HistoricalDataProvider(this.rng);

    this.exchange = new BacktestExchange(
      config.initialBalance,
      this.startTime,
      this.rng,
      config.backtestExec
    );

    this.marketDataProvider = new MarketDataProvider(this.exchange);
    this.aiAgent = new MockAIAgent();

    const riskParams = {
      maxRiskPerTrade: 0.05,
      maxTotalRisk: 0.3,
      maxPositions: config.maxPositions || 6,
      defaultStopLoss: 0.03,
      maxLeverage: config.leverage || 1,
      minLeverage: 1,
    };

    this.riskManager = new RiskManager(riskParams);
    this.orderExecutor = new OrderExecutor(this.exchange, this.riskManager, {
      forceMarketOrders: true,
    });
    this.positionMonitor = new PositionMonitorService(this.riskManager, this.orderExecutor);
  }

  private createRng(seed?: number): () => number {
    if (seed === undefined) return Math.random;
    // xorshift32-based RNG for determinism
    let state = seed | 0;
    if (state === 0) state = 0x6d2b79f5; // avoid zero state
    return () => {
      // xorshift32
      state ^= state << 13;
      state ^= state >>> 17;
      state ^= state << 5;
      // Convert to [0,1)
      // >>> 0 ensures unsigned; divide by 2^32
      return (state >>> 0) / 4294967296;
    };
  }

  /**
   * Run the complete backtest
   */
  async runBacktest(): Promise<BacktestResult> {
    this.callbacks?.onPhase?.('loading');
    // Load historical data
    await this.loadHistoricalData();

    // Display data source information
    this.displayDataSourceInfo();

    // Run the simulation
    this.callbacks?.onPhase?.('running');
    await this.runSimulation();

    // Close all positions at the end
    this.callbacks?.onPhase?.('finalizing');
    await this.exchange.closeAllPositions();

    // Take a final snapshot post-close to ensure final equity/balance are accurate
    await this.recordSnapshot();

    // Calculate final metrics
    const result = this.generateResult();

    this.callbacks?.onPhase?.('completed');

    return result;
  }

  private displayDataSourceInfo(): void {
    if (this.dataSourceInfo) {
      console.log(`📊 Data Source: Simulated historical data`);
      console.log(`   Total Candles: ${this.dataSourceInfo.totalCandles.toLocaleString()}`);
      console.log(`   Timeframes: ${this.dataSourceInfo.timeframes}`);
      console.log(`   Breakdown: ${this.dataSourceInfo.details.join(', ')}`);
      console.log('');
    }
  }

  /**
   * Load historical data for all configured coins
   */
  private async loadHistoricalData(): Promise<void> {
    const timeframes = ['3m', '4h'];
    const startDate = new Date(this.startTime);
    const endDate = new Date(this.endTime);

    let totalCandles = 0;
    const dataInfo: string[] = [];

    for (const coin of this.config.coins) {
      const symbol = `${coin}/USDT`;

      // Fetch all timeframes for a coin in parallel
      const framePromises = timeframes.map(async timeframe => {
        const candlesticks = await this.historicalDataProvider.getHistoricalCandlesticks(
          symbol,
          timeframe,
          startDate,
          endDate
        );
        this.exchange.loadHistoricalData(`${symbol}_${timeframe}`, candlesticks);
        return candlesticks.length;
      });

      const results = await Promise.allSettled(framePromises);
      const coinCandles = results.reduce(
        (sum, r) => (r.status === 'fulfilled' ? sum + r.value : sum),
        0
      );

      totalCandles += coinCandles;
      dataInfo.push(`${coin}: ${coinCandles} candles`);
    }

    // Store for later display
    this.dataSourceInfo = {
      totalCandles,
      details: dataInfo,
      timeframes: timeframes.join(', '),
    };
  }

  /**
   * Run the simulation advancing through time
   */
  private async runSimulation(): Promise<void> {
    let currentTime = this.startTime;
    let cycleCount = 0;
    const cyclePeriodMs = this.config.cyclePeriod || TIME_CONSTANTS.SIMULATION_INTERVAL * 60;

    const progressTracker = new ProgressTracker(this.startTime, this.endTime);
    const bar = progressTracker.startProgressBar();

    while (currentTime <= this.endTime) {
      this.exchange.setCurrentTime(currentTime);

      // Update progress bar
      await progressTracker.updateProgress(currentTime, bar);
      // Emit progress callback (recompute percent here to avoid coupling to tracker internals)
      const totalDuration = this.endTime - this.startTime;
      const progress = Math.max(0, ((currentTime - this.startTime) / totalDuration) * 100);
      const elapsedMs = progressTracker.getElapsedTime();
      this.callbacks?.onProgress?.(Math.min(100, progress), Math.floor(elapsedMs / 1000));

      // Record equity snapshot at regular intervals
      if (this.shouldRecordSnapshot(currentTime)) {
        await this.recordSnapshot();
      }

      // Execute trading cycle when it's time
      if (this.shouldExecuteCycle(cycleCount, cyclePeriodMs)) {
        try {
          await this.executeCycle(currentTime, cycleCount);
        } catch (error) {
          this.logger.error('Error executing backtest cycle', error, {
            currentTime: new Date(currentTime).toISOString(),
            cycleCount,
          });
          // Continue simulation but track error
          this.errorCount++;
        }
      }

      currentTime += TIME_CONSTANTS.SIMULATION_INTERVAL;
      cycleCount++;
    }

    // Record final snapshot and complete
    await this.completeSimulation(progressTracker, bar);
  }

  /**
   * Check if a snapshot should be recorded at this time
   */
  private shouldRecordSnapshot(currentTime: number): boolean {
    return (
      currentTime === this.startTime ||
      (currentTime - this.startTime) % TIME_CONSTANTS.SNAPSHOT_INTERVAL === 0
    );
  }

  /**
   * Check if a trading cycle should be executed
   */
  private shouldExecuteCycle(cycleCount: number, cyclePeriodMs: number): boolean {
    const cyclesPerExecution = cyclePeriodMs / TIME_CONSTANTS.SIMULATION_INTERVAL;
    return cycleCount % Math.floor(cyclesPerExecution) === 0;
  }

  /**
   * Complete the simulation by recording final snapshot and closing positions
   */
  private async completeSimulation(
    progressTracker: ProgressTracker,
    bar: cliProgress.SingleBar
  ): Promise<void> {
    this.exchange.setCurrentTime(this.endTime);
    await this.recordSnapshot();

    // Stop the progress bar
    progressTracker.stopProgressBar(bar);
  }

  /**
   * Execute one trading cycle
   */
  private async executeCycle(currentTime: number, cycleIndex: number): Promise<void> {
    const context = await this.getCycleContext(currentTime);

    // Monitor existing positions
    await this.monitorExistingPositions(context.positions);

    // Get market data
    const marketData = await this.collectMarketData();
    if (marketData.length === 0) return;

    // Generate AI signals
    const signals = await this.generateSignals(marketData, context);

    // Only count actionable signals (exclude HOLD)
    const actionableSignals = signals.filter(s => s.action !== 'HOLD');
    this.signalStats.generated += actionableSignals.length;

    // Execute signals
    await this.executeSignals(signals, context);

    // Emit aggregated cycle info for UI
    const accountNow = await this.exchange.getAccount();
    const positionsNow = await this.exchange.getPositions();
    let exposure: number | undefined = undefined;
    let leverage: number | undefined = undefined;
    try {
      const metrics = await (this.exchange as any).getPortfolioMetrics?.();
      if (metrics) {
        exposure = metrics.totalExposure;
        leverage = metrics.leverage;
      }
    } catch {
      // optional
    }
    const unrealizedPnl = positionsNow.reduce((s, p) => s + p.unrealizedPnl, 0);
    this.callbacks?.onCycle?.({
      cycleCount: cycleIndex,
      timestamp: currentTime,
      equity: accountNow.equity,
      exposure,
      leverage,
      positions: positionsNow.length,
      generatedSignals: signals.filter(s => s.action !== 'HOLD').length,
      acceptedSignals: this.signalStats.accepted,
      rejectedSignals: this.signalStats.rejected,
      unrealizedPnl,
    });
  }

  /**
   * Get current trading cycle context
   */
  private async getCycleContext(currentTime: number): Promise<TradingCycleContext> {
    return {
      account: await this.exchange.getAccount(),
      positions: await this.exchange.getPositions(),
      currentTime,
    };
  }

  /**
   * Monitor existing positions
   */
  private async monitorExistingPositions(
    positions: TradingCycleContext['positions']
  ): Promise<void> {
    if (positions.length > 0) {
      await this.positionMonitor.monitorPositions(positions, this.exchange);
    }
  }

  /**
   * Collect market data for all configured coins
   */
  private async collectMarketData(): Promise<MarketData[]> {
    const timeframes = ['3m', '4h'];

    // Fetch market data for all coins in parallel; continue on failures
    const results = await Promise.allSettled(
      this.config.coins.map(async coin => {
        const symbol = `${coin}/USDT`;
        try {
          return await this.marketDataProvider.getMarketData(symbol, timeframes);
        } catch (error) {
          this.logger.warn(`No market data available for ${symbol}`, error);
          return [] as MarketData[];
        }
      })
    );

    const aggregated: MarketData[] = [];
    for (const r of results) {
      if (r.status === 'fulfilled') {
        aggregated.push(...r.value);
      }
    }
    return aggregated;
  }

  /**
   * Generate AI trading signals
   */
  private async generateSignals(
    marketData: MarketData[],
    context: TradingCycleContext
  ): Promise<TradingSignal[]> {
    const aiContext = {
      startTime: this.startTime,
      currentTime: context.currentTime,
      invokeCount: 1,
      tradableCoins: this.config.coins,
      maxPositions: this.config.maxPositions || 6,
      maxRiskPerTrade: 0.05,
      maxLeverage: this.config.leverage || 1,
      minLeverage: 1,
      defaultStopLoss: 0.03,
    };

    return await this.aiAgent.generateTradingSignal(
      marketData,
      context.account,
      context.positions,
      aiContext
    );
  }

  /**
   * Execute trading signals
   */
  private async executeSignals(
    signals: TradingSignal[],
    context: TradingCycleContext
  ): Promise<void> {
    for (const signal of signals) {
      if (signal.action === 'HOLD') continue;

      try {
        const symbol = `${signal.coin}/USDT`;
        const ticker = await this.exchange.getTicker(symbol);
        const currentPrice = (ticker as { price: number }).price;

        const result = await this.orderExecutor.executeSignal(
          signal,
          context.account,
          context.positions,
          currentPrice
        );

        // Record result - result is always defined, but success may be false
        if (result.success) {
          this.signalStats.accepted++;
        } else {
          this.signalStats.rejected++;
        }
      } catch (error) {
        // Count exceptions as rejected signals
        this.logger.error(`Failed to execute signal for ${signal.coin}`, error);
        this.signalStats.rejected++;
      }
    }
  }

  /**
   * Record an equity snapshot
   */
  private async recordSnapshot(): Promise<void> {
    const account = await this.exchange.getAccount();
    const positions = await this.exchange.getPositions();

    const unrealizedPnl = positions.reduce((sum, pos) => sum + pos.unrealizedPnl, 0);

    this.snapshots.push({
      timestamp: this.exchange.getCurrentTime(),
      equity: account.equity,
      balance: account.balance,
      unrealizedPnl,
    });

    const last = this.snapshots[this.snapshots.length - 1];
    this.callbacks?.onSnapshot?.(last);
  }

  /**
   * Generate the final backtest result
   */
  private generateResult(): BacktestResult {
    const startTime = this.startTime;
    const endTime = this.endTime;
    const duration = (endTime - startTime) / 1000; // Convert milliseconds to seconds

    const finalAccount = this.snapshots[this.snapshots.length - 1];
    const completedTrades = this.exchange.getCompletedTrades();

    // Process completed trades
    const trades: CompletedTrade[] = completedTrades.map((trade, index) => ({
      ...trade,
      id: `trade_${index + 1}`,
      reason: trade.reason || 'end_of_backtest',
    }));

    // Create result object first (without metrics)
    const resultWithoutMetrics: Omit<BacktestResult, 'metrics'> = {
      config: this.config,
      startTime,
      endTime,
      duration,
      equitySnapshots: this.snapshots,
      trades,
      finalBalance: finalAccount.balance,
      finalEquity: finalAccount.equity,
      signalStats: this.signalStats,
    };

    // Calculate performance metrics using the complete result
    const metrics = new PerformanceAnalytics().calculateMetrics({
      ...resultWithoutMetrics,
      metrics: {} as PerformanceMetrics, // Will be overwritten
    });

    return {
      config: this.config,
      startTime,
      endTime,
      duration,
      equitySnapshots: this.snapshots,
      trades,
      metrics,
      finalBalance: finalAccount.balance,
      finalEquity: finalAccount.equity,
      signalStats: this.signalStats,
    };
  }
}

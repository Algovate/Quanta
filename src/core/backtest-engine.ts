import { BacktestExchange } from '../exchange/backtest.js';
import { HistoricalDataProvider } from '../data/historical.js';
import { MarketDataProvider, MarketData } from '../data/market.js';
import { MockAIAgent } from '../ai/mock-agent.js';
import { RiskManager } from '../execution/risk.js';
import { OrderExecutor } from '../execution/orders.js';
import { PositionMonitorService } from '../execution/monitor.js';
import {
  BacktestResult,
  BacktestConfig,
  EquitySnapshot,
  CompletedTrade,
  Account,
  Position,
  TradingSignal,
  PerformanceMetrics,
} from '../types/index.js';
import { PerformanceAnalytics } from '../analytics/performance.js';
import { Logger } from '../utils/logger.js';
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

  constructor(config: BacktestConfig) {
    this.config = config;

    // Convert dates to timestamps
    this.startTime = new Date(config.startDate).getTime();
    this.endTime = new Date(config.endDate).getTime();

    if (this.startTime >= this.endTime) {
      throw new Error('Start date must be before end date');
    }

    // Initialize exchange with historical data provider
    this.historicalDataProvider = new HistoricalDataProvider();

    this.exchange = new BacktestExchange(config.initialBalance, this.startTime);

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
    this.orderExecutor = new OrderExecutor(this.exchange, this.riskManager);
    this.positionMonitor = new PositionMonitorService(this.riskManager, this.orderExecutor);
  }

  /**
   * Run the complete backtest
   */
  async runBacktest(): Promise<BacktestResult> {
    // Load historical data
    await this.loadHistoricalData();

    // Display data source information
    this.displayDataSourceInfo();

    // Run the simulation
    await this.runSimulation();

    // Close all positions at the end
    await this.exchange.closeAllPositions();

    // Calculate final metrics
    const result = this.generateResult();

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

      // Record equity snapshot at regular intervals
      if (this.shouldRecordSnapshot(currentTime)) {
        await this.recordSnapshot();
      }

      // Execute trading cycle when it's time
      if (this.shouldExecuteCycle(cycleCount, cyclePeriodMs)) {
        try {
          await this.executeCycle(currentTime);
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
    return currentTime === this.startTime || currentTime % TIME_CONSTANTS.SNAPSHOT_INTERVAL === 0;
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
  private async executeCycle(currentTime: number): Promise<void> {
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

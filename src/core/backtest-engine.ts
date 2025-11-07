import {
  BacktestExchange,
  type Account,
  type Position,
  type TradingSignal,
} from '../exchange/index.js';
import {
  MarketDataProvider,
  type MarketData,
  OKXHistoricalProvider,
  BinanceHistoricalProvider,
  CachedHistoricalProvider,
  SimulatedHistoricalProvider,
  type IHistoricalProvider,
  type FetchProgress,
} from '../data/index.js';
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
import { parseUTCDateString } from '../utils/index.js';
import { UnifiedLogger } from '../logging/index.js';
import { ProgressTracker } from './backtest/progress-tracker.js';
import cliProgress from 'cli-progress';
import { POSITION_SIZING, SIGNAL_VALIDATION } from '../execution/constants.js';

// Constants
const TIME_CONSTANTS = {
  MINUTE_MS: 60 * 1000,
  SIMULATION_INTERVAL: 3 * 60 * 1000, // 3 minutes
  SNAPSHOT_INTERVAL: 15 * 60 * 1000, // 15 minutes
  PROGRESS_UPDATE_THRESHOLD: 5, // percentage
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
  onLoadingProgress?: (info: {
    symbol: string;
    timeframe: string;
    completed: number;
    total: number;
    elapsedSec: number;
    paginationProgress?: {
      pages: number;
      candles: number;
    };
  }) => void;
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

export interface BacktestEngineOptions {
  monitoringVerbosity?: 'verbose' | 'normal' | 'quiet';
}

export class BacktestEngine {
  private exchange: BacktestExchange;
  private marketDataProvider: MarketDataProvider;
  private historicalDataProvider: IHistoricalProvider;
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
  private signalStats = {
    generated: 0,
    accepted: 0,
    rejected: 0,
    byAction: {
      LONG: { generated: 0, accepted: 0, rejected: 0 },
      SHORT: { generated: 0, accepted: 0, rejected: 0 },
      CLOSE: { generated: 0, accepted: 0, rejected: 0 },
      HOLD: { generated: 0, accepted: 0, rejected: 0 },
    },
    rejectionReasons: {} as Record<string, number>,
    confidenceDistribution: {
      min: Infinity,
      max: -Infinity,
      totalSum: 0,
      count: 0,
      byAction: {
        LONG: { min: Infinity, max: -Infinity, totalSum: 0, count: 0 },
        SHORT: { min: Infinity, max: -Infinity, totalSum: 0, count: 0 },
      },
    },
    skippedTinyPartials: 0,
    batchedTinyPartials: 0,
  };
  private errorCount: number = 0;
  private logger = UnifiedLogger.getInstance();
  private readonly context = 'BacktestEngine';
  private rng: () => number;
  private callbacks?: BacktestEngineCallbacks;

  constructor(
    config: BacktestConfig,
    callbacks?: BacktestEngineCallbacks,
    options?: BacktestEngineOptions
  ) {
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

    // Initialize historical data provider based on config
    // Directly use IHistoricalProvider (which may be wrapped with CachedHistoricalProvider)
    // No need for additional HistoricalDataProvider wrapper layer
    this.historicalDataProvider = this.createHistoricalProvider();

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
      minNotionalUsd: config.backtestExec?.minNotionalUsd,
    });
    this.positionMonitor = new PositionMonitorService(this.riskManager, this.orderExecutor, {
      monitoringVerbosity: options?.monitoringVerbosity || 'normal',
    });
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
   * Create historical data provider based on config
   */
  private createHistoricalProvider(): IHistoricalProvider {
    const providerType = this.config.historicalProvider || 'sim';

    let provider: IHistoricalProvider;

    switch (providerType) {
      case 'okx':
        provider = new OKXHistoricalProvider({
          apiKey: this.config.exchange?.apiKey,
          apiSecret: this.config.exchange?.apiSecret,
          passphrase: this.config.exchange?.passphrase,
          testnet: this.config.exchange?.testnet,
        });
        break;
      case 'binance':
        provider = new BinanceHistoricalProvider({
          apiKey: this.config.exchange?.apiKey,
          apiSecret: this.config.exchange?.apiSecret,
          testnet: this.config.exchange?.testnet,
        });
        break;
      case 'sim':
      default:
        provider = new SimulatedHistoricalProvider(this.rng);
        break;
    }

    // Wrap with disk cache if cache directory is specified
    if (this.config.dataCacheDir) {
      provider = new CachedHistoricalProvider(provider, this.config.dataCacheDir);
    }

    return provider;
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
      const logger = UnifiedLogger.getInstance();
      const providerName =
        this.config.historicalProvider === 'okx'
          ? 'OKX historical data'
          : this.config.historicalProvider === 'binance'
            ? 'Binance historical data'
            : 'Simulated historical data';
      logger.info(
        `📊 Data Source: ${providerName}`,
        {
          totalCandles: this.dataSourceInfo.totalCandles.toLocaleString(),
          timeframes: this.dataSourceInfo.timeframes,
          breakdown: this.dataSourceInfo.details.join(', '),
        },
        'BacktestEngine'
      );
    }
  }

  /**
   * Load historical data for all configured coins
   * Preloads all required data and handles cache misses gracefully
   */
  private async loadHistoricalData(): Promise<void> {
    const timeframes = ['3m', '4h'];
    const startDate = new Date(this.startTime);
    const endDate = new Date(this.endTime);

    const results = await this.loadDataForAllCoins(timeframes, startDate, endDate);

    // Warn if any loads failed
    if (results.failedLoads.length > 0) {
      this.logger.warn(
        `Some historical data failed to load: ${results.failedLoads.join(', ')}`,
        { failedLoads: results.failedLoads },
        this.context
      );
    }

    // Store for later display
    this.dataSourceInfo = {
      totalCandles: results.totalCandles,
      details: results.dataInfo,
      timeframes: timeframes.join(', '),
    };
  }

  /**
   * Load historical data for all coins
   */
  private async loadDataForAllCoins(
    timeframes: string[],
    startDate: Date,
    endDate: Date
  ): Promise<{ totalCandles: number; dataInfo: string[]; failedLoads: string[] }> {
    let totalCandles = 0;
    const dataInfo: string[] = [];
    const failedLoads: string[] = [];

    // Calculate total operations for progress tracking
    const totalOperations = this.config.coins.length * timeframes.length;
    const startTime = Date.now();
    let completedOperations = 0;

    for (const coin of this.config.coins) {
      const symbol = `${coin}/USDT`;
      const coinResult = await this.loadDataForCoin(
        symbol,
        coin,
        timeframes,
        startDate,
        endDate,
        totalOperations,
        completedOperations,
        startTime
      );

      completedOperations += timeframes.length;
      totalCandles += coinResult.candleCount;
      dataInfo.push(coinResult.info);
      failedLoads.push(...coinResult.failed);
    }

    return { totalCandles, dataInfo, failedLoads };
  }

  /**
   * Load historical data for a single coin across all timeframes
   */
  private async loadDataForCoin(
    symbol: string,
    coin: string,
    timeframes: string[],
    startDate: Date,
    endDate: Date,
    totalOperations: number,
    completedOperations: number,
    startTime: number
  ): Promise<{ candleCount: number; info: string; failed: string[] }> {
    const results = [];
    let currentCompleted = completedOperations;

    // Load timeframes sequentially to emit progress for each
    for (const timeframe of timeframes) {
      const result = await this.loadDataForTimeframe(
        symbol,
        timeframe,
        startDate,
        endDate,
        currentCompleted,
        totalOperations,
        startTime
      );
      results.push(result);
      currentCompleted++;
    }

    const coinCandles = results.reduce((sum, r) => sum + r.candleCount, 0);
    const failed = results.filter(r => r.candleCount === 0).map(r => r.symbolTimeframe);

    return {
      candleCount: coinCandles,
      info: coinCandles > 0 ? `${coin}: ${coinCandles} candles` : `${coin}: failed to load`,
      failed,
    };
  }

  /**
   * Update loading progress with throttling
   */
  private updateLoadingProgress(
    symbol: string,
    timeframe: string,
    completed: number,
    total: number,
    startTime: number,
    paginationProgress?: { pages: number; candles: number },
    lastUpdateRef?: { value: number }
  ): void {
    const now = Date.now();
    const elapsedSec = (now - startTime) / 1000;

    // Throttle updates to avoid excessive spinner updates (every 1 second)
    if (lastUpdateRef && now - lastUpdateRef.value < 1000) {
      return;
    }

    this.callbacks?.onLoadingProgress?.({
      symbol,
      timeframe,
      completed,
      total,
      elapsedSec,
      paginationProgress,
    });

    if (lastUpdateRef) {
      lastUpdateRef.value = now;
    }
  }

  /**
   * Load historical data for a single symbol/timeframe
   */
  private async loadDataForTimeframe(
    symbol: string,
    timeframe: string,
    startDate: Date,
    endDate: Date,
    completedOperations: number,
    totalOperations: number,
    startTime: number
  ): Promise<{ candleCount: number; symbolTimeframe: string }> {
    try {
      // Track whether we're actually loading (not from cache)
      // Only show progress updates when we're actually fetching data
      let isLoadingFromNetwork = false;

      // Create throttled progress callback for pagination updates
      const lastProgressUpdate = { value: 0 };

      const progressCallback = (progress: FetchProgress) => {
        // First progress update indicates we're loading from network
        if (!isLoadingFromNetwork) {
          isLoadingFromNetwork = true;
          // Emit initial progress update when we know we're loading
          this.updateLoadingProgress(
            symbol,
            timeframe,
            completedOperations,
            totalOperations,
            startTime
          );
        }
        this.updateLoadingProgress(
          symbol,
          timeframe,
          completedOperations,
          totalOperations,
          startTime,
          {
            pages: progress.pages,
            candles: progress.candles,
          },
          lastProgressUpdate
        );
      };

      const candlesticks = await this.historicalDataProvider.getHistoricalCandlesticks(
        symbol,
        timeframe,
        startDate,
        endDate,
        progressCallback
      );

      if (candlesticks.length === 0) {
        this.logger.warn(
          `No historical data loaded for ${symbol} ${timeframe}`,
          { symbol, timeframe, startDate, endDate },
          this.context
        );
        return { candleCount: 0, symbolTimeframe: `${symbol} ${timeframe}` };
      }

      // Load data into exchange
      this.exchange.loadHistoricalData(symbol, timeframe, candlesticks);
      return { candleCount: candlesticks.length, symbolTimeframe: `${symbol} ${timeframe}` };
    } catch (error) {
      this.logger.warn(
        `Failed to load historical data for ${symbol} ${timeframe}`,
        {
          symbol,
          timeframe,
          error: error instanceof Error ? error.message : String(error),
        },
        this.context
      );
      return { candleCount: 0, symbolTimeframe: `${symbol} ${timeframe}` };
    }
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
          this.logger.error(
            'Error executing backtest cycle',
            error instanceof Error ? error : new Error(String(error)),
            this.context
          );
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

    // Track all signals by action type and confidence
    for (const signal of signals) {
      const action = signal.action;
      if (this.signalStats.byAction[action]) {
        this.signalStats.byAction[action].generated++;
      }

      // Track confidence distribution
      if (signal.confidence !== undefined) {
        const conf = signal.confidence;
        const dist = this.signalStats.confidenceDistribution;
        dist.min = Math.min(dist.min, conf);
        dist.max = Math.max(dist.max, conf);
        dist.totalSum += conf;
        dist.count++;

        if (action === 'LONG' || action === 'SHORT') {
          const actionStats = dist.byAction[action];
          if (actionStats) {
            actionStats.min = Math.min(actionStats.min, conf);
            actionStats.max = Math.max(actionStats.max, conf);
            actionStats.totalSum += conf;
            actionStats.count++;
          }
        }
      }
    }

    // Only count actionable signals (exclude HOLD) for main counter
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
        // Pass coin name, not symbol - MarketDataProvider will handle normalization
        // getMarketData() expects coin name (e.g., "ETH"), not symbol (e.g., "ETH/USDT")
        try {
          return await this.marketDataProvider.getMarketData(coin, timeframes);
        } catch (error) {
          this.logger.warn(
            `No market data available for ${coin}`,
            error instanceof Error ? { error: error.message } : { error: String(error) },
            this.context
          );
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

      // Early filter: Skip LONG/SHORT signals for coins that already have positions
      // This prevents unnecessary execution attempts that will be rejected
      if (signal.action === 'LONG' || signal.action === 'SHORT') {
        const positionSymbol = `${signal.coin}/USDT`;
        const existingPosition = context.positions.find(p => p.symbol === positionSymbol);
        if (existingPosition) {
          // Signal would be rejected by validator anyway, skip execution
          this.signalStats.rejected++;
          const action = signal.action;
          if (this.signalStats.byAction[action]) {
            this.signalStats.byAction[action].rejected++;
          }
          const reason = `Position already exists for ${signal.coin} (${existingPosition.side} ${existingPosition.size} ${signal.coin})`;
          this.signalStats.rejectionReasons[reason] =
            (this.signalStats.rejectionReasons[reason] || 0) + 1;
          continue;
        }
      }

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

        // Record result with diagnostic tracking
        const action = signal.action;
        if (result.success) {
          this.signalStats.accepted++;
          if (this.signalStats.byAction[action]) {
            this.signalStats.byAction[action].accepted++;
          }
        } else {
          this.signalStats.rejected++;
          if (this.signalStats.byAction[action]) {
            this.signalStats.byAction[action].rejected++;
          }

          // Track rejection reason
          const reason = result.error || 'Unknown error';
          this.signalStats.rejectionReasons[reason] =
            (this.signalStats.rejectionReasons[reason] || 0) + 1;
        }
      } catch (error) {
        // Count exceptions as rejected signals
        const errorMsg = error instanceof Error ? error.message : 'Unknown error';
        this.logger.error(
          `Failed to execute signal for ${signal.coin}`,
          error instanceof Error ? error : new Error(String(error)),
          this.context
        );
        this.signalStats.rejected++;
        const action = signal.action;
        if (this.signalStats.byAction[action]) {
          this.signalStats.byAction[action].rejected++;
        }
        this.signalStats.rejectionReasons[`Exception: ${errorMsg}`] =
          (this.signalStats.rejectionReasons[`Exception: ${errorMsg}`] || 0) + 1;
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

    // Get partial close stats from OrderExecutor
    const partialCloseStats = this.orderExecutor.getPartialCloseStats();

    // Calculate final averages for confidence distribution
    const confDist = this.signalStats.confidenceDistribution;
    const finalSignalStats = {
      ...this.signalStats,
      skippedTinyPartials: partialCloseStats.skipped,
      batchedTinyPartials: partialCloseStats.batched,
      confidenceDistribution: {
        min: confDist.min === Infinity ? 0 : confDist.min,
        max: confDist.max === -Infinity ? 0 : confDist.max,
        avg: confDist.count > 0 ? confDist.totalSum / confDist.count : 0,
        byAction: {
          LONG:
            confDist.byAction.LONG.count > 0
              ? {
                  min: confDist.byAction.LONG.min === Infinity ? 0 : confDist.byAction.LONG.min,
                  max: confDist.byAction.LONG.max === -Infinity ? 0 : confDist.byAction.LONG.max,
                  avg: confDist.byAction.LONG.totalSum / confDist.byAction.LONG.count,
                  count: confDist.byAction.LONG.count,
                }
              : undefined,
          SHORT:
            confDist.byAction.SHORT.count > 0
              ? {
                  min: confDist.byAction.SHORT.min === Infinity ? 0 : confDist.byAction.SHORT.min,
                  max: confDist.byAction.SHORT.max === -Infinity ? 0 : confDist.byAction.SHORT.max,
                  avg: confDist.byAction.SHORT.totalSum / confDist.byAction.SHORT.count,
                  count: confDist.byAction.SHORT.count,
                }
              : undefined,
        },
      },
    };

    // Build initialization environment summary
    const execDefaults = {
      takerFeeRate: 0.0004,
      makerFeeRate: 0.0002,
      maxMarketSlippageBps: 5,
      partialFillProbability: 0.0,
      minPartialFillRatio: 0.5,
      maxPartialFillRatio: 1.0,
      networkLatencyMs: 0,
      latencySlippageBpsPerSec: 0.5,
    } as const;
    const execCfg = { ...execDefaults, ...(this.config.backtestExec || {}) };

    const initEnv = {
      trading: {
        coins: this.config.coins,
        period: { start: this.config.startDate, end: this.config.endDate },
        initialBalance: this.config.initialBalance,
        maxPositions: this.config.maxPositions || 6,
      },
      leverage: { min: 1, max: this.config.leverage || 1 },
      riskSizing: {
        maxRiskPerTrade: 0.05,
        maxCapitalPercent: POSITION_SIZING.MAX_CAPITAL_PERCENT,
        minReservePercent: POSITION_SIZING.MIN_RESERVE_PERCENT,
        maxPositionSizePercent: POSITION_SIZING.MAX_POSITION_SIZE_PERCENT,
      },
      ai: {
        provider: 'mock' as const,
        model: 'internal',
        context: {
          maxPositions: this.config.maxPositions || 6,
          maxRiskPerTrade: 0.05,
          defaultStopLoss: 0.03,
          leverage: { min: 1, max: this.config.leverage || 1 },
        },
      },
      validation: {
        minConfidence: SIGNAL_VALIDATION.MIN_CONFIDENCE,
        maxSameSidePositions: POSITION_SIZING.MAX_SAME_SIDE_POSITIONS,
        correlationThreshold: POSITION_SIZING.MAX_PAIRWISE_CORRELATION,
      },
      execution: {
        takerFeeRate: execCfg.takerFeeRate,
        makerFeeRate: execCfg.makerFeeRate,
        maxMarketSlippageBps: execCfg.maxMarketSlippageBps,
        partialFillProbability: execCfg.partialFillProbability,
        networkLatencyMs: execCfg.networkLatencyMs,
        latencySlippageBpsPerSec: execCfg.latencySlippageBpsPerSec,
        minNotionalUsd: execCfg.minNotionalUsd,
      },
      dataSource: this.dataSourceInfo
        ? {
            timeframes: this.dataSourceInfo.timeframes,
            details: this.dataSourceInfo.details,
            provider: this.config.historicalProvider || 'sim',
          }
        : undefined,
    };

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
      signalStats: finalSignalStats,
      initEnv,
    };

    // Calculate performance metrics using the complete result
    const metrics = new PerformanceAnalytics().calculateMetrics({
      ...resultWithoutMetrics,
      metrics: {} as PerformanceMetrics, // Will be overwritten
    });

    // Get total fees from exchange
    const totalFees = this.exchange.getTotalFees ? this.exchange.getTotalFees() : 0;
    const feeStats = {
      totalFees,
      totalFeesPercent:
        this.config.initialBalance > 0 ? (totalFees / this.config.initialBalance) * 100 : 0,
    };

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
      signalStats: finalSignalStats,
      initEnv,
      feeStats,
    };
  }
}

import { Exchange } from '../exchange/types.js';
import { MarketDataProvider, MarketData } from '../data/market.js';
import { OpenRouterClient, AIContext } from '../ai/agent.js';
import { RiskManager } from '../execution/risk.js';
import { OrderExecutor } from '../execution/orders.js';
import { PositionMonitorService } from '../execution/monitor.js';
import { Account, Position, TradingSignal } from '../types/index.js';
import { EventBus } from './event-bus.js';
import { aggregatePositionMetrics, PositionAggregates } from '../execution/position-utils.js';
import { validateAccount } from '../utils/account-validation.js';
import { Logger } from '../utils/logger.js';
import { CycleLogger, CycleDisplay } from './display/index.js';
import chalk from 'chalk';
import { ExchangeSnapshotService } from './exchange-snapshot.js';

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
  private logger: Logger;
  private cycleLogger: CycleLogger;
  private cycleDisplay: CycleDisplay;
  private isBackgroundMode: boolean;
  private snapshotService: ExchangeSnapshotService;

  constructor(
    exchange: Exchange,
    marketDataProvider: MarketDataProvider,
    aiAgent: OpenRouterClient,
    config: WorkflowConfig
  ) {
    this.exchange = exchange;
    this.marketDataProvider = marketDataProvider;
    this.aiAgent = aiAgent;
    this.config = config;

    this.riskManager = new RiskManager(config.riskParams);
    // Force market orders when using simulated execution (SimulatorExchange in simulation/paper)
    const exchangeName = exchange.getExchangeName();
    const forceMarket = exchangeName === 'simulator' || exchangeName.startsWith('paper(');
    this.orderExecutor = new OrderExecutor(exchange, this.riskManager, {
      forceMarketOrders: forceMarket,
    });
    this.positionMonitor = new PositionMonitorService(this.riskManager, this.orderExecutor);
    this.logger = Logger.getInstance('Workflow');
    this.cycleLogger = new CycleLogger();
    this.cycleDisplay = new CycleDisplay();
    this.isBackgroundMode = this.logger.isBackgroundMode();
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
   * Emit log message with proper handling for foreground vs background mode
   * - Foreground: Direct synchronous console output for chronological ordering
   * - Background: Buffered logger output for efficiency
   */
  private emitLog(level: 'info' | 'warn' | 'error' | 'success', message: string): void {
    this.cycleLogger.log(level, message);
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
          `       [3m] close=$${last3m.close.toFixed(2)} @ ${new Date(last3m.timestamp).toLocaleTimeString()}`
        )
      );
    }
    if (last4h) {
      logs.push(
        chalk.gray(
          `       [4h] close=$${last4h.close.toFixed(2)} @ ${new Date(last4h.timestamp).toLocaleString()}`
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
          `       ticker: $${tickerPrice.toFixed(2)} @ ${new Date(tickerTimestamp ?? Date.now()).toLocaleTimeString()}`
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

    const getCachedPrice = async (symbol: string): Promise<number | undefined> => {
      const cached = tickerCache.get(symbol);
      if (cached) return cached.price;
      try {
        const t = await this.snapshotService.getTicker(symbol);
        const price = t.price ?? undefined;
        if (price !== undefined) tickerCache.set(symbol, { price, timestamp: Date.now() });
        return price;
      } catch {
        return undefined;
      }
    };

    const signalSummary = `🤖 Generated ${signals.length} signal${signals.length > 1 ? 's' : ''}:`;
    if (this.isBackgroundMode) {
      this.emitLog('info', signalSummary);
    }

    // Log to structured logger for file output (background mode only to avoid buffering delays)
    if (this.isBackgroundMode) {
      this.logger.info('AI Signal Generation', {
        signalCount: signals.length,
        signals: signals.map(s => ({
          coin: s.coin,
          action: s.action,
          confidence: s.confidence,
          reasoning: s.reasoning,
        })),
      });
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
      EventBus.emit('signal:buffer', {
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

    // Generate final report
    this.generateReport();
  }

  private async executeCycle(): Promise<void> {
    if (!this.state.isRunning) return;
    if (this.isCycleRunning) return; // prevent overlap
    this.isCycleRunning = true;
    try {
      this.state.cycleCount++;
      this.state.lastUpdate = Date.now();
      this.state.rejectedSignalsCycle = 0; // Reset per-cycle counter at start of each cycle

      // Guard: check if stopped mid-cycle
      if (!this.state.isRunning) {
        return;
      }

      // Emit cycle start event
      EventBus.emit('cycle:start', {
        cycleCount: this.state.cycleCount,
        timestamp: Date.now(),
        startTime: this.state.startTime,
      });

      // Display cycle header with emphasis
      this.emitLog('info', '');
      const cycleHeader = this.cycleDisplay.formatCycleHeader(this.state.cycleCount);
      this.emitLog('info', cycleHeader);

      this.emitLog('info', chalk.gray('⏳ Fetching account data...'));

      // 1. Get a consistent snapshot of account and positions
      const { account, positions } = await this.snapshotService.getSnapshot();

      // Set initial balance on first cycle (must happen early before any operations that might fail)
      // This ensures P&L calculations are correct even if the cycle fails later
      if (this.state.cycleCount === 1 && this.state.initialBalance === 0 && account.equity > 0) {
        this.state.initialBalance = account.equity;
        this.logger.info('Initial balance set for P&L tracking', {
          initialBalance: this.state.initialBalance,
          equity: account.equity,
        });
      }

      this.emitLog(
        'info',
        `💰 Account: $${account.equity.toFixed(2)} | Positions: ${positions.length}`
      );

      // 2. Monitor existing positions
      if (positions.length > 0) {
        await this.positionMonitor.monitorPositions(positions, this.exchange);
      }

      // Guard: check if stopped mid-cycle
      if (!this.state.isRunning) {
        return;
      }

      // 3. Get market data for all coins
      this.emitLog('info', chalk.gray('⏳ Fetching market data...'));
      const fetchStart = Date.now();
      const timeframes = this.config.marketTimeframes ?? ['3m', '4h'];

      // Per-cycle ticker cache to avoid redundant fetches
      const tickerCache = new Map<string, { price: number; timestamp: number }>();

      // Helper to get ticker price with caching
      const getTickerPrice = async (symbol: string): Promise<number> => {
        const cached = tickerCache.get(symbol);
        if (cached) {
          return cached.price;
        }
        try {
          const ticker = await this.snapshotService.getTicker(symbol);
          const price = ticker.price ?? 0;
          tickerCache.set(symbol, { price, timestamp: Date.now() });
          return price;
        } catch (error) {
          this.logger.debug(`Failed to fetch ticker for ${symbol}`, error);
          return 0;
        }
      };

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
        this.logger.warn('Cycle aborted due to insufficient market data', {
          cycleCount: this.state.cycleCount,
          successCount,
          failCount,
          coins: this.config.coins.length,
        });
        return; // Skip signal generation and execution
      }

      // 4. Generate AI signals
      this.emitLog('info', chalk.gray('⏳ Generating AI signals...'));
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

      const signals = await this.aiAgent.generateTradingSignal(
        allMarketData,
        account,
        positions,
        context
      );
      this.state.totalSignals += signals.length;

      // Emit signals generated event
      EventBus.emit('cycle:signals', {
        cycleCount: this.state.cycleCount,
        timestamp: Date.now(),
        signalCount: signals.length,
        signals: signals.map(s => ({ coin: s.coin, action: s.action, confidence: s.confidence })),
      });

      // 5. Process and display signals
      await this.processSignals(signals, tickerCache);

      // 6. Execute all signals
      const getCachedPrice = async (symbol: string): Promise<number | undefined> => {
        const cached = tickerCache.get(symbol);
        if (cached) return cached.price;
        try {
          const t = await this.snapshotService.getTicker(symbol);
          const price = t.price ?? undefined;
          if (price !== undefined) tickerCache.set(symbol, { price, timestamp: Date.now() });
          return price;
        } catch {
          return undefined;
        }
      };

      // Track trades before execution to compute per-cycle tradeCount delta
      const tradesBefore = this.state.totalTrades;
      // Use fresh positions array that gets updated after each signal execution
      // This ensures each signal sees the current state (positions opened by previous signals)
      let currentPositions = positions;
      let currentAccount = account;
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
          this.logger.warn('Signal execution skipped due to unavailable price', {
            coin: signal.coin,
            symbol,
            action: signal.action,
            price: currentPrice,
          });
          continue; // Skip this signal and continue with next
        }

        const result = await this.executeSignal(
          signal,
          currentAccount,
          currentPositions,
          tickerCache,
          currentPrice
        );

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
            this.logger.warn(
              'Failed to refresh positions after signal execution - aborting remaining signals',
              {
                coin: signal.coin,
                action: signal.action,
                error: error instanceof Error ? error.message : String(error),
              }
            );
            // If position refresh fails after executing a signal, abort remaining signals
            // to prevent stale state from causing duplicate positions or risk violations
            break; // Exit signal loop to prevent using stale positions
          }
        }
      }

      // Emit execution phase event
      EventBus.emit('cycle:execution', {
        cycleCount: this.state.cycleCount,
        timestamp: Date.now(),
        executedSignals: signals.filter(s => s.action !== 'HOLD').length,
        totalTrades: this.state.totalTrades,
      });

      // 5.5. Refresh account and positions after executing signals using a single snapshot
      const { account: updatedAccount, positions: updatedPositions } =
        await this.snapshotService.getSnapshot();

      // Aggregate once per cycle for reuse
      const aggregates = aggregatePositionMetrics(updatedPositions);

      // 6. Update performance metrics with latest data
      this.updatePerformanceMetrics(updatedAccount, aggregates);

      // 7. Log cycle summary with latest data
      const tradeCountCycle = this.state.totalTrades - tradesBefore;
      this.logCycleSummary(updatedAccount, updatedPositions, signals, aggregates, {
        rejectedSignalsCycle: this.state.rejectedSignalsCycle,
        tradeCountCycle,
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
      EventBus.emit('cycle:complete', {
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
    } catch (error) {
      this.emitLog('error', `Error in trading cycle: ${error}`);

      // Emit cycle error event
      EventBus.emit('cycle:error', {
        cycleCount: this.state.cycleCount,
        error: error instanceof Error ? error.message : String(error),
        timestamp: Date.now(),
      });
    } finally {
      this.isCycleRunning = false;
      // Chain next cycle if still running and not paused
      if (this.state.isRunning && !this.isPaused) {
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
    signal: TradingSignal,
    account: Account,
    positions: Position[],
    _tickerCache: Map<string, { price: number; timestamp: number }>,
    currentPrice: number
  ): Promise<{ success: boolean; order?: { id: string }; error?: string }> {
    try {
      const symbol = `${signal.coin}/USDT`;

      // Get position sizing info for detailed logging
      const sizing = this.riskManager.calculatePositionSizing(
        signal,
        account,
        positions,
        currentPrice
      );

      // Handle HOLD signals
      if (signal.action === 'HOLD') {
        const hasPosition = positions.some(p => p.symbol === `${signal.coin}/USDT`);
        this.emitLog(
          'info',
          hasPosition
            ? `⏸️  ${signal.coin}: HOLD - monitoring existing position`
            : `⏸️  ${signal.coin}: HOLD - no action`
        );
        return { success: true };
      }

      // Check if sizing calculation failed
      if (!sizing) {
        this.state.rejectedSignals++;
        this.state.rejectedSignalsCycle++;
        this.emitLog(
          'warn',
          `⚠️  ${signal.coin}: ${signal.action} signal rejected (risk limit or max positions reached)`
        );
        return { success: false, error: 'Position sizing calculation failed' };
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
        const actualPrice = result.order.price || currentPrice;

        // Guard: warn if execution price deviates significantly from current ticker (possible symbol mismatch)
        try {
          const ref = currentPrice;
          const relDiff = ref ? Math.abs(actualPrice - ref) / ref : 0;
          if (relDiff > 0.05) {
            this.logger.warn('Symbol/price mismatch suspected', {
              coin: signal.coin,
              symbol,
              executionPrice: actualPrice,
              tickerPrice: ref,
              relativeDiff: relDiff,
            });
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
          const estimatedPositionSize = sizing.suggestedSize * actualPrice;
          const estimatedMargin = estimatedPositionSize / leverage;

          const detailMsg = this.cycleDisplay.formatExecutionMessage({
            action: signal.action,
            coin: signal.coin,
            price: actualPrice,
            leverage,
            notional: estimatedPositionSize,
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

      // Return result for caller to know if positions should be refreshed
      return {
        success: result.success,
        order: result.order,
        error: result.error,
      };
    } catch (error) {
      this.emitLog('error', `Error executing signal for ${signal.coin}: ${error}`);
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
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
      this.logger.warn('Cannot calculate total P&L: initial balance not set', {
        cycleCount: this.state.cycleCount,
        equity: account.equity,
      });
    }

    // Calculate win rate from completed trades
    this.state.winRate = this.calculateWinRate();
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
        this.logger.warn('Equity calculation mismatch detected in cycle summary', {
          cycle: this.state.cycleCount,
          ...validation.equityCheck,
        });
        if (!this.isBackgroundMode) {
          const ec = validation.equityCheck;
          console.warn(
            chalk.yellow(
              `Equity mismatch → reported: $${ec.accountEquity?.toFixed?.(2)}, expected: $${ec.calculatedEquity?.toFixed?.(2)} | balance: $${ec.balance?.toFixed?.(2)}, unrealized: $${ec.unrealizedPnl?.toFixed?.(2)} | diff: $${ec.diff?.toFixed?.(2)}`
            )
          );
        }
      }
      if (validation.marginCheck && !validation.marginCheck.isValid) {
        this.logger.warn('Available margin calculation mismatch detected in cycle summary', {
          cycle: this.state.cycleCount,
          ...validation.marginCheck,
        });
        if (!this.isBackgroundMode) {
          const mc = validation.marginCheck;
          console.warn(
            chalk.yellow(
              `Available margin mismatch → reported: $${mc.accountAvailable?.toFixed?.(2)}, expected: $${mc.calculatedAvailable?.toFixed?.(2)} | equity: $${mc.equity?.toFixed?.(2)}, used: $${mc.usedMargin?.toFixed?.(2)} | diff: $${mc.diff?.toFixed?.(2)}`
            )
          );
        }
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
    runtimeSeconds: number
  ): void {
    if (!this.isBackgroundMode) return;

    this.logger.info('Cycle Summary', {
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
        unleveredExposure: aggregates.totalNotional,
        leverage: (aggregates.totalNotional / account.equity).toFixed(2),
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
    });
  }

  private logCycleSummary(
    account: Account,
    positions: Position[],
    signals: TradingSignal[],
    aggregates: PositionAggregates,
    cycleMetrics: { rejectedSignalsCycle: number; tradeCountCycle: number }
  ): void {
    const runtime = Date.now() - this.state.startTime;
    const runtimeMinutes = Math.floor(runtime / (1000 * 60));
    const runtimeSeconds = Math.floor((runtime / 1000) % 60);

    const totalMarginUsed = aggregates.totalMarginUsed;

    // Calculate P&L metrics
    const pnlMetrics = this.calculatePnLMetrics(account, aggregates);

    // Validate account consistency
    this.validateAccountConsistency(account, positions, totalMarginUsed);

    // Log structured summary for background mode
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
      runtimeMinutes,
      runtimeSeconds
    );

    // Console output with formatting (only if not background mode)
    if (!this.isBackgroundMode) {
      this.logConsoleCycleSummary(
        account,
        positions,
        signals,
        aggregates,
        pnlMetrics,
        cycleMetrics,
        runtimeMinutes,
        runtimeSeconds
      );
    }
  }

  /**
   * Log console cycle summary output
   */
  private logConsoleCycleSummary(
    account: Account,
    positions: Position[],
    signals: TradingSignal[],
    aggregates: PositionAggregates,
    pnlMetrics: {
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
    },
    cycleMetrics: { rejectedSignalsCycle: number; tradeCountCycle: number },
    runtimeMinutes: number,
    runtimeSeconds: number
  ): void {
    console.log(`\n📊 Cycle Summary:`);
    console.log(
      `   Runtime: ${runtimeMinutes}m ${runtimeSeconds}s | Total Cycles: ${this.state.cycleCount}`
    );

    // Signal efficiency
    const actionableSignalsCycle = cycleMetrics.rejectedSignalsCycle + cycleMetrics.tradeCountCycle;
    const cycleEfficiency =
      actionableSignalsCycle > 0
        ? ((cycleMetrics.tradeCountCycle / actionableSignalsCycle) * 100).toFixed(0)
        : '100';

    const totalActionableSignals = this.state.totalTrades + this.state.rejectedSignals;
    const cumulativeEfficiency =
      totalActionableSignals > 0
        ? ((this.state.totalTrades / totalActionableSignals) * 100).toFixed(0)
        : '100';

    const efficiencyColor =
      parseFloat(cumulativeEfficiency) >= 80
        ? chalk.green
        : parseFloat(cumulativeEfficiency) >= 50
          ? chalk.yellow
          : chalk.red;

    console.log(
      `   AI Signals: ${signals.length} | Executed: ${this.state.totalTrades} | Rejected (cycle: ${cycleMetrics.rejectedSignalsCycle}, total: ${this.state.rejectedSignals}) | Efficiency (cycle: ${cycleEfficiency}%, cumulative: ${efficiencyColor(cumulativeEfficiency + '%')})`
    );
    console.log(`   Open Positions: ${positions.length}/${this.config.maxPositions}`);

    // Account status
    this.logAccountStatus(account, aggregates, pnlMetrics);

    // Risk status
    this.logRiskStatus(account, positions, aggregates);

    // Positions display
    this.logPositions(positions);

    // Countdown
    this.logCycleCountdown();
  }

  /**
   * Log account status section
   */
  private logAccountStatus(
    account: Account,
    aggregates: PositionAggregates,
    pnlMetrics: {
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
    }
  ): void {
    console.log(chalk.magenta(`\n💰 Account Status:`));

    // Show equity with trend indicator
    let equityDisplay = `$${account.equity.toFixed(2)}`;
    if (this.state.cycleCount > 1 && this.state.previousEquity) {
      const trendArrow =
        pnlMetrics.cyclePnlChange > 0
          ? chalk.green('↑')
          : pnlMetrics.cyclePnlChange < 0
            ? chalk.red('↓')
            : chalk.gray('→');
      equityDisplay += ` ${trendArrow}`;
    }

    console.log(
      `   Equity: ${equityDisplay} | Available: $${account.availableMargin.toFixed(2)} | Used: $${aggregates.totalMarginUsed.toFixed(2)}`
    );

    // Guard against division by zero
    const leverage = account.equity > 0 ? aggregates.totalNotional / account.equity : 0;
    console.log(
      `   Unlevered Exposure: $${aggregates.totalNotional.toFixed(2)} | Leverage: ${leverage.toFixed(2)}x`
    );
    console.log(
      `   Total P&L: ${pnlMetrics.totalPnlColor(`$${pnlMetrics.totalPnl.toFixed(2)} (${pnlMetrics.totalPnlPercent.toFixed(2)}%)`)} | Unrealized: ${pnlMetrics.unrealizedPnlColor(`$${pnlMetrics.unrealizedPnl.toFixed(2)} (${pnlMetrics.unrealizedPnlPercent.toFixed(2)}%)`)} | Realized (cycle): $${pnlMetrics.realizedCyclePnl.toFixed(2)}`
    );

    // Cycle P&L change if applicable
    if (this.state.cycleCount > 1 && pnlMetrics.cyclePnlChange !== 0) {
      console.log(
        `   Cycle P&L: ${pnlMetrics.cyclePnlColor(`$${pnlMetrics.cyclePnlChange.toFixed(2)} (${pnlMetrics.cyclePnlPercent.toFixed(2)}%)`)}`
      );
    }
  }

  /**
   * Log risk status section
   */
  private logRiskStatus(
    account: Account,
    positions: Position[],
    aggregates: PositionAggregates
  ): void {
    console.log(chalk.magenta(`\n⚠️  Risk Status:`));

    const maxMarginLimit = this.config.riskParams.maxTotalRisk * 100; // Convert to percentage
    const marginUsage =
      positions.length > 0 ? (aggregates.totalMarginUsed / account.equity) * 100 : 0;

    // Get additional risk metrics from position monitor
    const positionSummary = this.positionMonitor.getPositionSummary(positions);
    const averageLeverage = positionSummary.averageLeverage.toFixed(2);
    // Override risk label using margin usage thresholds for consistency
    let riskLabel: 'LOW' | 'MEDIUM' | 'HIGH' = 'LOW';
    if (marginUsage >= 20) riskLabel = 'HIGH';
    else if (marginUsage >= 10) riskLabel = 'MEDIUM';
    const riskLevelColor =
      riskLabel === 'HIGH' ? chalk.red : riskLabel === 'MEDIUM' ? chalk.yellow : chalk.green;

    console.log(
      `   Margin Usage: ${marginUsage.toFixed(2)}% | Limit: ${maxMarginLimit.toFixed(0)}% | Positions: ${positions.length}/${this.config.maxPositions}`
    );

    if (positions.length > 0) {
      console.log(
        `   Risk Level: ${riskLevelColor(riskLabel)} (margin ${marginUsage.toFixed(2)}%) | Avg Leverage: ${averageLeverage}x`
      );

      // Display diversification metrics
      if (positions.length > 1) {
        const divScore = positionSummary.diversificationScore;
        const corrScore = positionSummary.correlationScore;
        const divColor = divScore > 0.7 ? chalk.green : divScore > 0.4 ? chalk.yellow : chalk.red;
        const corrColor =
          corrScore > 0.7 ? chalk.red : corrScore > 0.4 ? chalk.yellow : chalk.green;

        console.log(
          `   Diversification: ${divColor((divScore * 100).toFixed(0) + '%')} | Correlation: ${corrColor((corrScore * 100).toFixed(0) + '%')}`
        );
      }
    }
  }

  /**
   * Log positions table and details
   */
  private logPositions(positions: Position[]): void {
    if (positions.length === 0) {
      console.log(`\n   No open positions`);
      return;
    }

    // Display positions table
    console.log(`\n📊 Positions:`);
    console.log(`   ┌──────────┬──────┬──────────┬──────────────┬──────────────┬───────────────┐`);
    console.log(`   │ SIDE     │ COIN │ LEVERAGE │ MARGIN USED  │ ENTRY        │ UNREAL P&L    │`);
    console.log(`   ├──────────┼──────┼──────────┼──────────────┼──────────────┼───────────────┤`);

    positions.forEach(position => {
      const sideColor = position.side === 'long' ? chalk.green : chalk.red;
      const sideText = position.side === 'long' ? 'LONG' : 'SHORT';
      const leverageText = `${position.leverage}x`;
      const marginText = `$${position.marginUsed.toFixed(2)}`;
      const entryText = `$${position.entryPrice.toFixed(2)}`;
      const pnlColor = position.unrealizedPnl >= 0 ? chalk.green : chalk.red;
      // Calculate P&L percentage vs margin used (clearer risk basis)
      const entryValue = position.size * position.entryPrice;
      const impliedMargin = position.leverage ? entryValue / position.leverage : 0;
      const marginBasis = position.marginUsed || impliedMargin;
      const pnlPercent = marginBasis !== 0 ? (position.unrealizedPnl / marginBasis) * 100 : 0;
      const pnlText = `$${position.unrealizedPnl.toFixed(2)} (${pnlPercent.toFixed(1)}% vs margin)`;

      console.log(
        `   │ ${sideColor(sideText.padEnd(8))} │ ${position.symbol.replace('/USDT', '').padEnd(4)} │ ${chalk.cyan(leverageText.padEnd(8))} │ ${chalk.white(marginText.padEnd(13))} │ ${chalk.yellow(entryText.padEnd(13))} │ ${pnlColor(pnlText.padEnd(13))} │`
      );
    });
    console.log(`   └──────────┴──────┴──────────┴──────────────┴──────────────┴───────────────┘`);

    // Display individual position metrics
    console.log(chalk.gray(`\n   📊 Position Details:`));
    positions.forEach(position => {
      const holdingTime = Date.now() - position.timestamp;
      const hours = Math.floor(holdingTime / (1000 * 60 * 60));
      const minutes = Math.floor((holdingTime % (1000 * 60 * 60)) / (1000 * 60));
      const timeText = hours > 0 ? `${hours}h ${minutes}m` : `${minutes}m`;

      // Calculate stop loss and take profit levels
      const stopLoss = this.riskManager.calculateStopLoss(position, position.entryPrice);
      const takeProfit = this.riskManager.calculateTakeProfit(position, position.entryPrice);
      const stopLossPercent = Math.abs(
        ((stopLoss - position.entryPrice) / position.entryPrice) * 100
      );
      const takeProfitPercent = Math.abs(
        ((takeProfit - position.entryPrice) / position.entryPrice) * 100
      );
      const rrRatio = takeProfitPercent / stopLossPercent;

      console.log(
        chalk.gray(
          `      ${position.symbol.replace('/USDT', '')}: Holding ${timeText} | R/R ${rrRatio.toFixed(1)}x | SL: ${position.side === 'long' ? '-' : '+'}${stopLossPercent.toFixed(1)}% | TP: ${position.side === 'long' ? '+' : '-'}${takeProfitPercent.toFixed(1)}%`
        )
      );
    });

    // Win rate
    console.log(`\n   Win Rate: ${this.state.winRate.toFixed(1)}%`);
  }

  /**
   * Log cycle countdown
   */
  private logCycleCountdown(): void {
    const elapsed = Date.now() - this.state.lastUpdate;
    const remaining = Math.max(0, this.config.cyclePeriod - elapsed);
    const remainingSeconds = Math.floor(remaining / 1000);
    const minutes = Math.floor(remainingSeconds / 60);
    const seconds = remainingSeconds % 60;
    const countdownText = minutes > 0 ? `${minutes}m ${seconds}s` : `${remainingSeconds}s`;

    console.log(chalk.gray(`\n────────────────────────────────────────────────────────`));
    console.log(
      chalk.cyan(`⏱️  Next cycle in ${countdownText}`) + chalk.gray(` | Press Ctrl+C to stop`)
    );
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

    this.logger.info('Final Report', report);

    // Console output (only if not background mode)
    if (!this.isBackgroundMode) {
      console.log('\n📈 FINAL REPORT');
      console.log('='.repeat(50));
      console.log(`Runtime: ${runtimeMinutes} minutes`);
      console.log(`Cycles: ${this.state.cycleCount}`);
      console.log(`Total Signals: ${this.state.totalSignals}`);
      console.log(`Total Trades: ${this.state.totalTrades}`);
      console.log(`Total PnL: $${this.state.totalPnl.toFixed(2)}`);
      console.log(`Win Rate: ${this.state.winRate.toFixed(1)}%`);
      console.log('='.repeat(50));
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
    if (!this.nextTimeout && this.state.isRunning && !this.isCycleRunning) {
      this.nextTimeout = setTimeout(async () => {
        await this.executeCycle();
      }, this.config.cyclePeriod);
    }
  }

  updateConfig(newConfig: Partial<WorkflowConfig>): void {
    this.config = { ...this.config, ...newConfig };
    this.riskManager.updateRiskParams(newConfig.riskParams || {});
  }
}

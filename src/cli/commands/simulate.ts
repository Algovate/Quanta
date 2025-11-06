import { Command } from 'commander';
import chalk from 'chalk';
import ora from 'ora';
import { getConfig } from '../../config/settings.js';
import { SimulatorExchange } from '../../exchange/simulator.js';
import { MarketDataProvider } from '../../data/market.js';
import { MockAIAgent } from '../../ai/mock-agent.js';
import { OpenRouterClient } from '../../ai/agent.js';
import { RiskManager } from '../../execution/risk.js';
import { OrderExecutor } from '../../execution/orders.js';
import { PositionMonitorService } from '../../execution/monitor.js';
import { handleAsync } from '../../utils/error-handler.js';
import { safeAction } from '../shared/command-utils.js';
import { UnifiedLogger } from '../../logging/index.js';
import {
  validateCoins,
  validateAIType,
  validatePositiveNumber,
  validatePositiveInt,
} from '../shared/validation.js';

interface SimulateConfig {
  simulation: {
    enabled: boolean;
    defaultInitialBalance: number;
    defaultMaxPositions: number;
    defaultAI: string;
    autoRun: boolean;
    confirmBeforeExecute: boolean;
  };
  scenarios: {
    defaultCoins: string[];
    testScenarios: string[];
  };
  risk: {
    minConfidence: number;
    maxRiskPerTrade: number;
    maxTotalRisk: number;
    stopLoss: number;
    takeProfit: number;
  };
  logging: {
    verbose: boolean;
    logTrades: boolean;
    logPositions: boolean;
    logRiskMetrics: boolean;
    saveResults: boolean;
    resultsDir: string;
  };
  performance: {
    trackPnL: boolean;
    trackDrawdown: boolean;
    calculateSharpeRatio: boolean;
    benchmark: string;
  };
  ai: {
    mock: {
      signalInterval: number;
      confidenceRange: {
        min: number;
        max: number;
      };
    };
    real: {
      apiKey: string;
      model: string;
      temperature: number;
      maxRetries: number;
      timeout: number;
    };
  };
}

export class SimulateCommands {
  private static isRunning = false;

  private static loadSimulateConfig(): Partial<SimulateConfig> {
    try {
      const config = getConfig() as unknown as { simulation?: Partial<SimulateConfig> };
      return config.simulation ?? {};
    } catch {
      const logger = UnifiedLogger.getInstance();
      logger.warn(
        'Warning: Could not load simulation settings from config.json, using defaults',
        {},
        'SimulateCommands'
      );
      return {};
    }
  }

  static register(program: Command): void {
    program
      .command('cycle')
      .description(
        'Simulate a complete trade cycle (Perception → Decision → Execution → Monitoring)'
      )
      .option('-c, --coins <coins>', 'Comma-separated list of coins (e.g., BTC,ETH,SOL)', 'BTC')
      .option('-b, --initial-balance <amount>', 'Initial balance in USD', '10000')
      .option('-v, --verbose', 'Show detailed logging', false)
      .option('-p, --max-positions <number>', 'Maximum number of concurrent positions', '3')
      .option('--cycles <number>', 'Number of cycles to run', '1')
      .option('--interval <ms>', 'Delay between cycles in ms', '3000')
      .option('-a, --ai <type>', 'AI type: mock or real (requires API key in config.json)', 'mock')
      .action(
        safeAction(async options => {
          if (SimulateCommands.isRunning) {
            return;
          }
          SimulateCommands.isRunning = true;
          try {
            await handleAsync(async () => {
              await SimulateCommands.simulateCycle(options);
            }, 'SimulateCommands.cycle');
          } finally {
            SimulateCommands.isRunning = false;
          }
        }, 'SimulateCommands.cycle')
      );
  }

  private static async simulateCycle(options: {
    coins: string;
    initialBalance: string;
    verbose: boolean;
    maxPositions: string;
    ai: string;
    cycles?: string;
    interval?: string;
  }): Promise<void> {
    // Load simulation-specific configuration only
    const simulateConfig = SimulateCommands.loadSimulateConfig();

    // Parse and validate options with simulation config as base
    const coins = validateCoins(options.coins);
    const initialBalance = validatePositiveNumber(
      options.initialBalance,
      simulateConfig.simulation?.defaultInitialBalance || 10000
    );
    const verbose = options.verbose || simulateConfig.logging?.verbose || false;
    const maxPositions = validatePositiveInt(
      options.maxPositions,
      simulateConfig.simulation?.defaultMaxPositions || 6
    );

    // New: parse multi-cycle controls
    const cycles = Math.max(1, validatePositiveInt(options.cycles ?? '1', 1));
    const intervalMs = Math.max(0, validatePositiveInt(options.interval ?? '3000', 3000));

    // Validate AI type
    const useRealAI = validateAIType(options.ai) === 'real';

    const logger = UnifiedLogger.getInstance();
    const loggerContext = 'SimulateCommands';

    logger.info(chalk.cyan('🎯 Quanta - Multi-Coin Trade Cycle Simulation'), {}, loggerContext);
    logger.info(chalk.gray('='.repeat(60)), {}, loggerContext);
    logger.info(
      `Coins: ${coins.join(', ')} | Initial Balance: $${initialBalance.toLocaleString()}`,
      {},
      loggerContext
    );
    logger.info(`Max Positions: ${maxPositions}`, {}, loggerContext);
    logger.info(`AI Type: ${useRealAI ? 'Real AI (OpenRouter)' : 'Mock AI'}`, {}, loggerContext);
    if (useRealAI && simulateConfig.ai?.real?.model) {
      logger.info(`AI Model: ${simulateConfig.ai.real.model}`, {}, loggerContext);
    }
    logger.info(`Cycles: ${cycles} | Interval: ${intervalMs} ms`, {}, loggerContext);
    logger.info('', {}, loggerContext);

    const spinner = ora('Initializing simulation...').start();

    try {
      // Initialize components ONCE; state persists across cycles
      const exchange = new SimulatorExchange(initialBalance);
      const marketProvider = new MarketDataProvider(exchange);

      // Initialize AI agent based on selection
      let aiAgent;
      if (useRealAI) {
        // Try environment variable first, then simulation config
        const apiKey = process.env.OPENROUTER_API_KEY || simulateConfig.ai?.real?.apiKey;
        const model =
          process.env.OPENROUTER_MODEL ||
          process.env.AI_MODEL ||
          simulateConfig.ai?.real?.model ||
          'deepseek/deepseek-chat';
        const temperature = simulateConfig.ai?.real?.temperature || 0.7;
        const baseUrl = process.env.OPENROUTER_BASE_URL || undefined;
        if (!apiKey) {
          spinner.fail('Real AI requires OPENROUTER_API_KEY');
          logger.error('\n❌ Error: Real AI mode requires API key', undefined, loggerContext);
          logger.info('\n💡 To use real AI:', {}, loggerContext);
          logger.info('  1. Get API key from https://openrouter.ai', {}, loggerContext);
          logger.info('  2. Set environment variable or update config.json:', {}, loggerContext);
          logger.info('     export OPENROUTER_API_KEY="your_api_key_here"', {}, loggerContext);
          logger.info('     or edit config.json: simulation.ai.real.apiKey', {}, loggerContext);
          logger.info('  3. Or use Mock AI (default):', {}, loggerContext);
          logger.info('     quanta simulate cycle --coins BTC --ai mock', {}, loggerContext);
          process.exitCode = 1;
          return;
        }
        aiAgent = new OpenRouterClient(apiKey, model, temperature, undefined, baseUrl);
        logger.info(chalk.green('✓ Real AI initialized'), {}, loggerContext);
      } else {
        aiAgent = new MockAIAgent();
        logger.info(chalk.green('✓ Mock AI initialized'), {}, loggerContext);
      }

      const riskParams = {
        maxRiskPerTrade: simulateConfig.risk?.maxRiskPerTrade || 0.05,
        maxTotalRisk: simulateConfig.risk?.maxTotalRisk || 0.3,
        maxPositions: maxPositions,
        defaultStopLoss: simulateConfig.risk?.stopLoss || 0.03,
        maxLeverage: 1, // No leverage for simulations
        minLeverage: 1, // No leverage for simulations
      };

      const riskManager = new RiskManager(riskParams);
      const orderExecutor = new OrderExecutor(exchange, riskManager);
      const positionMonitor = new PositionMonitorService(riskManager, orderExecutor);

      spinner.succeed('Simulation initialized');

      let aggregatedExecutedOrders = 0;
      let finalAccountSnapshot: any = undefined;
      let finalOpenPositions = 0;
      let finalTotalPnl = 0;

      for (let i = 1; i <= cycles; i++) {
        logger.info(chalk.cyan(`\n===== Cycle ${i}/${cycles} =====`), {}, loggerContext);
        const result = await SimulateCommands.executeTradeCycle(
          exchange,
          marketProvider,
          aiAgent,
          orderExecutor,
          positionMonitor,
          coins,
          verbose,
          initialBalance,
          useRealAI,
          maxPositions,
          // Suppress per-cycle summaries; we will print a single aggregated one after all cycles
          false
        );

        aggregatedExecutedOrders += result.executedOrders;
        finalAccountSnapshot = result.finalAccount;
        finalOpenPositions = result.openPositions;
        finalTotalPnl = result.totalPnl;

        if (i < cycles) {
          await new Promise(resolve => setTimeout(resolve, intervalMs));
        }
      }

      // After all cycles, output one final aggregated summary (final account state)
      if (finalAccountSnapshot) {
        SimulateCommands.generateSummary(
          initialBalance,
          finalAccountSnapshot,
          aggregatedExecutedOrders,
          finalOpenPositions,
          finalTotalPnl,
          coins.length
        );
      }
    } catch (error) {
      spinner.fail('Simulation failed');

      const logger = UnifiedLogger.getInstance();
      const loggerContext = 'SimulateCommands';

      // Don't show duplicate error messages
      if (!(error instanceof Error && error.message.includes('OPENROUTER_API_KEY not found'))) {
        logger.error(
          '\n❌ Simulation Error:',
          error instanceof Error ? error : undefined,
          loggerContext
        );
        logger.error(
          `   ${error instanceof Error ? error.message : String(error)}`,
          error instanceof Error ? error : undefined,
          loggerContext
        );

        logger.info('\n💡 Common Issues:', {}, loggerContext);
        logger.info('  1. Check if all required parameters are valid', {}, loggerContext);
        logger.info('  2. Verify network connection (for market data)', {}, loggerContext);
        logger.info('  3. Check API credentials (for Real AI mode)', {}, loggerContext);
        logger.info('  4. Review verbose output with --verbose flag', {}, loggerContext);

        logger.info('\n📚 For help:', {}, loggerContext);
        logger.info('     quanta simulate cycle --help', {}, loggerContext);
      }

      throw error;
    }
  }

  private static async executeTradeCycle(
    exchange: SimulatorExchange,
    marketProvider: MarketDataProvider,
    aiAgent: any,
    orderExecutor: OrderExecutor,
    positionMonitor: PositionMonitorService,
    coins: string[],
    verbose: boolean,
    initialBalance: number,
    useRealAI: boolean,
    maxPositions: number,
    showSummary: boolean = true
  ): Promise<{
    executedOrders: number;
    finalAccount: any;
    openPositions: number;
    totalPnl: number;
  }> {
    const logger = UnifiedLogger.getInstance();
    const loggerContext = 'SimulateCommands';

    const cycleStartTime = Date.now();

    logger.info('\n📊 PHASE 1: PERCEPTION (Market Data Collection)', {}, loggerContext);
    logger.info('-'.repeat(60), {}, loggerContext);

    // Phase 1: Perception - Fetch market data for all coins
    const spinner1 = ora(`Fetching market data for ${coins.length} coin(s)...`).start();

    const allMarketData = [];
    for (const coin of coins) {
      const symbol = `${coin}/USDT`;
      const marketData = await marketProvider.getMarketData(symbol, ['3m', '4h']);
      allMarketData.push(...marketData);
    }

    if (allMarketData.length === 0) {
      spinner1.fail('Failed to fetch market data');
      logger.error('\n❌ Error: No market data available', undefined, loggerContext);
      logger.info('\n💡 Possible solutions:', {}, loggerContext);
      logger.info(`  1. Check network connection`, {}, loggerContext);
      logger.info(`  2. Verify coins are valid: ${coins.join(', ')}`, {}, loggerContext);
      logger.info(`  3. Try different coins: --coins BTC,ETH`, {}, loggerContext);
      throw new Error('No market data available');
    }

    spinner1.succeed(`Fetched ${allMarketData.length} dataset(s) for ${coins.length} coin(s)`);

    if (verbose) {
      // Group market data by coin for better display
      const marketDataByCoin = allMarketData.reduce(
        (acc, data) => {
          if (!acc[data.coin]) acc[data.coin] = [];
          acc[data.coin].push(data);
          return acc;
        },
        {} as Record<string, any[]>
      );

      Object.entries(marketDataByCoin).forEach(([coin, dataArray]) => {
        logger.info(chalk.gray(`\n  📈 ${coin} Analysis:`), {}, loggerContext);
        (dataArray as any[]).forEach(data => {
          logger.info(
            chalk.gray(`    ✓ ${data.timeframe}: ${data.candlesticks.length} candles`),
            {},
            loggerContext
          );
          logger.info(
            chalk.gray(`      - Current Price: $${data.currentPrice.toFixed(2)}`),
            {},
            loggerContext
          );
          logger.info(
            chalk.gray(`      - Trend: ${data.trend} | Volatility: ${data.volatility}`),
            {},
            loggerContext
          );
          logger.info(
            chalk.gray(
              `      - EMA20: $${data.indicators.ema20.toFixed(2)} | EMA50: $${data.indicators.ema50.toFixed(2)}`
            ),
            {},
            loggerContext
          );
          logger.info(
            chalk.gray(
              `      - MACD: ${data.indicators.macd.macd.toFixed(4)} | Signal: ${data.indicators.macd.signal.toFixed(4)}`
            ),
            {},
            loggerContext
          );
          logger.info(
            chalk.gray(
              `      - RSI(14): ${data.indicators.rsi14.toFixed(2)} | ATR(14): $${data.indicators.atr14.toFixed(2)}`
            ),
            {},
            loggerContext
          );
          if (data.indicators.bollinger) {
            const b = data.indicators.bollinger;
            logger.info(
              chalk.gray(
                `      - Bollinger: pos=${b.position} | %B=${b.percentB.toFixed(2)} | BW=${b.bandwidth.toFixed(3)}`
              ),
              {},
              loggerContext
            );
          }
          if (data.indicators.volume) {
            logger.info(
              chalk.gray(
                `      - Volume: SMA20=${data.indicators.volume.sma20.toFixed(0)} | Ratio=${data.indicators.volume.ratio.toFixed(2)}`
              ),
              {},
              loggerContext
            );
          }
          if (data.indicators.supportResistance) {
            const sr = data.indicators.supportResistance;
            const ds = sr.distToSupport != null ? (sr.distToSupport * 100).toFixed(2) + '%' : 'n/a';
            const dr =
              sr.distToResistance != null ? (sr.distToResistance * 100).toFixed(2) + '%' : 'n/a';
            logger.info(
              chalk.gray(
                `      - S/R: S=${sr.support ?? 'n/a'} | R=${sr.resistance ?? 'n/a'} | dS=${ds} | dR=${dr}`
              ),
              {},
              loggerContext
            );
          }
        });
      });
    }

    // Phase 2: Decision - AI Analysis
    logger.info('\n🤖 PHASE 2: DECISION (AI Analysis)', {}, loggerContext);
    logger.info('-'.repeat(60), {}, loggerContext);

    const spinner2 = ora('Analyzing market conditions for all coins...').start();

    const account = await exchange.getAccount();
    const positions = await exchange.getPositions();

    // Create context for AI
    const context = {
      startTime: cycleStartTime,
      currentTime: Date.now(),
      invokeCount: 1,
      tradableCoins: coins,
      maxPositions: maxPositions,
      maxRiskPerTrade: 0.05,
      maxLeverage: 1,
      minLeverage: 1,
      defaultStopLoss: 0.03,
    };

    let signals;
    try {
      signals = await aiAgent.generateTradingSignal(allMarketData, account, positions, context);
    } catch (error) {
      spinner2.fail('AI analysis failed');
      logger.error(
        '\n❌ Error: Failed to generate trading signals',
        error instanceof Error ? error : undefined,
        loggerContext
      );
      logger.error(
        `   ${error instanceof Error ? error.message : String(error)}`,
        error instanceof Error ? error : undefined,
        loggerContext
      );

      if (useRealAI) {
        logger.info('\n💡 Troubleshooting tips for Real AI:', {}, loggerContext);
        logger.info('  1. Verify OPENROUTER_API_KEY is set correctly', {}, loggerContext);
        logger.info('  2. Check API key is valid and has credits', {}, loggerContext);
        logger.info('  3. Review error message above for details', {}, loggerContext);
        logger.info('\n   Or use Mock AI instead:', {}, loggerContext);
        logger.info('     quanta simulate cycle --coins BTC --ai mock', {}, loggerContext);
      }
      throw error;
    }

    spinner2.succeed(`Generated ${signals.length} signal(s) across ${coins.length} coin(s)`);

    if (signals.length === 0) {
      logger.info('  No trading signals generated', {}, loggerContext);
    } else {
      // Group signals by coin for better display
      const signalsByCoin = signals.reduce(
        (acc, signal) => {
          if (!acc[signal.coin]) acc[signal.coin] = [];
          acc[signal.coin].push(signal);
          return acc;
        },
        {} as Record<string, any[]>
      );

      Object.entries(signalsByCoin).forEach(([coin, coinSignals]) => {
        logger.info(`\n  📊 ${coin} Signals:`, {}, loggerContext);
        (coinSignals as any[]).forEach(signal => {
          logger.info(`    ✓ ${signal.action} ${signal.coin}`, {}, loggerContext);
          if (verbose) {
            logger.info(
              `      - Confidence: ${(signal.confidence * 100).toFixed(1)}%`,
              {},
              loggerContext
            );
            if (signal.entry_price) {
              logger.info(
                `      - Entry Price: $${signal.entry_price.toFixed(2)}`,
                {},
                loggerContext
              );
            }
            if (signal.position_size) {
              logger.info(`      - Position Size: ${signal.position_size}`, {}, loggerContext);
            }
            if (signal.stop_loss) {
              logger.info(
                `      - Stop Loss: ${(signal.stop_loss * 100).toFixed(1)}%`,
                {},
                loggerContext
              );
            }
            if (signal.profit_target) {
              logger.info(
                `      - Take Profit: ${(signal.profit_target * 100).toFixed(1)}%`,
                {},
                loggerContext
              );
            }
            logger.info(`      - Reasoning: ${signal.reasoning}`, {}, loggerContext);
          }
        });
      });
    }

    // Phase 3: Execution - Risk Management & Order Placement
    logger.info('\n⚡ PHASE 3: EXECUTION (Risk Management & Order Placement)', {}, loggerContext);
    logger.info('-'.repeat(60), {}, loggerContext);

    let executedOrders = 0;
    let totalPnl = 0;

    for (const signal of signals) {
      if (signal.action === 'HOLD') {
        logger.info(`  ⏸️  HOLD signal for ${signal.coin} - no action taken`, {}, loggerContext);
        continue;
      }

      const spinner3 = ora(`Executing ${signal.action} signal for ${signal.coin}...`).start();

      try {
        const symbol = `${signal.coin}/USDT`;
        const ticker = await exchange.getTicker(symbol);
        const currentPrice = (ticker as { price: number }).price;

        // Refresh positions and account before each execution to get latest state
        const currentPositions = await exchange.getPositions();
        const currentAccount = await exchange.getAccount();

        const result = await orderExecutor.executeSignal(
          signal,
          currentAccount,
          currentPositions,
          currentPrice
        );

        if (result.success && result.order) {
          // Only count as executed if order is actually filled
          // Limit orders with status "open" should not be counted as executed
          if (result.order.status === 'filled') {
            spinner3.succeed(`${signal.action} order executed for ${signal.coin}`);
            executedOrders++;
          } else if (result.order.status === 'open') {
            // Limit order placed but not yet filled
            spinner3.warn(`${signal.action} order placed (pending) for ${signal.coin}`);
            // Don't increment executedOrders - order is not yet filled
          } else {
            spinner3.info(`${signal.action} order ${result.order.status} for ${signal.coin}`);
          }

          // Debug: Log positions after each order execution
          if (verbose) {
            const positionsAfterExecution = await exchange.getPositions();
            logger.info(`    - Order ID: ${result.order.id}`, {}, loggerContext);
            logger.info(`    - Amount: ${result.order.amount} ${signal.coin}`, {}, loggerContext);
            logger.info(`    - Price: $${result.order.price?.toFixed(2)}`, {}, loggerContext);
            logger.info(`    - Status: ${result.order.status}`, {}, loggerContext);
            if (result.order.status === 'open') {
              logger.info(
                `    - ⚠️  Order pending: limit order not yet filled (not counted as executed)`,
                {},
                loggerContext
              );
            }
            logger.info(
              `    - Positions after order: ${positionsAfterExecution.length} open`,
              {},
              loggerContext
            );
          }
        } else {
          spinner3.fail(`Failed to execute ${signal.action} signal for ${signal.coin}`);
          if (verbose && result.error) {
            logger.error(`    - Error: ${result.error}`, undefined, loggerContext);
            // Log additional debugging info for position sizing failures
            if (result.error.includes('Position sizing calculation failed')) {
              const currentPositionsAfterFailure = await exchange.getPositions();
              const accountAfterFailure = await exchange.getAccount();
              const marginUsageRatio =
                accountAfterFailure.equity > 0
                  ? (accountAfterFailure.usedMargin / accountAfterFailure.equity) * 100
                  : 0;
              const maxTotalRisk = 30; // Default from config
              logger.info(
                `    - [DEBUG] Positions: ${currentPositionsAfterFailure.length}/${maxPositions}, ` +
                  `Available Margin: $${accountAfterFailure.availableMargin.toFixed(2)}, ` +
                  `Used Margin: $${accountAfterFailure.usedMargin.toFixed(2)} ` +
                  `(${marginUsageRatio.toFixed(2)}%), ` +
                  `Equity: $${accountAfterFailure.equity.toFixed(2)}`,
                {},
                loggerContext
              );
              if (marginUsageRatio >= maxTotalRisk) {
                logger.info(
                  `    - [REASON] Margin limit reached: ${marginUsageRatio.toFixed(2)}% >= ${maxTotalRisk}%`,
                  {},
                  loggerContext
                );
              } else if (currentPositionsAfterFailure.length >= maxPositions) {
                logger.info(
                  `    - [REASON] Max positions reached: ${currentPositionsAfterFailure.length} >= ${maxPositions}`,
                  {},
                  loggerContext
                );
              }
            }
          }
        }
      } catch (error) {
        spinner3.fail(`Error executing signal for ${signal.coin}: ${error}`);
      }
    }

    // Debug: Log all positions after execution phase
    if (verbose) {
      const positionsAfterExecution = await exchange.getPositions();
      logger.info(
        `\n  [DEBUG] Positions after execution phase: ${positionsAfterExecution.length} open`,
        {},
        loggerContext
      );
      positionsAfterExecution.forEach(pos => {
        logger.info(
          `    - ${pos.side.toUpperCase()} ${pos.symbol}: ${pos.size} @ $${pos.entryPrice.toFixed(2)}`,
          {},
          loggerContext
        );
      });
    }

    // Flush logger buffer to show any warnings from order execution inline
    // This ensures warnings about stale entry prices appear immediately
    // instead of at the end when process exits
    // flushSync is no longer needed with UnifiedLogger (async storage)

    // Phase 4: Monitoring - Position Management
    logger.info('\n🔍 PHASE 4: MONITORING (Position Management)', {}, loggerContext);
    logger.info('-'.repeat(60), {}, loggerContext);

    const spinner4 = ora('Monitoring all positions...').start();

    // Get updated positions
    const updatedPositions = await exchange.getPositions();
    await exchange.getAccount();

    // Debug: Log positions before monitoring
    if (verbose) {
      logger.info(
        `\n  [DEBUG] Positions before monitoring: ${updatedPositions.length} open`,
        {},
        loggerContext
      );
      updatedPositions.forEach(pos => {
        logger.info(
          `    - ${pos.side.toUpperCase()} ${pos.symbol}: ${pos.size} @ $${pos.entryPrice.toFixed(2)} (P&L: $${pos.unrealizedPnl.toFixed(2)})`,
          {},
          loggerContext
        );
      });
    }

    if (updatedPositions.length > 0) {
      spinner4.succeed(
        `Monitoring ${updatedPositions.length} position(s) across ${coins.length} coin(s)`
      );

      // Simulate price movement for all coins
      logger.info('  ✓ Simulating market movements...', {}, loggerContext);
      for (const coin of coins) {
        const symbol = `${coin}/USDT`;
        await SimulateCommands.simulatePriceMovement(exchange, symbol);
      }

      // Refresh marks using latest simulated prices before monitoring
      // Trigger a positions refresh to recompute markPrice/unrealizedPnl
      await exchange.getPositions();

      // Check positions (may close positions if stop loss/take profit triggered)
      await positionMonitor.monitorPositions(updatedPositions, exchange);

      // Debug: Log positions after monitoring
      if (verbose) {
        const positionsAfterMonitoring = await exchange.getPositions();
        logger.info(
          `\n  [DEBUG] Positions after monitoring: ${positionsAfterMonitoring.length} open`,
          {},
          loggerContext
        );
        positionsAfterMonitoring.forEach(pos => {
          logger.info(
            `    - ${pos.side.toUpperCase()} ${pos.symbol}: ${pos.size} @ $${pos.entryPrice.toFixed(2)} (P&L: $${pos.unrealizedPnl.toFixed(2)})`,
            {},
            loggerContext
          );
        });
      }
    } else {
      spinner4.succeed('No positions to monitor');
    }

    // Get final positions and portfolio metrics
    // Ensure marks are fresh prior to final reporting
    await exchange.getPositions();
    const finalPositions = await exchange.getPositions();
    const finalAccount = await exchange.getAccount();
    const portfolioMetrics = await exchange.getPortfolioMetrics();

    totalPnl = finalAccount.equity - initialBalance;

    // Debug: Always show position details if verbose, or if there's a concern
    // Note: positions count != executed orders is normal (orders can combine or close positions)
    if (verbose && finalPositions.length > 0) {
      logger.info(
        `\n  [DEBUG] Final positions detail: ${finalPositions.length} position(s)`,
        {},
        loggerContext
      );
      finalPositions.forEach(pos => {
        const calcNotional = pos.size * pos.markPrice * pos.leverage;
        const notionalMatch = Math.abs(calcNotional - pos.notional) < 0.01;
        logger.info(
          `    - ${pos.side.toUpperCase()} ${pos.symbol}: size=${pos.size.toFixed(8)}, entry=$${pos.entryPrice.toFixed(2)}, mark=$${pos.markPrice.toFixed(2)}, notional=$${pos.notional.toFixed(2)} (calc: $${calcNotional.toFixed(2)}${notionalMatch ? '' : ' ⚠️ MISMATCH'})`,
          {},
          loggerContext
        );
      });
    }

    if (finalPositions.length > 0 && verbose) {
      logger.info('\n  📊 Portfolio Overview:', {}, loggerContext);
      logger.info(
        `    - Total Exposure: $${portfolioMetrics.totalExposure.toFixed(2)}`,
        {},
        loggerContext
      );
      logger.info(
        `    - Total Leverage: ${portfolioMetrics.leverage.toFixed(2)}x`,
        {},
        loggerContext
      );
      logger.info(
        `    - Total Unrealized P&L: $${portfolioMetrics.totalUnrealizedPnl.toFixed(2)}`,
        {},
        loggerContext
      );

      logger.info('\n  📊 Position Details by Symbol:', {}, loggerContext);
      Object.entries(portfolioMetrics.exposureBySymbol).forEach(([symbol, exposure]) => {
        const pnl = portfolioMetrics.pnlBySymbol[symbol] || 0;
        // Calculate P&L percentage as ROI on invested capital (exposure)
        // For accurate ROI: P&L / exposure * 100
        const pnlPercent = exposure > 0 ? (pnl / exposure) * 100 : 0;
        logger.info(`    📈 ${symbol}:`, {}, loggerContext);
        logger.info(`      - Exposure: $${exposure.toFixed(2)}`, {}, loggerContext);
        logger.info(
          `      - P&L: $${pnl.toFixed(2)} (${pnlPercent.toFixed(2)}% ROI)`,
          {},
          loggerContext
        );
      });

      logger.info('\n  📊 Individual Positions:', {}, loggerContext);

      // Header
      logger.info(
        '\n    │ SIDE     │ COIN │ LEVERAGE │ NOTIONAL    │ UNREAL P&L',
        {},
        loggerContext
      );
      logger.info(
        '    ├──────────┼──────┼──────────┼──────────────┼────────────',
        {},
        loggerContext
      );

      // Position rows
      finalPositions.forEach(position => {
        const sideColor = position.side === 'long' ? chalk.green : chalk.red;
        const sideText = position.side === 'long' ? 'LONG' : 'SHORT';
        const leverageText = `${position.leverage}X`;
        const notionalText = `$${position.notional.toFixed(2)}`;
        const pnlColor = position.unrealizedPnl >= 0 ? chalk.green : chalk.red;
        const pnlText = `$${position.unrealizedPnl.toFixed(2)}`;

        logger.info(
          `    │ ${sideColor(sideText.padEnd(8))} │ ${position.symbol.replace('/USDT', '').padEnd(4)} │ ${chalk.cyan(leverageText.padEnd(8))} │ ${chalk.cyan(notionalText.padEnd(13))} │ ${pnlColor(pnlText.padEnd(11))}`,
          {},
          loggerContext
        );
      });
    }

    // Generate per-cycle summary only if requested
    if (showSummary) {
      SimulateCommands.generateSummary(
        initialBalance,
        finalAccount,
        executedOrders,
        finalPositions.length,
        totalPnl,
        coins.length
      );
    }

    return {
      executedOrders,
      finalAccount,
      openPositions: finalPositions.length,
      totalPnl,
    };
  }

  private static async simulatePriceMovement(
    exchange: SimulatorExchange,
    symbol: string
  ): Promise<void> {
    const logger = UnifiedLogger.getInstance();
    const loggerContext = 'SimulateCommands';

    // This is a simple simulation - in a real scenario, you'd get live price updates
    logger.info('  ✓ Simulating market movement...', {}, loggerContext);

    // Add a small random price movement for demonstration
    const ticker = await exchange.getTicker(symbol);
    const currentPrice = (ticker as { price: number }).price;
    const movement = (Math.random() - 0.5) * 0.02; // ±1% movement
    const newPrice = currentPrice * (1 + movement);

    logger.info(
      `  ✓ Price movement: $${currentPrice.toFixed(2)} → $${newPrice.toFixed(2)} (${(movement * 100).toFixed(2)}%)`,
      {},
      loggerContext
    );

    // Persist the simulated move into the simulator's market data so subsequent
    // mark/P&L refreshes use the updated price. We update the 3m timeframe.
    try {
      const timeframe = '3m';
      const candles = await exchange.getCandlesticks(symbol, timeframe, 100);
      const last = candles[candles.length - 1];
      const nextTimestamp = last ? last.timestamp + 3 * 60 * 1000 : Date.now();
      const open = last ? last.close : currentPrice;
      const close = newPrice;
      const high = Math.max(open, close) * (1 + Math.random() * 0.001);
      const low = Math.min(open, close) * (1 - Math.random() * 0.001);
      const volume = Math.random() * 1000;

      const updated = candles.slice(-99); // keep last 99 and append new
      updated.push({ timestamp: nextTimestamp, open, high, low, close, volume });
      exchange.updateMarketData(symbol, timeframe, updated);
    } catch {
      // Non-critical: if market data update fails, continue without persisting
    }
  }

  private static generateSummary(
    initialBalance: number,
    finalAccount: any,
    executedOrders: number,
    openPositions: number,
    totalPnl: number,
    coinsAnalyzed: number
  ): void {
    const logger = UnifiedLogger.getInstance();
    const loggerContext = 'SimulateCommands';

    logger.info('\n📈 PORTFOLIO SUMMARY', {}, loggerContext);
    logger.info('='.repeat(60), {}, loggerContext);

    const pnlPercent = (totalPnl / initialBalance) * 100;
    const pnlColor = totalPnl >= 0 ? chalk.green : chalk.red;
    const pnlSign = totalPnl >= 0 ? '+' : '';

    // Available cash is the available margin (free to use)
    const availableCash = finalAccount.availableMargin || 0;

    logger.info(`TOTAL ACCOUNT VALUE: $${finalAccount.equity.toFixed(2)}`, {}, loggerContext);
    logger.info(`Initial Balance:    $${initialBalance.toLocaleString()}`, {}, loggerContext);
    logger.info(`Available Cash:    $${availableCash.toFixed(2)}`, {}, loggerContext);
    logger.info(
      `Total P&L:          ${pnlColor(`${pnlSign}$${totalPnl.toFixed(2)} (${pnlSign}${pnlPercent.toFixed(2)}%)`)}`,
      {},
      loggerContext
    );
    logger.info(`Coins Analyzed:     ${coinsAnalyzed}`, {}, loggerContext);
    logger.info(`Orders Executed:    ${executedOrders}`, {}, loggerContext);
    logger.info(`Open Positions:     ${openPositions}`, {}, loggerContext);
    logger.info(
      `Risk Level:         ${SimulateCommands.getRiskLevel(Math.abs(pnlPercent))}`,
      {},
      loggerContext
    );

    logger.info('\n' + '='.repeat(60), {}, loggerContext);
    logger.info(
      '✅ Multi-coin multi-position simulation completed successfully!',
      {},
      loggerContext
    );

    // Final flush of logger buffer to ensure all warnings/logs are shown
    // This catches any warnings that occurred during the simulation
    // flushSync is no longer needed with UnifiedLogger (async storage)
  }

  private static getRiskLevel(pnlPercent: number): string {
    if (pnlPercent < 1) return chalk.green('LOW');
    if (pnlPercent < 3) return chalk.yellow('MEDIUM');
    return chalk.red('HIGH');
  }
}

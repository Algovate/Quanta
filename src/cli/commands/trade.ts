import { Command } from 'commander';
import chalk from 'chalk';
import ora from 'ora';
import { getConfig } from '../../config/settings.js';
import { SimulatorExchange } from '../../exchange/index.js';
import { PaperExchange } from '../../exchange/paper.js';
import { MarketDataProvider } from '../../data/index.js';
import { OpenRouterClient } from '../../ai/index.js';
import { TradingWorkflow } from '../../core/index.js';
import { handleAsync } from '../../utils/index.js';
import { formatExchangeFriendlyName } from '../utils.js';
import { UnifiedLogger } from '../../logging/index.js';
import { checkSessionConflict } from '../shared/session-guard.js';
import { validateEnv, validateCoins } from '../shared/validation.js';
import type { Config } from '../../config/settings.js';
import type { WorkflowConfig } from '../../types/index.js';
import type { Exchange } from '../../exchange/types.js';

export class TradeCommands {
  /**
   * Exchange type mapping
   */
  private static readonly EXCHANGE_MAP: Record<string, string> = {
    okx: 'okx',
    binance: 'binance',
    bin: 'binance',
    coinbase: 'coinbase',
    cb: 'coinbase',
    hyperliquid: 'hyperliquid',
    hliq: 'hyperliquid',
    simulator: 'simulator',
  };

  /**
   * Create an exchange instance based on configuration
   */
  private static async createExchange(
    exchangeName: string,
    apiKey?: string,
    apiSecret?: string,
    testnet: boolean = true,
    _mode: 'simulation' | 'live' = 'simulation'
  ) {
    const normalizedName = this.EXCHANGE_MAP[exchangeName.toLowerCase()];

    if (!normalizedName) {
      throw new Error(`Unsupported exchange: ${exchangeName}`);
    }

    // Handle simulator
    if (normalizedName === 'simulator') {
      return new SimulatorExchange(10000);
    }

    // Dynamically import and create real exchange
    const module = await import(`../../exchange/${normalizedName}.js`);
    const ExchangeClass = Object.values(module)[0] as new (
      apiKey?: string,
      apiSecret?: string,
      testnet?: boolean
    ) => unknown;
    return new ExchangeClass(apiKey, apiSecret, testnet) as unknown;
  }

  /**
   * Build a workflow configuration from loaded settings and selected coins.
   * Keeps the startTrading path concise and improves readability.
   */
  private static buildWorkflowConfig(config: Config, coins: string[]): WorkflowConfig {
    return {
      coins,
      cyclePeriod: config.trading.cyclePeriod,
      maxPositions: config.trading.maxPositions,
      marketFetchParallel: (config as any)?.trading?.marketFetchParallel,
      riskParams: {
        maxRiskPerTrade: config.trading.maxRisk,
        maxTotalRisk: 0.3,
        defaultStopLoss: config.trading.stopLoss,
        maxLeverage: config.trading.leverageRange[1],
        minLeverage: config.trading.leverageRange[0],
        maxPositions: config.trading.maxPositions,
      },
    };
  }

  /**
   * Print effective exchange name with UnifiedLogger
   */
  private static printEffectiveExchangeWithLogger(
    logger: UnifiedLogger,
    exchange: unknown,
    testnet: boolean
  ): void {
    try {
      const reported = (exchange as { getExchangeName?: () => string })?.getExchangeName?.();
      const friendly = formatExchangeFriendlyName(reported, testnet) || 'unknown';
      logger.info(`   Exchange: ${friendly}`, {}, 'TradeStart');
    } catch {
      // best-effort display only
    }
  }

  /**
   * Helper to format error messages with consistent styling
   */
  private static formatError(title: string, issue: string, solution: string, tip?: string): string {
    let message = chalk.red(`❌ ${title}`) + chalk.white('\n\n');
    message += chalk.yellow('📝 Issue:') + chalk.gray(` ${issue}\n`);
    message += chalk.white('\n');
    message += chalk.yellow('🔧 Solution:') + chalk.white(` ${solution}`);
    if (tip) {
      message += chalk.white('\n\n') + chalk.yellow('💡 Tip:') + chalk.gray(` ${tip}`);
    }
    return message;
  }

  /**
   * Display trading mode configuration with UnifiedLogger
   */
  private static displayModeConfigurationWithLogger(
    logger: UnifiedLogger,
    mode: string,
    exchangeName: string,
    exchangeTestnet: boolean,
    exchangeApiKey?: string,
    exchangeApiSecret?: string,
    marketType?: string
  ): void {
    logger.info(chalk.blue('📊 Configuration:'), {}, 'TradeStart');
    logger.info(`   Mode: ${mode}`, {}, 'TradeStart');

    if (mode === 'simulation') {
      logger.info(`   Data Source: mock data (simulator only)`, {}, 'TradeStart');
      logger.info(
        chalk.gray(`   Note: Config exchange '${exchangeName}' ignored in simulation mode`),
        {},
        'TradeStart'
      );
    } else if (mode === 'paper') {
      // Data Source and Network are summarized below as a single consolidated Exchange line
      if (!exchangeApiKey || !exchangeApiSecret) {
        logger.info(
          chalk.yellow(`   Note: Running without API keys (public data only, rate limited)`),
          {},
          'TradeStart'
        );
      }
    } else if (mode === 'live') {
      const exchangeStatus = exchangeName !== 'simulator' ? 'real' : 'simulator';
      const networkStatus = exchangeTestnet ? 'testnet' : 'production';
      logger.info(`   Exchange: ${exchangeName} (${exchangeStatus})`, {}, 'TradeStart');
      if (exchangeName !== 'simulator') {
        logger.info(`   Network: ${networkStatus}`, {}, 'TradeStart');
      }
    }
    if (marketType) {
      logger.info(`   Market Type: ${marketType}`, {}, 'TradeStart');
    }
  }

  /**
   * Validate and get final exchange instance for the trading mode
   */
  private static async getExchangeForMode(
    mode: 'simulation' | 'paper' | 'live',
    exchangeName: string,
    apiKey?: string,
    apiSecret?: string,
    testnet: boolean = true
  ): Promise<Exchange> {
    const originalConsole = UnifiedLogger.getInstance().getOriginalConsole();
    if (mode === 'simulation') {
      // Pure mock data simulator
      originalConsole.log('📊 Simulation mode: Using pure mock data (no real exchange data)');
      return new SimulatorExchange(10000);
    } else if (mode === 'paper') {
      // Paper trading: real data with simulated execution
      if (exchangeName === 'simulator') {
        throw new Error(
          'Paper trading mode requires a real exchange data source (okx, binance, coinbase, etc.). ' +
            'Update config.json exchange.name to use a real exchange.'
        );
      }
      // Remove duplicate message - configuration already displayed above
      const dataExchange = await this.createExchange(exchangeName, apiKey, apiSecret, testnet);
      // Wrap the real exchange with PaperExchange to simulate execution while using real market data
      return new PaperExchange(dataExchange as any, 10000);
    } else {
      // Live mode - real exchanges
      if (exchangeName === 'simulator') {
        throw new Error(
          'Cannot use simulator exchange in live mode. Please use a real exchange (okx, binance, coinbase, etc.)'
        );
      }
      return (await this.createExchange(
        exchangeName,
        apiKey,
        apiSecret,
        testnet,
        'live'
      )) as Exchange;
    }
  }

  static register(program: Command): void {
    program
      .command('start')
      .description('Start AI trading system')
      .option('-e, --env <env>', 'Environment: live, paper, simulate')
      .option('-c, --coins <coins>', 'Comma-separated list of coins (overrides config)')
      .action(async options => {
        await handleAsync(async () => {
          await TradeCommands.startTrading(options);
        }, 'TradeCommands.start');
      });

    program
      .command('backtest')
      .description('Run backtest with historical data')
      .option('-c, --coins <coins>', 'Comma-separated list of coins (overrides config)')
      .option('-s, --start <date>', 'Start date (YYYY-MM-DD)')
      .option('-e, --end <date>', 'End date (YYYY-MM-DD)')
      .option('--initial-balance <amount>', 'Initial balance', '10000')
      .option('--seed <number>', 'Deterministic seed', '')
      .option('--verbose', 'Verbose output (per-signal details)', false)
      .option('--quiet', 'Minimal output', false)
      .option('--json', 'JSON summary output', false)
      .option('--no-progress', 'Disable progress bar', false)
      .option('--update-interval <ms>', 'Progress update interval (ms)', '750')
      .option('--cycle-sample <n>', 'Print every N cycles (noise control)', '10')
      .option('--summary-only', 'Show only executive summary line', false)
      .option('--no-risks', 'Hide Risk Metrics section', false)
      .option('--no-signals', 'Hide Signal Statistics section', false)
      .option('--no-equity', 'Hide Equity Curve section', false)
      .option(
        '--equity-delta-pct <p>',
        'Print when equity changes by >= p (e.g., 0.001 = 0.1%)',
        '0.001'
      )
      .option('--upnl-delta <usd>', 'Print when UPNL changes by >= USD', '10')
      .option('--exposure-delta-pct <p>', 'Print when exposure changes by >= p', '0.1')
      .option('--leverage-delta <x>', 'Print when leverage changes by >= x', '0.2')
      .option('--dd-steps <list>', 'Drawdown alert steps (comma, e.g., 5,10,15)', '')
      .action(async options => {
        await handleAsync(async () => {
          await TradeCommands.runBacktest(options);
        }, 'TradeCommands.backtest');
      });

    program
      .command('status')
      .description('Show current trading status')
      .action(async () => {
        await handleAsync(async () => {
          await TradeCommands.showStatus();
        }, 'TradeCommands.status');
      });

    program
      .command('pause')
      .description('Temporarily pause the trading system')
      .option('--reason <reason>', 'Reason for pausing', 'Manual pause')
      .action(async options => {
        await handleAsync(async () => {
          await TradeCommands.pauseTrading(options);
        }, 'TradeCommands.pause');
      });

    program
      .command('stop')
      .description('Stop the running trading system')
      .option('--graceful', 'Graceful shutdown (finish current trades)', false)
      .option('--force', 'Force immediate stop', false)
      .action(async options => {
        await handleAsync(async () => {
          await TradeCommands.stopTrading(options);
        }, 'TradeCommands.stop');
      });
  }

  private static async startTrading(options: { env?: string; coins?: string }): Promise<void> {
    // Get config and resolve environment
    const config = getConfig();
    // Trade start only supports strategy mode (use 'arena start' for multi-drone arena)
    const runtimeMode = 'strategy' as const;

    // Validate and parse environment
    const env = validateEnv(options.env || config.env || 'simulate');

    // Validate and parse coins
    const coins = options.coins ? validateCoins(options.coins) : config.trading.coins;

    // Session guard: check for active execution sessions
    await checkSessionConflict();

    const configUpdates = {
      mode: runtimeMode,
      env,
      trading: { coins },
    };

    const updatedConfig = { ...config, ...configUpdates };

    // Initialize UnifiedLogger for detailed logging
    const unifiedLogger = UnifiedLogger.getInstance();
    unifiedLogger.initialize();

    // Get original console to bypass interception for minimal output
    const originalConsole = unifiedLogger.getOriginalConsole();

    // Console: Minimal essential info only (use originalConsole to avoid interception)
    originalConsole.log(chalk.cyan('🏆 Quanta Trading System\n'));
    originalConsole.log(chalk.gray(`Env: ${env} | Coins: ${coins.join(', ')}\n`));

    const exchangeName = updatedConfig.exchange?.name || 'simulator';
    const exchangeTestnet = updatedConfig.exchange?.testnet ?? true;
    const exchangeApiKey = updatedConfig.exchange?.apiKey;
    const exchangeApiSecret = updatedConfig.exchange?.apiSecret;
    const marketType = updatedConfig.exchange?.marketType;

    // UnifiedLogger: Full detailed output
    unifiedLogger.info(chalk.cyan('🏆 Quanta Trading System'), {}, 'TradeStart');
    unifiedLogger.info(
      chalk.gray('AI-powered quantitative trading with real-time decision making\n'),
      {},
      'TradeStart'
    );

    // UnifiedLogger: Log configuration details
    this.displayModeConfigurationWithLogger(
      unifiedLogger,
      env,
      exchangeName,
      exchangeTestnet,
      exchangeApiKey,
      exchangeApiSecret,
      marketType
    );

    // Validate prerequisites based on mode
    this.validateModeConfiguration(env, exchangeName, exchangeApiKey, exchangeApiSecret);
    this.validateAIConfiguration(updatedConfig.ai?.apiKey);

    // Initialize components and construct exchange only once
    const spinner = ora('Initializing trading system...').start();
    unifiedLogger.info('Initializing trading system...', {}, 'TradeStart');
    const exchange = await this.getExchangeForMode(
      env as 'simulation' | 'paper' | 'live',
      exchangeName,
      exchangeApiKey,
      exchangeApiSecret,
      updatedConfig.exchange?.testnet ?? true
    );

    // UnifiedLogger: Display effective exchange implementation
    this.printEffectiveExchangeWithLogger(unifiedLogger, exchange, exchangeTestnet);

    // UnifiedLogger: Log configuration details
    unifiedLogger.info(`   Coins: ${coins.join(', ')}`, {}, 'TradeStart');
    const mt = (config.exchange?.marketType || 'spot').toLowerCase();
    unifiedLogger.info(
      chalk.gray(
        `   MarketType: ${mt || 'spot'} | Effective risk → lev: ${config.trading.leverageRange[0]}-${config.trading.leverageRange[1]}x, SL: ${(config.trading.stopLoss * 100).toFixed(1)}%, risk/trade: ${(config.trading.maxRisk * 100).toFixed(1)}%, maxPos: ${config.trading.maxPositions}`
      ),
      {},
      'TradeStart'
    );
    unifiedLogger.info('', {}, 'TradeStart');

    const marketProvider = new MarketDataProvider(exchange);
    const aiClient = new OpenRouterClient(updatedConfig.ai.apiKey);
    const workflowConfig = this.buildWorkflowConfig(config, coins);
    const workflow = new TradingWorkflow(exchange, marketProvider, aiClient, workflowConfig);

    spinner.succeed('Trading system initialized');

    // Console: Minimal status (use originalConsole to avoid interception)
    originalConsole.log(
      chalk.green('🚀 Trading started. Use "quanta log view" to view detailed output.\n')
    );

    // UnifiedLogger: Full startup message
    unifiedLogger.info(chalk.green('🚀 Starting trading workflow...'), {}, 'TradeStart');
    unifiedLogger.info(chalk.gray('Press Ctrl+C to stop\n'), {}, 'TradeStart');

    // Set up signal handlers for graceful shutdown
    let isShuttingDown = false;
    const shutdownHandler = async (signal: string) => {
      if (isShuttingDown) {
        // Force exit if already shutting down
        process.exit(1);
        return;
      }
      isShuttingDown = true;

      originalConsole.log(chalk.yellow(`\n⏹  Shutting down trading system (${signal})...`));
      unifiedLogger.info(
        chalk.yellow(`Shutting down trading system (${signal})...`),
        {},
        'TradeStart'
      );

      try {
        await workflow.stop();
        unifiedLogger.shutdown();
        originalConsole.log(chalk.green('✅ Trading system stopped gracefully'));
        process.exit(0);
      } catch (error) {
        originalConsole.error(chalk.red('❌ Error during shutdown'));
        if (error instanceof Error) {
          unifiedLogger.error('Error during shutdown', error, 'TradeStart');
        }
        process.exit(1);
      }
    };

    process.on('SIGINT', () => shutdownHandler('SIGINT'));
    process.on('SIGTERM', () => shutdownHandler('SIGTERM'));

    await workflow.start();
  }

  private static async runBacktest(options: {
    coins?: string;
    start: string;
    end: string;
    initialBalance: string;
    seed?: string;
    verbose?: boolean;
    quiet?: boolean;
    json?: boolean;
    progress?: boolean;
    updateInterval?: string;
    cycleSample?: string;
    equityDeltaPct?: string;
    upnlDelta?: string;
    exposureDeltaPct?: string;
    leverageDelta?: string;
    ddSteps?: string;
    summaryOnly?: boolean;
    noRisks?: boolean;
    noSignals?: boolean;
    noEquity?: boolean;
  }): Promise<void> {
    const { BacktestEngine } = await import('../../core/backtest-engine.js');
    const { BacktestReport } = await import('../../analytics/report.js');
    const { BacktestRenderer } = await import('../../utils/cli-render.js');
    const { format, addMonths, subMonths } = await import('date-fns');
    const originalConsole = UnifiedLogger.getInstance().getOriginalConsole();
    originalConsole.log(chalk.cyan('📈 Quanta Backtest'));
    originalConsole.log(chalk.gray('Historical strategy validation\n'));

    // Get config for default coins
    const config = getConfig();
    const coins = options.coins
      ? options.coins.split(',').map((c: string) => c.trim().toUpperCase())
      : config.trading.coins;

    // Derive default 4-month span when dates are missing
    const now = new Date();
    let startStr = options.start;
    let endStr = options.end;

    if (!startStr && !endStr) {
      const endD = now;
      const startD = subMonths(endD, 4);
      startStr = format(startD, 'yyyy-MM-dd');
      endStr = format(endD, 'yyyy-MM-dd');
    }

    // Import UTC date parser for consistent timezone handling
    const { parseUTCDateString } = await import('../../utils/time.js');

    try {
      if (startStr && !endStr) {
        // Validate start date using UTC parser
        parseUTCDateString(startStr);
        // Calculate end date from start (using date-fns which handles calendar months correctly)
        const s = new Date(startStr + 'T00:00:00Z'); // Parse as UTC for date-fns
        endStr = format(addMonths(s, 4), 'yyyy-MM-dd');
      } else if (!startStr && endStr) {
        // Validate end date using UTC parser
        parseUTCDateString(endStr);
        // Calculate start date from end (using date-fns which handles calendar months correctly)
        const e = new Date(endStr + 'T00:00:00Z'); // Parse as UTC for date-fns
        startStr = format(subMonths(e, 4), 'yyyy-MM-dd');
      }

      // Validate dates using UTC parser to ensure consistent timezone handling
      const startTimestamp = parseUTCDateString(startStr as string);
      const endTimestamp = parseUTCDateString(endStr as string);

      if (startTimestamp >= endTimestamp) {
        throw new Error('Start date must be before end date');
      }
    } catch (error) {
      if (error instanceof Error && error.message.includes('Invalid')) {
        throw error; // Re-throw validation errors as-is
      }
      throw new Error(
        `Invalid date format. Use YYYY-MM-DD. ${error instanceof Error ? error.message : String(error)}`
      );
    }

    const initialBalance = parseFloat(options.initialBalance);

    if (initialBalance <= 0 || isNaN(initialBalance)) {
      throw new Error(`Invalid initial balance: ${options.initialBalance}`);
    }

    const backtestConfig = {
      startDate: startStr as string,
      endDate: endStr as string,
      initialBalance,
      coins,
      cyclePeriod: 180000, // 3 minutes
      maxPositions: 6,
      leverage: 1,
      seed: options.seed ? Number(options.seed) : undefined,
    };

    originalConsole.log(chalk.blue('📊 Backtest Configuration:'));
    originalConsole.log(`   Period: ${backtestConfig.startDate} to ${backtestConfig.endDate}`);
    originalConsole.log(`   Coins: ${coins.join(', ')}`);
    originalConsole.log(`   Initial Balance: $${initialBalance.toLocaleString()}`);
    originalConsole.log(`   Max Positions: ${backtestConfig.maxPositions}`);
    originalConsole.log(`   Cycle Period: ${backtestConfig.cyclePeriod / 1000 / 60} minutes`);
    originalConsole.log('');

    // Configuration will be printed after dates are resolved below

    try {
      const mode: 'verbose' | 'normal' | 'quiet' = options.quiet
        ? 'quiet'
        : options.verbose
          ? 'verbose'
          : 'normal';
      const renderer = new BacktestRenderer({
        mode,
        showProgress: options.progress !== false,
        updateIntervalMs: Number(options.updateInterval || '750') || 750,
        sampleEveryCycles: Number(options.cycleSample || '10') || 10,
        equityDeltaPctToPrint: Number(options.equityDeltaPct || '0.001') || 0.001,
        upnlDeltaAbsToPrint: Number(options.upnlDelta || '10') || 10,
        exposureDeltaPctToPrint: Number(options.exposureDeltaPct || '0.1') || 0.1,
        leverageDeltaAbsToPrint: Number(options.leverageDelta || '0.2') || 0.2,
        drawdownSteps:
          (options.ddSteps
            ? options.ddSteps.split(',').map((s: string) => Number(s))
            : undefined) || undefined,
      });

      // Note: UnifiedLogger doesn't use configurable log levels
      // Log level filtering can be done via query filters in log view command

      const engine = new BacktestEngine(backtestConfig, {
        onPhase: phase => renderer.startPhase(phase),
        onProgress: (p, elapsed) => renderer.updateProgress(p, elapsed),
        onCycle: info => renderer.updateCycleLine(info),
        onSnapshot: () => renderer.heartbeat('Still running'),
      });

      const result = await engine.runBacktest();

      if (options.json) {
        originalConsole.log(JSON.stringify(result, null, 2));
      } else {
        // Generate and display compact report
        const report = new BacktestReport(result, {
          summaryOnly: options.summaryOnly === true,
          showRisks: options.noRisks !== true,
          showSignals: options.noSignals !== true,
          showEquity: options.noEquity !== true,
        });
        report.displayReport();
        originalConsole.log(chalk.green('✅ Backtest completed successfully!'));
      }
    } catch (error) {
      if (error instanceof Error) {
        originalConsole.error(chalk.red(`\n❌ Error: ${error.message}`));
      } else {
        originalConsole.error(chalk.red(`\n❌ Error: ${String(error)}`));
      }

      originalConsole.log(chalk.yellow('\n💡 Troubleshooting:'));
      originalConsole.log(chalk.gray('  1. Verify date format is YYYY-MM-DD'));
      originalConsole.log(chalk.gray('  2. Ensure start date is before end date'));
      originalConsole.log(chalk.gray('  3. Check coin symbols are valid'));

      throw error;
    }
  }

  private static async showStatus(): Promise<void> {
    const originalConsole = UnifiedLogger.getInstance().getOriginalConsole();
    originalConsole.log(chalk.cyan('📊 Quanta Status'));
    originalConsole.log(chalk.gray('Current system state\n'));

    const config = getConfig();

    originalConsole.log(chalk.blue('⚙️  Configuration:'));
    originalConsole.log(`   Mode: ${config.mode}`);
    originalConsole.log(`   Coins: ${config.trading.coins.join(', ')}`);
    originalConsole.log(`   Max Positions: ${config.trading.maxPositions}`);
    originalConsole.log(`   Cycle Period: ${config.trading.cyclePeriod / 1000}s`);
    originalConsole.log(`   Stop Loss: ${(config.trading.stopLoss * 100).toFixed(1)}%`);
    originalConsole.log('');

    originalConsole.log(chalk.blue('🤖 AI Configuration:'));
    originalConsole.log(`   Model: ${config.ai.model}`);
    originalConsole.log(`   Temperature: ${config.ai.temperature}`);
    originalConsole.log('');

    originalConsole.log(chalk.yellow('⚠️  Live status monitoring not yet implemented'));
  }

  private static async pauseTrading(options: { reason: string }): Promise<void> {
    const originalConsole = UnifiedLogger.getInstance().getOriginalConsole();
    originalConsole.log(chalk.cyan('⏸️  Pausing Trading System'));
    originalConsole.log(chalk.gray('='.repeat(60)));
    originalConsole.log(`Reason: ${options.reason}\n`);

    try {
      // Check if trading system is running
      originalConsole.log(chalk.blue('📊 Checking system status...'));

      // In a real implementation, this would:
      // 1. Check for running workflow
      // 2. Set pause flag
      // 3. Save current state
      // 4. Notify monitoring systems

      originalConsole.log(chalk.yellow('⚠️  Pause functionality not yet implemented'));
      originalConsole.log(chalk.gray('   This will:'));
      originalConsole.log(chalk.gray('   - Pause trading cycles'));
      originalConsole.log(chalk.gray('   - Keep positions open'));
      originalConsole.log(chalk.gray('   - Save state for resumption'));
    } catch (error) {
      originalConsole.error(chalk.red('❌ Error pausing trading system'));
      throw error;
    }
  }

  private static async stopTrading(options: {
    graceful?: boolean;
    force?: boolean;
  }): Promise<void> {
    const originalConsole = UnifiedLogger.getInstance().getOriginalConsole();
    const graceful = options.graceful || false;
    const force = options.force || false;

    originalConsole.log(chalk.cyan('🛑 Stopping Trading System'));
    originalConsole.log(chalk.gray('='.repeat(60)));
    originalConsole.log(`Mode: ${graceful ? 'Graceful' : force ? 'Force' : 'Standard'}\n`);

    try {
      originalConsole.log(chalk.blue('📊 Checking active positions...'));

      if (graceful) {
        originalConsole.log(chalk.yellow('⏳ Graceful shutdown: Finishing current trades...'));
        originalConsole.log(chalk.gray('   - Waiting for open orders to complete'));
        originalConsole.log(chalk.gray('   - Closing positions safely'));
        originalConsole.log(chalk.gray('   - Saving final state'));
      } else if (force) {
        originalConsole.log(chalk.red('⚠️  Force stop: Immediate termination'));
        originalConsole.log(chalk.gray('   - Stopping all trading activity immediately'));
        originalConsole.log(chalk.gray('   - Positions may remain open'));
      } else {
        originalConsole.log(chalk.yellow('⏹️  Standard stop: Safe shutdown'));
        originalConsole.log(chalk.gray('   - Stopping new trade cycles'));
        originalConsole.log(chalk.gray('   - Completing current operations'));
      }

      originalConsole.log('');
      originalConsole.log(chalk.yellow('⚠️  Stop functionality not yet implemented'));
      originalConsole.log(chalk.gray('   This will:'));
      originalConsole.log(chalk.gray('   - Stop trading workflow'));
      originalConsole.log(chalk.gray('   - Close or keep positions (based on mode)'));
      originalConsole.log(chalk.gray('   - Save session summary'));

      originalConsole.log('');
      originalConsole.log(chalk.green('💡 Tip: Use Ctrl+C to interrupt running trade commands'));
    } catch (error) {
      originalConsole.error(chalk.red('❌ Error stopping trading system'));
      throw error;
    }
  }

  /**
   * Validate mode configuration
   */
  private static validateModeConfiguration(
    mode: string,
    exchangeName: string,
    exchangeApiKey?: string,
    exchangeApiSecret?: string
  ): void {
    if (mode === 'live') {
      if (exchangeName === 'simulator') {
        throw new Error(
          this.formatError(
            'Configuration Error: Live mode cannot use simulator',
            'You have configured live mode but are using the simulator exchange.',
            `Update ${chalk.cyan('config.json')} to use a real exchange like okx, binance, or coinbase with API credentials`
          )
        );
      }

      if (!exchangeApiKey || !exchangeApiSecret) {
        throw new Error(
          this.formatError(
            `Missing API credentials for ${exchangeName.toUpperCase()}`,
            'Live trading requires API key and secret for authentication.',
            `Add your ${exchangeName.toUpperCase()} credentials to ${chalk.cyan('config.json')}`
          )
        );
      }
    } else if (mode === 'paper') {
      if (exchangeName === 'simulator') {
        throw new Error(
          this.formatError(
            'Configuration Error: Paper trading mode requires real exchange',
            'Paper trading mode needs a real exchange for data (okx, binance, coinbase, etc.).',
            `Update ${chalk.cyan('config.json')} exchange.name to a real exchange`
          )
        );
      }

      // API keys optional but show warning
      if (!exchangeApiKey || !exchangeApiSecret) {
        const originalConsole = UnifiedLogger.getInstance().getOriginalConsole();
        originalConsole.log(chalk.yellow('⚠️  Warning: Running paper trading without API keys'));
        originalConsole.log(
          chalk.gray(
            '   Some features may be limited. Consider adding API keys to config.json for full access.'
          )
        );
        originalConsole.log('');
      }
    }
    // simulation mode - no validation needed
  }

  /**
   * Validate AI configuration
   */
  private static validateAIConfiguration(apiKey?: string): void {
    if (!apiKey) {
      throw new Error(
        this.formatError(
          'Missing AI API key',
          'AI signal generation requires an API key from OpenRouter.',
          `Add your OpenRouter API key to ${chalk.cyan('config.json')}`,
          `Get API Key: ${chalk.blue('https://openrouter.ai/keys')}`
        )
      );
    }
  }
}

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
   * Print a concise effective exchange name using runtime-reported identity.
   */
  private static printEffectiveExchange(exchange: unknown, testnet: boolean): void {
    try {
      const reported = (exchange as { getExchangeName?: () => string })?.getExchangeName?.();
      const friendly = formatExchangeFriendlyName(reported, testnet) || 'unknown';
      console.log(`   Exchange: ${friendly}`);
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
   * Display trading mode configuration
   */
  private static displayModeConfiguration(
    mode: string,
    exchangeName: string,
    exchangeTestnet: boolean,
    exchangeApiKey?: string,
    exchangeApiSecret?: string,
    marketType?: string
  ): void {
    console.log(chalk.blue('📊 Configuration:'));
    console.log(`   Mode: ${mode}`);

    if (mode === 'simulation') {
      console.log(`   Data Source: mock data (simulator only)`);
      console.log(
        chalk.gray(`   Note: Config exchange '${exchangeName}' ignored in simulation mode`)
      );
    } else if (mode === 'paper') {
      // Data Source and Network are summarized below as a single consolidated Exchange line
      if (!exchangeApiKey || !exchangeApiSecret) {
        console.log(
          chalk.yellow(`   Note: Running without API keys (public data only, rate limited)`)
        );
      }
    } else if (mode === 'live') {
      const exchangeStatus = exchangeName !== 'simulator' ? 'real' : 'simulator';
      const networkStatus = exchangeTestnet ? 'testnet' : 'production';
      console.log(`   Exchange: ${exchangeName} (${exchangeStatus})`);
      if (exchangeName !== 'simulator') {
        console.log(`   Network: ${networkStatus}`);
      }
    }
    if (marketType) {
      console.log(`   Market Type: ${marketType}`);
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
    if (mode === 'simulation') {
      // Pure mock data simulator
      console.log('📊 Simulation mode: Using pure mock data (no real exchange data)');
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
      .option('-m, --mode <mode>', 'Trading mode: live, simulation, paper')
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

  private static async startTrading(options: { mode?: string; coins?: string }): Promise<void> {
    // Get mode and config first
    const config = getConfig();
    const mode = options.mode || config.mode || 'simulation';

    // Use CLI coins if explicitly provided, otherwise use config
    const coins = options.coins
      ? options.coins.split(',').map((c: string) => c.trim())
      : config.trading.coins;

    // Validate mode parameter
    const validModes = ['live', 'simulation', 'paper'];
    if (!validModes.includes(mode)) {
      throw new Error(
        `Invalid mode: "${mode}". Valid modes are: ${validModes.join(', ')}\n` +
          `For backtesting, use: quanta trade backtest --start <date> --end <date>\n` +
          `Please check your config.json or use --mode flag with a valid value.`
      );
    }

    const configUpdates = {
      mode,
      trading: { coins },
    };

    const updatedConfig = { ...config, ...configUpdates };

    // Show banner/config
    console.log(chalk.cyan('🏆 Quanta Trading System'));
    console.log(chalk.gray('AI-powered quantitative trading with real-time decision making\n'));

    const exchangeName = updatedConfig.exchange?.name || 'simulator';
    const exchangeTestnet = updatedConfig.exchange?.testnet ?? true;
    const exchangeApiKey = updatedConfig.exchange?.apiKey;
    const exchangeApiSecret = updatedConfig.exchange?.apiSecret;
    const marketType = updatedConfig.exchange?.marketType;

    this.displayModeConfiguration(
      mode,
      exchangeName,
      exchangeTestnet,
      exchangeApiKey,
      exchangeApiSecret,
      marketType
    );

    // Validate prerequisites based on mode
    this.validateModeConfiguration(mode, exchangeName, exchangeApiKey, exchangeApiSecret);
    this.validateAIConfiguration(updatedConfig.ai?.apiKey);

    // Initialize components and construct exchange only once
    const spinner = ora('Initializing trading system...').start();
    const exchange = await this.getExchangeForMode(
      mode as 'simulation' | 'paper' | 'live',
      exchangeName,
      exchangeApiKey,
      exchangeApiSecret,
      updatedConfig.exchange?.testnet ?? true
    );

    // Display effective exchange implementation using constructed instance
    this.printEffectiveExchange(exchange, exchangeTestnet);

    console.log(`   Coins: ${coins.join(', ')}`);
    const mt = (config.exchange?.marketType || 'spot').toLowerCase();
    console.log(
      chalk.gray(
        `   MarketType: ${mt || 'spot'} | Effective risk → lev: ${config.trading.leverageRange[0]}-${config.trading.leverageRange[1]}x, SL: ${(config.trading.stopLoss * 100).toFixed(1)}%, risk/trade: ${(config.trading.maxRisk * 100).toFixed(1)}%, maxPos: ${config.trading.maxPositions}`
      )
    );
    console.log('');

    const marketProvider = new MarketDataProvider(exchange);
    const aiClient = new OpenRouterClient(updatedConfig.ai.apiKey);
    const workflowConfig = this.buildWorkflowConfig(config, coins);
    const workflow = new TradingWorkflow(exchange, marketProvider, aiClient, workflowConfig);

    spinner.succeed('Trading system initialized');

    console.log(chalk.green('🚀 Starting trading workflow...'));
    console.log(chalk.gray('Press Ctrl+C to stop\n'));

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
    const { Logger } = await import('../../utils/logger.js');
    const { format, addMonths, subMonths } = await import('date-fns');

    console.log(chalk.cyan('📈 Quanta Backtest'));
    console.log(chalk.gray('Historical strategy validation\n'));

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
    } else if (startStr && !endStr) {
      const s = new Date(startStr);
      if (isNaN(s.getTime())) throw new Error(`Invalid start date: ${startStr}. Use YYYY-MM-DD`);
      endStr = format(addMonths(s, 4), 'yyyy-MM-dd');
    } else if (!startStr && endStr) {
      const e = new Date(endStr);
      if (isNaN(e.getTime())) throw new Error(`Invalid end date: ${endStr}. Use YYYY-MM-DD`);
      startStr = format(subMonths(e, 4), 'yyyy-MM-dd');
    }

    // Validate dates
    const startDate = new Date(startStr as string);
    const endDate = new Date(endStr as string);

    if (isNaN(startDate.getTime())) {
      throw new Error(`Invalid start date: ${startStr}. Use format YYYY-MM-DD`);
    }

    if (isNaN(endDate.getTime())) {
      throw new Error(`Invalid end date: ${endStr}. Use format YYYY-MM-DD`);
    }

    if (startDate >= endDate) {
      throw new Error('Start date must be before end date');
    }

    const initialBalance = parseFloat(options.initialBalance);

    if (initialBalance <= 0 || isNaN(initialBalance)) {
      throw new Error(`Invalid initial balance: ${options.initialBalance}`);
    }

    const backtestConfig = {
      startDate: format(startDate, 'yyyy-MM-dd'),
      endDate: format(endDate, 'yyyy-MM-dd'),
      initialBalance,
      coins,
      cyclePeriod: 180000, // 3 minutes
      maxPositions: 6,
      leverage: 1,
      seed: options.seed ? Number(options.seed) : undefined,
    };

    console.log(chalk.blue('📊 Backtest Configuration:'));
    console.log(`   Period: ${backtestConfig.startDate} to ${backtestConfig.endDate}`);
    console.log(`   Coins: ${coins.join(', ')}`);
    console.log(`   Initial Balance: $${initialBalance.toLocaleString()}`);
    console.log(`   Max Positions: ${backtestConfig.maxPositions}`);
    console.log(`   Cycle Period: ${backtestConfig.cyclePeriod / 1000 / 60} minutes`);
    console.log('');

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

      // Tune logger verbosity to reduce noise:
      // - quiet: errors only
      // - normal: warnings and above
      // - verbose: info and above
      const logger = Logger.getInstance('BacktestCLI');
      logger.updateConfig({
        level: (mode === 'quiet' ? 'error' : mode === 'verbose' ? 'info' : 'warn') as any,
      });

      const engine = new BacktestEngine(backtestConfig, {
        onPhase: phase => renderer.startPhase(phase),
        onProgress: (p, elapsed) => renderer.updateProgress(p, elapsed),
        onCycle: info => renderer.updateCycleLine(info),
        onSnapshot: () => renderer.heartbeat('Still running'),
      });

      const result = await engine.runBacktest();

      if (options.json) {
        // eslint-disable-next-line no-console
        console.log(JSON.stringify(result, null, 2));
      } else {
        // Generate and display compact report
        const report = new BacktestReport(result, {
          summaryOnly: options.summaryOnly === true,
          showRisks: options.noRisks !== true,
          showSignals: options.noSignals !== true,
          showEquity: options.noEquity !== true,
        });
        report.displayReport();
        console.log(chalk.green('✅ Backtest completed successfully!'));
      }
    } catch (error) {
      if (error instanceof Error) {
        console.error(chalk.red(`\n❌ Error: ${error.message}`));
      } else {
        console.error(chalk.red(`\n❌ Error: ${String(error)}`));
      }

      console.log(chalk.yellow('\n💡 Troubleshooting:'));
      console.log(chalk.gray('  1. Verify date format is YYYY-MM-DD'));
      console.log(chalk.gray('  2. Ensure start date is before end date'));
      console.log(chalk.gray('  3. Check coin symbols are valid'));

      throw error;
    }
  }

  private static async showStatus(): Promise<void> {
    console.log(chalk.cyan('📊 Quanta Status'));
    console.log(chalk.gray('Current system state\n'));

    const config = getConfig();

    console.log(chalk.blue('⚙️  Configuration:'));
    console.log(`   Mode: ${config.mode}`);
    console.log(`   Coins: ${config.trading.coins.join(', ')}`);
    console.log(`   Max Positions: ${config.trading.maxPositions}`);
    console.log(`   Cycle Period: ${config.trading.cyclePeriod / 1000}s`);
    console.log(`   Stop Loss: ${(config.trading.stopLoss * 100).toFixed(1)}%`);
    console.log('');

    console.log(chalk.blue('🤖 AI Configuration:'));
    console.log(`   Model: ${config.ai.model}`);
    console.log(`   Temperature: ${config.ai.temperature}`);
    console.log('');

    console.log(chalk.yellow('⚠️  Live status monitoring not yet implemented'));
  }

  private static async pauseTrading(options: { reason: string }): Promise<void> {
    console.log(chalk.cyan('⏸️  Pausing Trading System'));
    console.log(chalk.gray('='.repeat(60)));
    console.log(`Reason: ${options.reason}\n`);

    try {
      // Check if trading system is running
      console.log(chalk.blue('📊 Checking system status...'));

      // In a real implementation, this would:
      // 1. Check for running workflow
      // 2. Set pause flag
      // 3. Save current state
      // 4. Notify monitoring systems

      console.log(chalk.yellow('⚠️  Pause functionality not yet implemented'));
      console.log(chalk.gray('   This will:'));
      console.log(chalk.gray('   - Pause trading cycles'));
      console.log(chalk.gray('   - Keep positions open'));
      console.log(chalk.gray('   - Save state for resumption'));
    } catch (error) {
      console.error(chalk.red('❌ Error pausing trading system'));
      throw error;
    }
  }

  private static async stopTrading(options: {
    graceful?: boolean;
    force?: boolean;
  }): Promise<void> {
    const graceful = options.graceful || false;
    const force = options.force || false;

    console.log(chalk.cyan('🛑 Stopping Trading System'));
    console.log(chalk.gray('='.repeat(60)));
    console.log(`Mode: ${graceful ? 'Graceful' : force ? 'Force' : 'Standard'}\n`);

    try {
      console.log(chalk.blue('📊 Checking active positions...'));

      if (graceful) {
        console.log(chalk.yellow('⏳ Graceful shutdown: Finishing current trades...'));
        console.log(chalk.gray('   - Waiting for open orders to complete'));
        console.log(chalk.gray('   - Closing positions safely'));
        console.log(chalk.gray('   - Saving final state'));
      } else if (force) {
        console.log(chalk.red('⚠️  Force stop: Immediate termination'));
        console.log(chalk.gray('   - Stopping all trading activity immediately'));
        console.log(chalk.gray('   - Positions may remain open'));
      } else {
        console.log(chalk.yellow('⏹️  Standard stop: Safe shutdown'));
        console.log(chalk.gray('   - Stopping new trade cycles'));
        console.log(chalk.gray('   - Completing current operations'));
      }

      console.log('');
      console.log(chalk.yellow('⚠️  Stop functionality not yet implemented'));
      console.log(chalk.gray('   This will:'));
      console.log(chalk.gray('   - Stop trading workflow'));
      console.log(chalk.gray('   - Close or keep positions (based on mode)'));
      console.log(chalk.gray('   - Save session summary'));

      console.log('');
      console.log(chalk.green('💡 Tip: Use Ctrl+C to interrupt running trade commands'));
    } catch (error) {
      console.error(chalk.red('❌ Error stopping trading system'));
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
        console.log(chalk.yellow('⚠️  Warning: Running paper trading without API keys'));
        console.log(
          chalk.gray(
            '   Some features may be limited. Consider adding API keys to config.json for full access.'
          )
        );
        console.log('');
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

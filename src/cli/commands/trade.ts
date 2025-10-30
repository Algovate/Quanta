import { Command } from 'commander';
import chalk from 'chalk';
import ora from 'ora';
import { getConfig } from '../../config/settings.js';
import { SimulatorExchange } from '../../exchange/index.js';
import { MarketDataProvider } from '../../data/index.js';
import { OpenRouterClient } from '../../ai/index.js';
import { TradingWorkflow } from '../../core/index.js';
import { handleAsync } from '../../utils/index.js';

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
    const ExchangeClass = Object.values(module)[0] as any;
    return new ExchangeClass(apiKey, apiSecret, testnet);
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
    exchangeApiSecret?: string
  ): void {
    console.log(chalk.blue('📊 Configuration:'));
    console.log(`   Mode: ${mode}`);

    if (mode === 'simulation') {
      console.log(`   Data Source: mock data (simulator only)`);
      console.log(
        chalk.gray(`   Note: Config exchange '${exchangeName}' ignored in simulation mode`)
      );
    } else if (mode === 'paper') {
      console.log(`   Data Source: ${exchangeName} (real data, paper trading)`);
      console.log(`   Network: ${exchangeTestnet ? 'testnet' : 'live'}`);
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
  ) {
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
      return new SimulatorExchange(10000, dataExchange);
    } else {
      // Live mode - real exchanges
      if (exchangeName === 'simulator') {
        throw new Error(
          'Cannot use simulator exchange in live mode. Please use a real exchange (okx, binance, coinbase, etc.)'
        );
      }
      return await this.createExchange(exchangeName, apiKey, apiSecret, testnet, 'live');
    }
  }

  static register(program: Command): void {
    program
      .command('start')
      .description('Start AI trading system')
      .option('-m, --mode <mode>', 'Trading mode: live, simulation, paper')
      .option('-c, --coins <coins>', 'Comma-separated list of coins', 'BTC,ETH,SOL')
      .action(async options => {
        await handleAsync(async () => {
          await TradeCommands.startTrading(options);
        }, 'TradeCommands.start');
      });

    program
      .command('backtest')
      .description('Run backtest with historical data')
      .option('-c, --coins <coins>', 'Comma-separated list of coins', 'BTC,ETH,SOL')
      .option('-s, --start <date>', 'Start date (YYYY-MM-DD)', '2024-01-01')
      .option('-e, --end <date>', 'End date (YYYY-MM-DD)', '2024-12-31')
      .option('--initial-balance <amount>', 'Initial balance', '10000')
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

  private static async startTrading(options: { mode: string; coins: string }): Promise<void> {
    const coins = options.coins.split(',').map((c: string) => c.trim());

    // Get mode from CLI or config file
    const config = getConfig();
    const mode = options.mode || config.mode || 'simulation';

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

    this.displayModeConfiguration(
      mode,
      exchangeName,
      exchangeTestnet,
      exchangeApiKey,
      exchangeApiSecret
    );

    console.log(`   Coins: ${coins.join(', ')}`);
    console.log('');

    // Validate prerequisites based on mode
    this.validateModeConfiguration(mode, exchangeName, exchangeApiKey, exchangeApiSecret);
    this.validateAIConfiguration(updatedConfig.ai?.apiKey);

    // Initialize components
    const spinner = ora('Initializing trading system...').start();

    // Create exchange based on mode and config
    const exchange = await this.getExchangeForMode(
      mode as 'simulation' | 'paper' | 'live',
      exchangeName,
      exchangeApiKey,
      exchangeApiSecret,
      updatedConfig.exchange?.testnet ?? true
    );

    const marketProvider = new MarketDataProvider(exchange);
    const aiClient = new OpenRouterClient(updatedConfig.ai.apiKey);

    const workflow = new TradingWorkflow(exchange, marketProvider, aiClient, {
      coins,
      cyclePeriod: config.trading.cyclePeriod,
      maxPositions: config.trading.maxPositions,
      riskParams: {
        maxRiskPerTrade: config.trading.maxRisk,
        maxTotalRisk: 0.3, // Total margin usage limit (30% of account)
        defaultStopLoss: config.trading.stopLoss,
        maxLeverage: config.trading.leverageRange[1],
        minLeverage: config.trading.leverageRange[0],
        maxPositions: config.trading.maxPositions,
      },
    });

    spinner.succeed('Trading system initialized');

    console.log(chalk.green('🚀 Starting trading workflow...'));
    console.log(chalk.gray('Press Ctrl+C to stop\n'));

    await workflow.start();
  }

  private static async runBacktest(options: {
    coins: string;
    start: string;
    end: string;
    initialBalance: string;
  }): Promise<void> {
    const { BacktestEngine } = await import('../../core/backtest-engine.js');
    const { BacktestReport } = await import('../../analytics/report.js');

    console.log(chalk.cyan('📈 Quanta Backtest'));
    console.log(chalk.gray('Historical strategy validation\n'));

    const coins = options.coins.split(',').map((c: string) => c.trim().toUpperCase());

    // Validate dates
    const startDate = new Date(options.start);
    const endDate = new Date(options.end);

    if (isNaN(startDate.getTime())) {
      throw new Error(`Invalid start date: ${options.start}. Use format YYYY-MM-DD`);
    }

    if (isNaN(endDate.getTime())) {
      throw new Error(`Invalid end date: ${options.end}. Use format YYYY-MM-DD`);
    }

    if (startDate >= endDate) {
      throw new Error('Start date must be before end date');
    }

    const initialBalance = parseFloat(options.initialBalance);

    if (initialBalance <= 0 || isNaN(initialBalance)) {
      throw new Error(`Invalid initial balance: ${options.initialBalance}`);
    }

    const backtestConfig = {
      startDate: options.start,
      endDate: options.end,
      initialBalance,
      coins,
      cyclePeriod: 180000, // 3 minutes
      maxPositions: 6,
      leverage: 1,
    };

    console.log(chalk.blue('📊 Backtest Configuration:'));
    console.log(`   Period: ${options.start} to ${options.end}`);
    console.log(`   Coins: ${coins.join(', ')}`);
    console.log(`   Initial Balance: $${initialBalance.toLocaleString()}`);
    console.log(`   Max Positions: ${backtestConfig.maxPositions}`);
    console.log(`   Cycle Period: ${backtestConfig.cyclePeriod / 1000 / 60} minutes`);
    console.log('');

    try {
      const engine = new BacktestEngine(backtestConfig);
      const result = await engine.runBacktest();

      // Generate and display report
      const report = new BacktestReport(result);
      report.displayReport();

      console.log(chalk.green('✅ Backtest completed successfully!'));
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

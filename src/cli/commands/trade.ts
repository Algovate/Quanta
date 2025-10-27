import { Command } from 'commander';
import chalk from 'chalk';
import ora from 'ora';
import { getConfig } from '../../config/settings.js';
import { SimulatorExchange } from '../../exchange/simulator.js';
import { MarketDataProvider } from '../../data/market.js';
import { OpenRouterClient } from '../../ai/agent.js';
import { TradingWorkflow } from '../../core/workflow.js';
import { handleAsync } from '../../utils/error-handler.js';

export class TradeCommands {
  static register(program: Command): void {
    program
      .command('start')
      .description('Start AI trading system')
      .option('-m, --mode <mode>', 'Trading mode: live, simulation, backtest', 'simulation')
      .option('-c, --coins <coins>', 'Comma-separated list of coins', 'BTC,ETH,SOL')
      .option('--ui <ui>', 'UI mode: tui or cli', 'cli')
      .action(async (options) => {
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
      .action(async (options) => {
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
      .action(async (options) => {
        await handleAsync(async () => {
          await TradeCommands.pauseTrading(options);
        }, 'TradeCommands.pause');
      });

    program
      .command('stop')
      .description('Stop the running trading system')
      .option('--graceful', 'Graceful shutdown (finish current trades)', false)
      .option('--force', 'Force immediate stop', false)
      .action(async (options) => {
        await handleAsync(async () => {
          await TradeCommands.stopTrading(options);
        }, 'TradeCommands.stop');
      });
  }

  private static async startTrading(options: {
    mode: string;
    coins: string;
    ui: string;
  }): Promise<void> {
    console.log(chalk.cyan('🏆 Quanta Trading System'));
    console.log(chalk.gray('AI-powered quantitative trading with real-time decision making\n'));

    const coins = options.coins.split(',').map((c: string) => c.trim());
    const mode = options.mode as 'live' | 'simulation' | 'backtest';
    const uiMode = options.ui as 'tui' | 'cli';

    const configUpdates = {
      mode,
      trading: { coins },
      ui: { mode: uiMode },
    };

    const config = getConfig();
    const updatedConfig = { ...config, ...configUpdates };

    console.log(chalk.blue('📊 Configuration:'));
    console.log(`   Mode: ${mode}`);
    console.log(`   Coins: ${coins.join(', ')}`);
    console.log(`   UI: ${uiMode}`);
    console.log('');

    if (mode === 'backtest') {
      console.log(chalk.yellow('⚠️  Backtest mode requires start and end dates'));
      console.log(chalk.gray('   Use: quanta trade backtest --start 2024-01-01 --end 2024-12-31'));
      return;
    }

    // Initialize components
    const spinner = ora('Initializing trading system...').start();

    // Create exchange based on mode and config
    let exchange;
    const exchangeName = updatedConfig.exchange?.name || 'simulator';
    const exchangeApiKey = updatedConfig.exchange?.apiKey;
    const exchangeApiSecret = updatedConfig.exchange?.apiSecret;
    const exchangeTestnet = updatedConfig.exchange?.testnet ?? true;

    if (mode === 'simulation' || exchangeName === 'simulator') {
      exchange = new SimulatorExchange(10000);
    } else if (exchangeName === 'okx') {
      const { OKXExchange } = await import('../../exchange/okx.js');
      exchange = new OKXExchange(exchangeApiKey, exchangeApiSecret, exchangeTestnet);
    } else if (exchangeName === 'binance' || exchangeName === 'bin') {
      const { BinanceExchange } = await import('../../exchange/binance.js');
      exchange = new BinanceExchange(exchangeApiKey, exchangeApiSecret, exchangeTestnet);
    } else if (exchangeName === 'coinbase' || exchangeName === 'cb') {
      const { CoinbaseExchange } = await import('../../exchange/coinbase.js');
      exchange = new CoinbaseExchange(exchangeApiKey, exchangeApiSecret, exchangeTestnet);
    } else if (exchangeName === 'hyperliquid' || exchangeName === 'hliq') {
      const { HyperliquidExchange } = await import('../../exchange/hyperliquid.js');
      exchange = new HyperliquidExchange(exchangeApiKey, exchangeApiSecret, exchangeTestnet);
    } else {
      throw new Error(`Unsupported exchange: ${exchangeName}`);
    }

    const marketProvider = new MarketDataProvider(exchange);
    const aiClient = new OpenRouterClient(updatedConfig.ai.apiKey);

    const workflow = new TradingWorkflow(
      exchange,
      marketProvider,
      aiClient,
      {
        coins,
        cyclePeriod: config.trading.cyclePeriod,
        maxPositions: config.trading.maxPositions,
        riskParams: {
          maxRiskPerTrade: config.trading.maxRisk,
          maxTotalRisk: config.trading.maxRisk,
          defaultStopLoss: config.trading.stopLoss,
          maxLeverage: config.trading.leverageRange[1],
          minLeverage: config.trading.leverageRange[0],
          maxPositions: config.trading.maxPositions,
        },
      }
    );

    spinner.succeed('Trading system initialized');

    if (uiMode === 'tui') {
      try {
        console.log(chalk.yellow('🎨 Starting interactive TUI...'));
        
        // Import and start TUI (now works with ESM)
        const tuiManagerModule = await import('../../tui/manager.js');
        const { TUIManager } = tuiManagerModule;
        const appModule = await import('../../tui/app.js');
        const { renderTUI } = appModule;
        
        const tuiManager = new TUIManager();
        workflow.setEventEmitter(tuiManager);
        tuiManager.start(); // Initialize TUI with startup logs

        // Start the workflow in background
        workflow.start().catch(error => {
          console.error('Workflow error:', error);
          tuiManager.addLog('error', `Workflow error: ${error}`);
        });

        // Render TUI
        renderTUI(tuiManager, {
          onExit: () => {
            workflow.stop();
            process.exit(0);
          },
          onPause: () => {
            workflow.pause();
          },
          onResume: () => {
            workflow.resume();
          },
          onStop: () => {
            workflow.stop();
            process.exit(0);
          },
        });

      } catch (tuiError) {
        console.error(chalk.red('❌ Failed to start TUI mode'));
        
        if (tuiError instanceof Error) {
          const errorMsg = tuiError.message.toLowerCase();
          
          if (errorMsg.includes('yoga-wasm') || errorMsg.includes('native module')) {
            console.error(chalk.yellow('   Reason: Ink/yoga-wasm dependency issue'));
            console.log(chalk.gray('   Solution: Ensure project is built with npm run build'));
          } else if (errorMsg.includes('display') || errorMsg.includes('stdout')) {
            console.error(chalk.yellow('   Reason: Terminal display issue'));
            console.log(chalk.gray('   Solution: Try a larger terminal window (min 120x30)'));
          } else {
            console.error(chalk.yellow('   Error:'), tuiError.message);
          }
        } else {
          console.error(chalk.yellow('   Error:'), String(tuiError));
        }
        
        console.log(chalk.gray('\n💡 Falling back to CLI mode...'));
        console.log('');
        console.log(chalk.green('🚀 Starting trading workflow...'));
        console.log(chalk.gray('Press Ctrl+C to stop\n'));

        await workflow.start();
      }
    } else {
      console.log(chalk.green('🚀 Starting trading workflow...'));
      console.log(chalk.gray('Press Ctrl+C to stop\n'));

      await workflow.start();
    }
  }

  private static async runBacktest(options: {
    coins: string;
    start: string;
    end: string;
    initialBalance: string;
  }): Promise<void> {
    const { BacktestEngine } = await import('../../core/backtest-engine.js');
    const { BacktestReport } = await import('../../analytics/report.js');
    const ora = (await import('ora')).default;

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

  private static async pauseTrading(options: {
    reason: string;
  }): Promise<void> {
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
}

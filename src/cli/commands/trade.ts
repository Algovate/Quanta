import { Command } from 'commander';
import chalk from 'chalk';
import ora from 'ora';
import { getConfig } from '../../config/settings';
import { SimulatorExchange } from '../../exchange/simulator';
import { MarketDataProvider } from '../../data/market';
import { OpenRouterClient } from '../../ai/agent';
import { TradingWorkflow } from '../../core/workflow';
import { handleAsync } from '../../utils/error-handler';

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
    console.log(chalk.cyan('🏆 BetaArena Trading System'));
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
      console.log(chalk.gray('   Use: beta-arena trade backtest --start 2024-01-01 --end 2024-12-31'));
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
      const { OKXExchange } = await import('../../exchange/okx');
      exchange = new OKXExchange(exchangeApiKey, exchangeApiSecret, exchangeTestnet);
    } else if (exchangeName === 'binance' || exchangeName === 'bin') {
      const { BinanceExchange } = await import('../../exchange/binance');
      exchange = new BinanceExchange(exchangeApiKey, exchangeApiSecret, exchangeTestnet);
    } else if (exchangeName === 'coinbase' || exchangeName === 'cb') {
      const { CoinbaseExchange } = await import('../../exchange/coinbase');
      exchange = new CoinbaseExchange(exchangeApiKey, exchangeApiSecret, exchangeTestnet);
    } else if (exchangeName === 'hyperliquid' || exchangeName === 'hliq') {
      const { HyperliquidExchange } = await import('../../exchange/hyperliquid');
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
      console.log(chalk.yellow('🎨 TUI mode not yet implemented, falling back to CLI mode'));
    }

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
    console.log(chalk.cyan('📈 BetaArena Backtest'));
    console.log(chalk.gray('Historical strategy validation\n'));

    const coins = options.coins.split(',').map((c: string) => c.trim());

    console.log(chalk.blue('📊 Backtest Configuration:'));
    console.log(`   Period: ${options.start} to ${options.end}`);
    console.log(`   Coins: ${coins.join(', ')}`);
    console.log(`   Initial Balance: $${options.initialBalance}`);
    console.log('');

    console.log(chalk.yellow('⚠️  Backtest engine not yet implemented'));
    console.log(chalk.gray('   This will replay historical data and calculate performance metrics'));
  }

  private static async showStatus(): Promise<void> {
    console.log(chalk.cyan('📊 BetaArena Status'));
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

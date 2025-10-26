import { Command } from 'commander';
import chalk from 'chalk';
import ora from 'ora';
import { getConfig } from '../../config/settings';
import { SimulatorExchange } from '../../exchange/simulator';
import { MarketDataProvider } from '../../data/market';
import { OpenRouterClient } from '../../ai/agent';
import { TradingWorkflow } from '../../core/workflow';
import { handleAsync } from '../../utils/error-handler';

export class TradingCommands {
  static register(program: Command): void {
    program
      .command('start')
      .description('Start AI trading system')
      .option('-m, --mode <mode>', 'Trading mode: live, simulation, backtest', 'simulation')
      .option('-c, --coins <coins>', 'Comma-separated list of coins', 'BTC,ETH,SOL')
      .option('--ui <ui>', 'UI mode: tui or cli', 'cli')
      .action(async (options) => {
        await handleAsync(async () => {
          await TradingCommands.startTrading(options);
        }, 'TradingCommands.start');
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
          await TradingCommands.runBacktest(options);
        }, 'TradingCommands.backtest');
      });

    program
      .command('status')
      .description('Show current trading status')
      .action(async () => {
        await handleAsync(async () => {
          await TradingCommands.showStatus();
        }, 'TradingCommands.status');
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
      console.log(chalk.gray('   Use: beta-arena trading backtest --start 2024-01-01 --end 2024-12-31'));
      return;
    }

    // Initialize components
    const spinner = ora('Initializing trading system...').start();

    const exchange = mode === 'simulation'
      ? new SimulatorExchange(10000)
      : new SimulatorExchange(10000); // TODO: Implement real exchange

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
}

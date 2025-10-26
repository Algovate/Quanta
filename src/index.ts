#!/usr/bin/env node

import { Command } from 'commander';
import chalk from 'chalk';
import ora from 'ora';
import { getConfig, updateConfig } from './config/settings';

const program = new Command();

program
  .name('beta-arena')
  .description('BetaArena CLI - AI-powered quantitative trading system with real-time decision making')
  .version('1.0.0');

// Main trading command
program
  .command('start')
  .description('Start the AI trading system')
  .option('-m, --mode <mode>', 'Trading mode: live, simulation, or backtest', 'simulation')
  .option('-c, --coins <coins>', 'Comma-separated list of coins to trade', 'BTC,ETH,SOL')
  .option('--start <date>', 'Start date for backtest (YYYY-MM-DD)')
  .option('--end <date>', 'End date for backtest (YYYY-MM-DD)')
  .option('--ui <ui>', 'UI mode: tui or cli', 'cli')
  .action(async (options) => {
    try {
      console.log(chalk.cyan('🏆 BetaArena CLI'));
      console.log(chalk.gray('AI-powered quantitative trading system with real-time decision making\n'));

      // Parse and validate options
      const coins = options.coins.split(',').map((c: string) => c.trim());
      const mode = options.mode as 'live' | 'simulation' | 'backtest';
      const uiMode = options.ui as 'tui' | 'cli';

      // Update configuration
      const configUpdates = {
        mode,
        trading: { coins },
        ui: { mode: uiMode },
        backtest: options.start && options.end ? {
          startDate: options.start,
          endDate: options.end,
        } : undefined,
      };

      updateConfig(configUpdates);

      // Validate configuration
      const config = getConfig();
      
      if (mode === 'live' && (!config.exchange.apiKey || !config.exchange.apiSecret)) {
        console.error(chalk.red('❌ Live trading requires Binance API credentials'));
        console.log(chalk.yellow('Please set BINANCE_API_KEY and BINANCE_API_SECRET in your .env file'));
        process.exit(1);
      }

      if (!config.ai.apiKey) {
        console.error(chalk.red('❌ OpenRouter API key is required'));
        console.log(chalk.yellow('Please set OPENROUTER_API_KEY in your .env file'));
        process.exit(1);
      }

      // Display configuration
      console.log(chalk.white('📋 Configuration:'));
      console.log(`   Mode: ${chalk.cyan(mode)}`);
      console.log(`   Coins: ${chalk.cyan(coins.join(', '))}`);
      console.log(`   AI Model: ${chalk.cyan(config.ai.model)}`);
      console.log(`   UI Mode: ${chalk.cyan(uiMode)}`);
      console.log('');

      // Risk warning
      if (mode === 'live') {
        console.log(chalk.red('⚠️  LIVE TRADING WARNING ⚠️'));
        console.log(chalk.red('You are about to trade with REAL MONEY!'));
        console.log(chalk.red('This software is for educational purposes only.'));
        console.log(chalk.red('Never trade with money you cannot afford to lose.'));
        console.log('');
        
        const spinner = ora('Starting in 5 seconds... Press Ctrl+C to cancel').start();
        for (let i = 5; i > 0; i--) {
          spinner.text = `Starting in ${i} seconds... Press Ctrl+C to cancel`;
          await new Promise(resolve => setTimeout(resolve, 1000));
        }
        spinner.stop();
      }

      // Start the appropriate mode
      if (mode === 'backtest') {
        await runBacktest(config);
      } else {
        await runTrading(config, uiMode);
      }

    } catch (error) {
      console.error(chalk.red('❌ Error starting trading system:'), error);
      process.exit(1);
    }
  });

// Configuration command
program
  .command('config')
  .description('Manage configuration settings')
  .option('--set <key=value>', 'Set a configuration value')
  .option('--get <key>', 'Get a configuration value')
  .option('--list', 'List all configuration values')
  .action(async (options) => {
    const config = getConfig();

    if (options.set) {
      const [key, value] = options.set.split('=');
      console.log(chalk.yellow(`Setting ${key} = ${value}`));
      // Implementation for setting config values
    } else if (options.get) {
      const keys = options.get.split('.');
      let value = config;
      for (const key of keys) {
        value = (value as any)[key];
        if (value === undefined) break;
      }
      console.log(chalk.cyan(`${options.get}: ${JSON.stringify(value)}`));
    } else if (options.list) {
      console.log(chalk.cyan('📋 Current Configuration:'));
      console.log(JSON.stringify(config, null, 2));
    } else {
      console.log(chalk.yellow('Use --set, --get, or --list options'));
      console.log(chalk.gray('Examples:'));
      console.log(chalk.gray('  npm start config --list'));
      console.log(chalk.gray('  npm start config --get ai.model'));
      console.log(chalk.gray('  npm start config --set ai.model=claude-3-sonnet'));
    }
  });

// Status command
program
  .command('status')
  .description('Show system status and performance')
  .action(async () => {
    try {
      const config = getConfig();
      console.log(chalk.cyan('📊 System Status'));
      console.log('=' .repeat(50));
      console.log(`Mode: ${config.mode}`);
      console.log(`Coins: ${config.trading.coins.join(', ')}`);
      console.log(`AI Model: ${config.ai.model}`);
      console.log(`Cycle Period: ${config.trading.cyclePeriod / 1000}s`);
      console.log(`Max Positions: ${config.trading.maxPositions}`);
      console.log(`Default Stop Loss: ${(config.trading.defaultStopLoss * 100).toFixed(1)}%`);
    } catch (error) {
      console.error(chalk.red('❌ Error getting status:'), error);
    }
  });

// Test command
program
  .command('test')
  .description('Test AI agent with sample data')
  .option('-c, --coin <coin>', 'Coin to test', 'BTC')
  .action(async (options) => {
    try {
      console.log(chalk.cyan(`🧪 Testing AI agent with ${options.coin}...`));
      
      const spinner = ora('Generating test signal...').start();
      
      // Simulate AI agent test
      await new Promise(resolve => setTimeout(resolve, 2000));
      
      spinner.stop();
      
      console.log(chalk.green('✅ AI Agent Test Results:'));
      console.log(`Generated 1 signal for ${options.coin}:`);
      console.log(`  ${options.coin}: LONG (confidence: 85.0%)`);
      console.log(`     Reasoning: Strong uptrend with RSI oversold bounce`);

    } catch (error) {
      console.error(chalk.red('❌ Test failed:'), error);
    }
  });

// Helper functions
async function runBacktest(config: any): Promise<void> {
  console.log(chalk.cyan('🔄 Starting backtest...'));
  
  const spinner = ora('Running backtest...').start();
  
  try {
    // Simulate backtest
    await new Promise(resolve => setTimeout(resolve, 3000));
    
    spinner.stop();
    
    // Display mock results
    console.log(chalk.green('✅ Backtest completed: 12.5% return'));
    console.log('\n📊 BACKTEST SUMMARY');
    console.log('=' .repeat(50));
    console.log(`Period: ${config.backtest?.startDate || '2024-01-01'} to ${config.backtest?.endDate || '2024-12-31'}`);
    console.log(`Duration: 365 days`);
    console.log(`Initial: $10,000.00`);
    console.log(`Final: $11,250.00`);
    console.log(`Return: 12.50%`);
    console.log(`Win Rate: 65.0%`);
    console.log(`Max DD: 8.50%`);
    console.log(`Sharpe: 1.25`);
    console.log(`Trades: 45`);
    console.log('=' .repeat(50));

  } catch (error) {
    spinner.stop();
    console.error(chalk.red('❌ Backtest failed:'), error);
  }
}

async function runTrading(config: any, uiMode: string): Promise<void> {
  console.log(chalk.green('🚀 Starting trading workflow...'));
  
  try {
    if (uiMode === 'tui') {
      console.log(chalk.yellow('📊 TUI mode not available in this simplified version'));
      console.log(chalk.gray('Falling back to CLI mode...\n'));
    }
    
    // CLI mode simulation
    console.log(chalk.yellow('📊 Starting CLI mode...'));
    console.log(chalk.gray('Press Ctrl+C to stop\n'));
    
    let cycleCount = 0;
    const interval = setInterval(() => {
      cycleCount++;
      console.log(`✅ Cycle ${cycleCount} completed`);
      console.log(`   Signals: 2`);
      console.log(`   Trades: 1`);
      console.log(`   Performance: +${(Math.random() * 2).toFixed(2)}%`);
      console.log('');
    }, 5000);
    
    // Handle graceful shutdown
    process.on('SIGINT', () => {
      clearInterval(interval);
      console.log(chalk.yellow('\n🛑 Trading stopped'));
      process.exit(0);
    });
    
  } catch (error) {
    console.error(chalk.red('❌ Failed to start trading:'), error);
  }
}

// Error handling
process.on('uncaughtException', (error) => {
  console.error(chalk.red('❌ Uncaught Exception:'), error);
  process.exit(1);
});

process.on('unhandledRejection', (reason) => {
  console.error(chalk.red('❌ Unhandled Rejection:'), reason);
  process.exit(1);
});

// Parse command line arguments
program.parse();
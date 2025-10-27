import { Command } from 'commander';
import chalk from 'chalk';

export class HelpCommand {
  static register(program: Command): void {
    program
      .command('help')
      .description('Show detailed help information')
      .action(() => {
        HelpCommand.showHelp();
      });
  }

  private static showHelp(): void {
    console.log(chalk.cyan('🏆 Quanta CLI Help'));
    console.log(chalk.gray('AI-powered quantitative trading system\n'));

    console.log(chalk.blue('📋 Available Commands:'));
    console.log('');

    console.log(chalk.yellow('🏦 Trading Commands:'));
    console.log('  quanta trade start     Start AI trading system');
    console.log('  quanta trade backtest   Run backtest with historical data');
    console.log('  quanta trade status     Show current trading status');
    console.log('');

    console.log(chalk.yellow('🧪 Testing Commands:'));
    console.log('  quanta test kline         Test K-line data retrieval');
    console.log('  quanta test exchanges     Test multiple exchanges');
    console.log('  quanta test data-sources  Test multi-data source configuration');
    console.log('');

    console.log(chalk.yellow('⚙️  Configuration Commands:'));
    console.log('  quanta config show        Show current configuration');
    console.log('  quanta config set         Set configuration values');
    console.log('  quanta config validate     Validate configuration');
    console.log('');

    console.log(chalk.blue('💡 Examples:'));
    console.log('');
    console.log('  # Start simulation trading');
    console.log('  quanta trade start --mode simulation --coins BTC,ETH');
    console.log('');
    console.log('  # Test OKX K-line data');
    console.log('  quanta test kline --exchange okx --coin BTC --timeframe 3m');
    console.log('');
    console.log('  # Show configuration');
    console.log('  quanta config show');
    console.log('');
    console.log('  # Run backtest');
    console.log('  quanta trade backtest --start 2024-01-01 --end 2024-12-31');
    console.log('');

    console.log(chalk.red('⚠️  Risk Warning:'));
    console.log('  This software is for educational purposes only.');
    console.log('  Cryptocurrency trading involves substantial risk.');
    console.log('  Never trade with money you cannot afford to lose.');
  }
}

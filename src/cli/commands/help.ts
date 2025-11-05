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

    console.log(chalk.blue('📋 Available Commands (grouped):'));
    console.log('');

    console.log(chalk.yellow('🏦 Trading'));
    console.log('  quanta trade start        Start AI trading system');
    console.log('  quanta trade backtest     Run backtest with historical data');
    console.log('  quanta trade status       Show current trading status');
    console.log('  quanta trade pause        Pause trading (experimental)');
    console.log('  quanta trade stop         Stop trading');
    console.log('');

    console.log(chalk.yellow('🏟️  Arena'));
    console.log('  quanta arena start        Start multi-drone arena');
    console.log('  quanta arena status [id]  Show arena status');
    console.log('  quanta arena list         List arenas');
    console.log('  quanta arena compare <id> Compare drones within an arena');
    console.log('  quanta arena stop <id>    Stop arena');
    console.log('  quanta arena configs      List arena configs');
    console.log('');

    console.log(chalk.yellow('🧪 Testing / Simulation'));
    console.log('  quanta test exchange      Test exchange data retrieval');
    console.log('  quanta test ai            Test AI integration');
    console.log('  quanta simulate cycle     Run a single demonstration cycle');
    console.log('');

    console.log(chalk.yellow('⚙️  System'));
    console.log('  quanta config show        Show current configuration');
    console.log('  quanta config set         Set configuration values');
    console.log('  quanta config validate    Validate configuration');
    console.log('  quanta config save        Save configuration');
    console.log('  quanta config reset       Reset configuration');
    console.log('  quanta config init        Initialize configuration file');
    console.log('');
    console.log(chalk.yellow('📝 Logs'));
    console.log('  quanta log view           View console output logs');
    console.log('  quanta log clean          Clean old log files');
    console.log('  quanta log list           List log files with metadata');
    console.log('  quanta log stats          Show log statistics');
    console.log('  quanta log export         Export logs to JSON/CSV/TXT');
    console.log('');

    console.log(chalk.blue('💡 Examples:'));
    console.log('');
    console.log('  # Start simulation trading');
    console.log('  quanta trade start --env simulate --coins BTC,ETH');
    console.log('');
    console.log('  # Test single exchange');
    console.log('  quanta test exchange --exchange okx --coin BTC');
    console.log('');
    console.log('  # Test all exchanges');
    console.log('  quanta test exchange --all --coin BTC');
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

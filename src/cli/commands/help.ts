import { Command } from 'commander';
import { safeAction } from '../shared/command-utils.js';
import chalk from 'chalk';
import { UnifiedLogger } from '../../logging/index.js';

export class HelpCommand {
  static register(program: Command): void {
    program
      .command('help')
      .description('Show detailed help information')
      .action(
        safeAction(async () => {
          HelpCommand.showHelp();
        }, 'HelpCommand.help')
      );
  }

  private static showHelp(): void {
    const logger = UnifiedLogger.getInstance();

    logger.info(chalk.cyan('🏆 Quanta CLI Help'), {}, 'HelpCommands');
    logger.info(chalk.gray('AI-powered quantitative trading system\n'), {}, 'HelpCommands');

    logger.info(chalk.blue('📋 Available Commands (grouped):'), {}, 'HelpCommands');
    logger.info('', {}, 'HelpCommands');

    logger.info(chalk.yellow('🏦 Trading'), {}, 'HelpCommands');
    logger.info('  quanta trade start        Start AI trading system', {}, 'HelpCommands');
    logger.info(
      '  quanta trade backtest     Run backtest with historical data',
      {},
      'HelpCommands'
    );

    logger.info('', {}, 'HelpCommands');

    logger.info(chalk.yellow('🏟️  Arena'), {}, 'HelpCommands');
    logger.info('  quanta arena start        Start multi-drone arena', {}, 'HelpCommands');
    logger.info('  quanta arena status [id]  Show arena status', {}, 'HelpCommands');
    logger.info('  quanta arena list         List arenas', {}, 'HelpCommands');
    logger.info('  quanta arena compare <id> Compare drones within an arena', {}, 'HelpCommands');
    logger.info('  quanta arena stop <id>    Stop arena', {}, 'HelpCommands');
    logger.info('  quanta arena configs      List arena configs', {}, 'HelpCommands');
    logger.info('', {}, 'HelpCommands');

    logger.info(chalk.yellow('🧪 Testing / Simulation'), {}, 'HelpCommands');
    logger.info('  quanta test exchange      Test exchange data retrieval', {}, 'HelpCommands');
    logger.info('  quanta test ai            Test AI integration', {}, 'HelpCommands');
    logger.info('  quanta simulate cycle     Run a single demonstration cycle', {}, 'HelpCommands');
    logger.info('', {}, 'HelpCommands');

    logger.info(chalk.yellow('⚙️  System'), {}, 'HelpCommands');
    logger.info('  quanta config show        Show current configuration', {}, 'HelpCommands');
    logger.info('  quanta config set         Set configuration values', {}, 'HelpCommands');
    logger.info('  quanta config validate    Validate configuration', {}, 'HelpCommands');
    logger.info('  quanta config save        Save configuration', {}, 'HelpCommands');
    logger.info('  quanta config reset       Reset configuration', {}, 'HelpCommands');
    logger.info('  quanta config init        Initialize configuration file', {}, 'HelpCommands');
    logger.info('', {}, 'HelpCommands');
    logger.info(chalk.yellow('📝 Logs'), {}, 'HelpCommands');
    logger.info('  quanta log view           View console output logs', {}, 'HelpCommands');
    logger.info('  quanta log clean          Clean old log files', {}, 'HelpCommands');
    logger.info('  quanta log list           List log files with metadata', {}, 'HelpCommands');
    logger.info('  quanta log stats          Show log statistics', {}, 'HelpCommands');
    logger.info('  quanta log export         Export logs to JSON/CSV/TXT', {}, 'HelpCommands');
    logger.info('', {}, 'HelpCommands');

    logger.info(chalk.blue('💡 Examples:'), {}, 'HelpCommands');
    logger.info('', {}, 'HelpCommands');
    logger.info('  # Start simulation trading', {}, 'HelpCommands');
    logger.info('  quanta trade start --env simulate --coins BTC,ETH', {}, 'HelpCommands');
    logger.info('', {}, 'HelpCommands');
    logger.info('  # Test single exchange', {}, 'HelpCommands');
    logger.info('  quanta test exchange --exchange okx --coin BTC', {}, 'HelpCommands');
    logger.info('', {}, 'HelpCommands');
    logger.info('  # Test all exchanges', {}, 'HelpCommands');
    logger.info('  quanta test exchange --all --coin BTC', {}, 'HelpCommands');
    logger.info('', {}, 'HelpCommands');
    logger.info('  # Show configuration', {}, 'HelpCommands');
    logger.info('  quanta config show', {}, 'HelpCommands');
    logger.info('', {}, 'HelpCommands');
    logger.info('  # Run backtest', {}, 'HelpCommands');
    logger.info('  quanta trade backtest --start 2024-01-01 --end 2024-12-31', {}, 'HelpCommands');
    logger.info('', {}, 'HelpCommands');

    logger.info(chalk.red('⚠️  Risk Warning:'), {}, 'HelpCommands');
    logger.info('  This software is for educational purposes only.', {}, 'HelpCommands');
    logger.info('  Cryptocurrency trading involves substantial risk.', {}, 'HelpCommands');
    logger.info('  Never trade with money you cannot afford to lose.', {}, 'HelpCommands');
  }
}

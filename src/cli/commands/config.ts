import { Command } from 'commander';
import chalk from 'chalk';
import fs from 'fs';
import {
  getConfig,
  saveConfig,
  resetConfig,
  getConfigFilePath,
  getConfigExamplePath,
  validateConfig,
} from '../../config/settings.js';
import { handleAsync } from '../../utils/error-handler.js';
import { safeAction } from '../shared/command-utils.js';
import { UnifiedLogger } from '../../logging/index.js';

export class ConfigCommands {
  static register(program: Command): void {
    program
      .command('show')
      .description('Show current configuration')
      .option('-f, --format <format>', 'Output format: json, table', 'table')
      .action(
        safeAction(async options => {
          await handleAsync(async () => {
            await ConfigCommands.showConfig(options);
          }, 'ConfigCommands.show');
        }, 'ConfigCommands.show')
      );

    program
      .command('set')
      .description('Set configuration values')
      .argument('<key>', 'Configuration key (e.g., ai.model, trading.coins)')
      .argument('<value>', 'Configuration value')
      .action(
        safeAction(async (key, value) => {
          await handleAsync(async () => {
            await ConfigCommands.setConfig(key, value);
          }, 'ConfigCommands.set');
        }, 'ConfigCommands.set')
      );

    program
      .command('validate')
      .description('Validate current configuration')
      .action(
        safeAction(async () => {
          await handleAsync(async () => {
            await ConfigCommands.validateConfig();
          }, 'ConfigCommands.validate');
        }, 'ConfigCommands.validate')
      );

    program
      .command('save')
      .description('Save current configuration to file')
      .action(
        safeAction(async () => {
          await handleAsync(async () => {
            await ConfigCommands.saveConfig();
          }, 'ConfigCommands.save');
        }, 'ConfigCommands.save')
      );

    program
      .command('reset')
      .description('Reset configuration to defaults')
      .action(
        safeAction(async () => {
          await handleAsync(async () => {
            await ConfigCommands.resetConfig();
          }, 'ConfigCommands.reset');
        }, 'ConfigCommands.reset')
      );

    program
      .command('init')
      .description('Initialize configuration file from example')
      .action(
        safeAction(async () => {
          await handleAsync(async () => {
            await ConfigCommands.initConfig();
          }, 'ConfigCommands.init');
        }, 'ConfigCommands.init')
      );

    program
      .command('list')
      .description('List configuration keys and current values')
      .option('-p, --prefix <path>', 'Only list keys under this path (e.g., ai, trading)')
      .action(
        safeAction(async (options: { prefix?: string }) => {
          await handleAsync(async () => {
            await ConfigCommands.listKeys(options.prefix);
          }, 'ConfigCommands.list');
        }, 'ConfigCommands.list')
      );
  }

  private static async showConfig(options: { format: string }): Promise<void> {
    const logger = UnifiedLogger.getInstance();
    const context = 'ConfigCommands';
    const config = getConfig();

    if (options.format === 'json') {
      logger.info(JSON.stringify(config, null, 2));
    } else {
      logger.info(chalk.cyan('⚙️  Quanta Configuration'));
      logger.info(chalk.gray('Current system settings\n'));

      logger.info(chalk.blue('🏦 Exchange Settings:'));
      logger.info(`   Mode: ${config.mode}`, {}, context);
      logger.info(`   Exchange: ${config.exchange.name}`, {}, context);
      logger.info(`   Testnet: ${config.exchange.testnet ? 'enabled' : 'disabled'}`, {}, context);
      logger.info('', {}, context);

      logger.info(chalk.blue('🤖 AI Settings:'));
      logger.info(`   Model: ${config.ai.model}`, {}, context);
      logger.info(`   Temperature: ${config.ai.temperature}`, {}, context);
      logger.info('', {}, context);

      logger.info(chalk.blue('📊 Trading Settings:'));
      logger.info(`   Coins: ${config.trading.coins.join(', ')}`);
      logger.info(`   Cycle Period: ${config.trading.cyclePeriod / 1000}s`, {}, context);
      logger.info(`   Max Positions: ${config.trading.maxPositions}`, {}, context);
      logger.info(
        `   Leverage Range: ${config.trading.leverageRange[0]}x - ${config.trading.leverageRange[1]}x`
      );
      logger.info(`   Stop Loss: ${(config.trading.stopLoss * 100).toFixed(1)}%`);
      logger.info(`   Max Risk: ${(config.trading.maxRisk * 100).toFixed(1)}%`);
      logger.info('', {}, context);

      if (config.backtest) {
        logger.info(chalk.blue('🔬 Backtest Settings:'));
        logger.info(`   Initial Balance: $${config.backtest.initialBalance}`, {}, context);
        if (config.backtest.startDate)
          logger.info(`   Start Date: ${config.backtest.startDate}`, {}, context);
        if (config.backtest.endDate)
          logger.info(`   End Date: ${config.backtest.endDate}`, {}, context);
        logger.info('', {}, context);
      }

      if (config.notifications) {
        logger.info(chalk.blue('🔔 Notification Settings:'));
        logger.info(`   Enabled: ${config.notifications.enabled ? 'yes' : 'no'}`, {}, context);
        if (config.notifications.webhook)
          logger.info(`   Webhook: ${config.notifications.webhook.substring(0, 20)}...`);
        logger.info('', {}, context);
      }

      // Show configuration source
      const configFile = getConfigFilePath();
      logger.info('', {}, context);
      logger.info(chalk.blue('📁 Configuration Source:'));
      if (fs.existsSync(configFile)) {
        logger.info(`   File: ${configFile}`, {}, context);
        logger.info(`   Status: ${chalk.green('Loaded from file')}`);
      } else {
        logger.info(`   File: ${configFile}`, {}, context);
        logger.info(`   Status: ${chalk.yellow('Using defaults + environment variables')}`);
      }
    }
    // Ensure clean shutdown for CLI
    logger.shutdown();
  }

  private static async setConfig(key: string, value: string): Promise<void> {
    const logger = UnifiedLogger.getInstance();
    const context = 'ConfigCommands';
    const config = getConfig();
    const keys = key.split('.');

    // Navigate to the nested property
    let current: any = config;
    for (let i = 0; i < keys.length - 1; i++) {
      if (!current[keys[i]]) {
        current[keys[i]] = {};
      }
      current = current[keys[i]];
    }

    // Set the value
    const lastKey = keys[keys.length - 1];
    const parsedValue = this.parseValue(value);
    current[lastKey] = parsedValue;

    // Save to file
    saveConfig(config);
    logger.info(chalk.green(`✅ Configuration updated: ${key} = ${value}`), {}, context);
    logger.shutdown();
  }

  private static parseValue(value: string): any {
    // Try to parse as JSON first
    try {
      return JSON.parse(value);
    } catch {
      // If not JSON, try to parse as number
      if (!isNaN(Number(value))) {
        return Number(value);
      }
      // Return as string
      return value;
    }
  }

  private static async validateConfig(): Promise<void> {
    const logger = UnifiedLogger.getInstance();
    const context = 'ConfigCommands';
    logger.info(chalk.cyan('🔍 Validating Configuration'), {}, context);
    logger.info(chalk.gray('Checking system settings\n'), {}, context);

    try {
      const config = getConfig();
      validateConfig(config);

      logger.info(chalk.green('✅ Configuration loaded successfully'));
      logger.info(chalk.green('✅ All required fields present'));
      logger.info(chalk.green('✅ Data types validated'));
      logger.info('', {}, context);

      logger.info(chalk.blue('📋 Validation Summary:'));
      logger.info(`   Mode: ${config.mode}`, {}, context);
      logger.info(`   Exchange: ${config.exchange.name}`, {}, context);
      logger.info(`   Trading Coins: ${config.trading.coins.length} configured`, {}, context);
      logger.info(`   Max Positions: ${config.trading.maxPositions}`, {}, context);
      logger.info('', {}, context);

      // Check API keys
      if (config.ai.apiKey) {
        logger.info(chalk.green('✅ AI API Key: Configured'));
      } else {
        logger.info(chalk.yellow('⚠️  AI API Key: Not configured'));
      }

      const configFile = getConfigFilePath();
      if (fs.existsSync(configFile)) {
        logger.info(chalk.green('✅ Configuration file: Found'));
      } else {
        logger.info(chalk.yellow('⚠️  Configuration file: Not found (using defaults)'));
      }
    } catch (error) {
      logger.info(chalk.red('❌ Configuration validation failed:'));
      logger.info(chalk.red(`   ${error}`));
    }
    // Ensure clean shutdown for CLI
    logger.shutdown();
  }

  private static async saveConfig(): Promise<void> {
    const logger = UnifiedLogger.getInstance();
    const context = 'ConfigCommands';
    const config = getConfig();
    saveConfig(config);
    logger.info(chalk.green('✅ Configuration saved to file'), {}, context);
    logger.shutdown();
  }

  private static async resetConfig(): Promise<void> {
    const logger = UnifiedLogger.getInstance();
    const context = 'ConfigCommands';
    resetConfig();
    logger.info(chalk.green('✅ Configuration reset to defaults'), {}, context);
    logger.shutdown();
  }

  private static async initConfig(): Promise<void> {
    const logger = UnifiedLogger.getInstance();
    const context = 'ConfigCommands';
    const examplePath = getConfigExamplePath();
    const configPath = getConfigFilePath();

    if (fs.existsSync(configPath)) {
      logger.info(chalk.yellow('⚠️  Configuration file already exists'), {}, context);
      logger.info(chalk.gray(`   File: ${configPath}`), {}, context);
      logger.info(chalk.gray('   Use "config reset" to reset to defaults'), {}, context);
      logger.shutdown();
      return;
    }

    if (fs.existsSync(examplePath)) {
      fs.copyFileSync(examplePath, configPath);
      logger.info(chalk.green('✅ Configuration file initialized'));
      logger.info(chalk.gray(`   File: ${configPath}`));
      logger.info(chalk.gray('   Edit the file to customize your settings'));
    } else {
      logger.info(chalk.red('❌ Example configuration file not found'));
      logger.info(chalk.gray(`   Expected: ${examplePath}`));
    }
    // Ensure clean shutdown for CLI
    logger.shutdown();
  }

  private static async listKeys(prefix?: string): Promise<void> {
    const logger = UnifiedLogger.getInstance();
    const context = 'ConfigCommands';
    const config = getConfig();

    function isObject(value: unknown): value is Record<string, unknown> {
      return !!value && typeof value === 'object' && !Array.isArray(value);
    }

    function flatten(
      obj: Record<string, unknown>,
      base = ''
    ): Array<{ key: string; value: unknown }> {
      const out: Array<{ key: string; value: unknown }> = [];
      for (const [k, v] of Object.entries(obj)) {
        const key = base ? `${base}.${k}` : k;
        if (isObject(v)) {
          out.push(...flatten(v as Record<string, unknown>, key));
        } else {
          out.push({ key, value: v });
        }
      }
      return out;
    }

    const target = prefix
      ? (prefix
          .split('.')
          .reduce((acc: any, part: string) => (acc ? acc[part] : undefined), config as any) ?? {})
      : config;
    const pairs = isObject(target) ? flatten(target as Record<string, unknown>, prefix || '') : [];

    if (pairs.length === 0) {
      logger.info(chalk.yellow('No configuration keys found for the given scope.'));
      logger.shutdown();
      return;
    }

    logger.info(chalk.cyan('\n📋 Configuration Keys' + (prefix ? ` (${prefix})` : '')));
    for (const { key, value } of pairs) {
      const display = typeof value === 'string' ? value : JSON.stringify(value);
      logger.info(`  ${key}: ${display}`, {}, context);
    }
    logger.info('', {}, context);
    logger.shutdown();
  }
}

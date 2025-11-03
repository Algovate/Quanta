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
import { UnifiedLogger } from '../../logging/index.js';

export class ConfigCommands {
  static register(program: Command): void {
    program
      .command('show')
      .description('Show current configuration')
      .option('-f, --format <format>', 'Output format: json, yaml, table', 'table')
      .action(async options => {
        await handleAsync(async () => {
          await ConfigCommands.showConfig(options);
        }, 'ConfigCommands.show');
      });

    program
      .command('set')
      .description('Set configuration values')
      .argument('<key>', 'Configuration key (e.g., ai.model, trading.coins)')
      .argument('<value>', 'Configuration value')
      .action(async (key, value) => {
        await handleAsync(async () => {
          await ConfigCommands.setConfig(key, value);
        }, 'ConfigCommands.set');
      });

    program
      .command('validate')
      .description('Validate current configuration')
      .action(async () => {
        await handleAsync(async () => {
          await ConfigCommands.validateConfig();
        }, 'ConfigCommands.validate');
      });

    program
      .command('save')
      .description('Save current configuration to file')
      .action(async () => {
        await handleAsync(async () => {
          await ConfigCommands.saveConfig();
        }, 'ConfigCommands.save');
      });

    program
      .command('reset')
      .description('Reset configuration to defaults')
      .action(async () => {
        await handleAsync(async () => {
          await ConfigCommands.resetConfig();
        }, 'ConfigCommands.reset');
      });

    program
      .command('init')
      .description('Initialize configuration file from example')
      .action(async () => {
        await handleAsync(async () => {
          await ConfigCommands.initConfig();
        }, 'ConfigCommands.init');
      });
  }

  private static async showConfig(options: { format: string }): Promise<void> {
    // Use originalConsole to bypass logger interception and prevent database initialization hang
    const originalConsole = UnifiedLogger.getInstance().getOriginalConsole();
    const config = getConfig();

    if (options.format === 'json') {
      originalConsole.log(JSON.stringify(config, null, 2));
    } else if (options.format === 'yaml') {
      originalConsole.log(chalk.yellow('⚠️  YAML format not yet implemented'));
    } else {
      originalConsole.log(chalk.cyan('⚙️  Quanta Configuration'));
      originalConsole.log(chalk.gray('Current system settings\n'));

      originalConsole.log(chalk.blue('🏦 Exchange Settings:'));
      originalConsole.log(`   Mode: ${config.mode}`);
      originalConsole.log(`   Exchange: ${config.exchange.name}`);
      originalConsole.log(`   Testnet: ${config.exchange.testnet ? 'enabled' : 'disabled'}`);
      originalConsole.log('');

      originalConsole.log(chalk.blue('🤖 AI Settings:'));
      originalConsole.log(`   Model: ${config.ai.model}`);
      originalConsole.log(`   Temperature: ${config.ai.temperature}`);
      originalConsole.log('');

      originalConsole.log(chalk.blue('📊 Trading Settings:'));
      originalConsole.log(`   Coins: ${config.trading.coins.join(', ')}`);
      originalConsole.log(`   Cycle Period: ${config.trading.cyclePeriod / 1000}s`);
      originalConsole.log(`   Max Positions: ${config.trading.maxPositions}`);
      originalConsole.log(
        `   Leverage Range: ${config.trading.leverageRange[0]}x - ${config.trading.leverageRange[1]}x`
      );
      originalConsole.log(`   Stop Loss: ${(config.trading.stopLoss * 100).toFixed(1)}%`);
      originalConsole.log(`   Max Risk: ${(config.trading.maxRisk * 100).toFixed(1)}%`);
      originalConsole.log('');

      if (config.backtest) {
        originalConsole.log(chalk.blue('🔬 Backtest Settings:'));
        originalConsole.log(`   Initial Balance: $${config.backtest.initialBalance}`);
        if (config.backtest.startDate) originalConsole.log(`   Start Date: ${config.backtest.startDate}`);
        if (config.backtest.endDate) originalConsole.log(`   End Date: ${config.backtest.endDate}`);
        originalConsole.log('');
      }

      if (config.notifications) {
        originalConsole.log(chalk.blue('🔔 Notification Settings:'));
        originalConsole.log(`   Enabled: ${config.notifications.enabled ? 'yes' : 'no'}`);
        if (config.notifications.webhook)
          originalConsole.log(`   Webhook: ${config.notifications.webhook.substring(0, 20)}...`);
        originalConsole.log('');
      }

      // Show configuration source
      const configFile = getConfigFilePath();
      originalConsole.log('');
      originalConsole.log(chalk.blue('📁 Configuration Source:'));
      if (fs.existsSync(configFile)) {
        originalConsole.log(`   File: ${configFile}`);
        originalConsole.log(`   Status: ${chalk.green('Loaded from file')}`);
      } else {
        originalConsole.log(`   File: ${configFile}`);
        originalConsole.log(`   Status: ${chalk.yellow('Using defaults + environment variables')}`);
      }
    }
  }

  private static async setConfig(key: string, value: string): Promise<void> {
    // Use originalConsole to bypass logger interception and prevent database initialization hang
    const originalConsole = UnifiedLogger.getInstance().getOriginalConsole();
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
    originalConsole.log(chalk.green(`✅ Configuration updated: ${key} = ${value}`));
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
    // Use originalConsole to bypass logger interception and prevent database initialization hang
    const originalConsole = UnifiedLogger.getInstance().getOriginalConsole();
    originalConsole.log(chalk.cyan('🔍 Validating Configuration'));
    originalConsole.log(chalk.gray('Checking system settings\n'));

    try {
      const config = getConfig();
      validateConfig(config);

      originalConsole.log(chalk.green('✅ Configuration loaded successfully'));
      originalConsole.log(chalk.green('✅ All required fields present'));
      originalConsole.log(chalk.green('✅ Data types validated'));
      originalConsole.log('');

      originalConsole.log(chalk.blue('📋 Validation Summary:'));
      originalConsole.log(`   Mode: ${config.mode}`);
      originalConsole.log(`   Exchange: ${config.exchange.name}`);
      originalConsole.log(`   Trading Coins: ${config.trading.coins.length} configured`);
      originalConsole.log(`   Max Positions: ${config.trading.maxPositions}`);
      originalConsole.log('');

      // Check API keys
      if (config.ai.apiKey) {
        originalConsole.log(chalk.green('✅ AI API Key: Configured'));
      } else {
        originalConsole.log(chalk.yellow('⚠️  AI API Key: Not configured'));
      }

      const configFile = getConfigFilePath();
      if (fs.existsSync(configFile)) {
        originalConsole.log(chalk.green('✅ Configuration file: Found'));
      } else {
        originalConsole.log(chalk.yellow('⚠️  Configuration file: Not found (using defaults)'));
      }
    } catch (error) {
      originalConsole.log(chalk.red('❌ Configuration validation failed:'));
      originalConsole.log(chalk.red(`   ${error}`));
    }
  }

  private static async saveConfig(): Promise<void> {
    // Use originalConsole to bypass logger interception and prevent database initialization hang
    const originalConsole = UnifiedLogger.getInstance().getOriginalConsole();
    const config = getConfig();
    saveConfig(config);
    originalConsole.log(chalk.green('✅ Configuration saved to file'));
  }

  private static async resetConfig(): Promise<void> {
    // Use originalConsole to bypass logger interception and prevent database initialization hang
    const originalConsole = UnifiedLogger.getInstance().getOriginalConsole();
    resetConfig();
    originalConsole.log(chalk.green('✅ Configuration reset to defaults'));
  }

  private static async initConfig(): Promise<void> {
    // Use originalConsole to bypass logger interception and prevent database initialization hang
    const originalConsole = UnifiedLogger.getInstance().getOriginalConsole();
    const examplePath = getConfigExamplePath();
    const configPath = getConfigFilePath();

    if (fs.existsSync(configPath)) {
      originalConsole.log(chalk.yellow('⚠️  Configuration file already exists'));
      originalConsole.log(chalk.gray(`   File: ${configPath}`));
      originalConsole.log(chalk.gray('   Use "config reset" to reset to defaults'));
      return;
    }

    if (fs.existsSync(examplePath)) {
      fs.copyFileSync(examplePath, configPath);
      originalConsole.log(chalk.green('✅ Configuration file initialized'));
      originalConsole.log(chalk.gray(`   File: ${configPath}`));
      originalConsole.log(chalk.gray('   Edit the file to customize your settings'));
    } else {
      originalConsole.log(chalk.red('❌ Example configuration file not found'));
      originalConsole.log(chalk.gray(`   Expected: ${examplePath}`));
    }
  }
}

import { Command } from 'commander';
import chalk from 'chalk';
import fs from 'fs';
import path from 'path';
import { getConfig, saveConfig, resetConfig, getConfigFilePath, getConfigExamplePath, validateConfig } from '../../config/settings';
import { handleAsync } from '../../utils/error-handler';

export class ConfigCommands {
  static register(program: Command): void {
    program
      .command('show')
      .description('Show current configuration')
      .option('-f, --format <format>', 'Output format: json, yaml, table', 'table')
      .action(async (options) => {
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
    const config = getConfig();

    if (options.format === 'json') {
      console.log(JSON.stringify(config, null, 2));
    } else if (options.format === 'yaml') {
      console.log(chalk.yellow('⚠️  YAML format not yet implemented'));
    } else {
      console.log(chalk.cyan('⚙️  BetaArena Configuration'));
      console.log(chalk.gray('Current system settings\n'));

      console.log(chalk.blue('🏦 Exchange Settings:'));
      console.log(`   Mode: ${config.mode}`);
      console.log(`   Exchange: ${config.exchange.name}`);
      console.log(`   Testnet: ${config.exchange.testnet ? 'enabled' : 'disabled'}`);
      console.log('');

      console.log(chalk.blue('🤖 AI Settings:'));
      console.log(`   Model: ${config.ai.model}`);
      console.log(`   Temperature: ${config.ai.temperature}`);
      console.log('');

      console.log(chalk.blue('📊 Trading Settings:'));
      console.log(`   Coins: ${config.trading.coins.join(', ')}`);
      console.log(`   Cycle Period: ${config.trading.cyclePeriod / 1000}s`);
      console.log(`   Max Positions: ${config.trading.maxPositions}`);
      console.log(`   Leverage Range: ${config.trading.leverageRange[0]}x - ${config.trading.leverageRange[1]}x`);
      console.log(`   Stop Loss: ${(config.trading.stopLoss * 100).toFixed(1)}%`);
      console.log(`   Max Risk: ${(config.trading.maxRisk * 100).toFixed(1)}%`);
      console.log('');

      console.log(chalk.blue('🎨 UI Settings:'));
      console.log(`   Mode: ${config.ui.mode}`);
      console.log(`   Refresh Rate: ${config.ui.refreshRate}ms`);
      console.log('');

      if (config.backtest) {
        console.log(chalk.blue('🔬 Backtest Settings:'));
        console.log(`   Initial Balance: $${config.backtest.initialBalance}`);
        if (config.backtest.startDate) console.log(`   Start Date: ${config.backtest.startDate}`);
        if (config.backtest.endDate) console.log(`   End Date: ${config.backtest.endDate}`);
        console.log('');
      }

      if (config.notifications) {
        console.log(chalk.blue('🔔 Notification Settings:'));
        console.log(`   Enabled: ${config.notifications.enabled ? 'yes' : 'no'}`);
        if (config.notifications.webhook) console.log(`   Webhook: ${config.notifications.webhook.substring(0, 20)}...`);
        console.log('');
      }

      // Show configuration source
      const configFile = getConfigFilePath();
      console.log('');
      console.log(chalk.blue('📁 Configuration Source:'));
      if (fs.existsSync(configFile)) {
        console.log(`   File: ${configFile}`);
        console.log(`   Status: ${chalk.green('Loaded from file')}`);
      } else {
        console.log(`   File: ${configFile}`);
        console.log(`   Status: ${chalk.yellow('Using defaults + environment variables')}`);
      }
    }
  }

  private static async setConfig(key: string, value: string): Promise<void> {
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
    console.log(chalk.green(`✅ Configuration updated: ${key} = ${value}`));
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
    console.log(chalk.cyan('🔍 Validating Configuration'));
    console.log(chalk.gray('Checking system settings\n'));

    try {
      const config = getConfig();
      validateConfig(config);

      console.log(chalk.green('✅ Configuration loaded successfully'));
      console.log(chalk.green('✅ All required fields present'));
      console.log(chalk.green('✅ Data types validated'));
      console.log('');

      console.log(chalk.blue('📋 Validation Summary:'));
      console.log(`   Mode: ${config.mode}`);
      console.log(`   Exchange: ${config.exchange.name}`);
      console.log(`   Trading Coins: ${config.trading.coins.length} configured`);
      console.log(`   Max Positions: ${config.trading.maxPositions}`);
      console.log('');

      // Check API keys
      if (config.ai.apiKey) {
        console.log(chalk.green('✅ AI API Key: Configured'));
      } else {
        console.log(chalk.yellow('⚠️  AI API Key: Not configured'));
      }

      const configFile = getConfigFilePath();
      if (fs.existsSync(configFile)) {
        console.log(chalk.green('✅ Configuration file: Found'));
      } else {
        console.log(chalk.yellow('⚠️  Configuration file: Not found (using defaults)'));
      }

    } catch (error) {
      console.log(chalk.red('❌ Configuration validation failed:'));
      console.log(chalk.red(`   ${error}`));
    }
  }

  private static async saveConfig(): Promise<void> {
    const config = getConfig();
    saveConfig(config);
    console.log(chalk.green('✅ Configuration saved to file'));
  }

  private static async resetConfig(): Promise<void> {
    resetConfig();
    console.log(chalk.green('✅ Configuration reset to defaults'));
  }

  private static async initConfig(): Promise<void> {
    const examplePath = getConfigExamplePath();
    const configPath = getConfigFilePath();

    if (fs.existsSync(configPath)) {
      console.log(chalk.yellow('⚠️  Configuration file already exists'));
      console.log(chalk.gray(`   File: ${configPath}`));
      console.log(chalk.gray('   Use "config reset" to reset to defaults'));
      return;
    }

    if (fs.existsSync(examplePath)) {
      fs.copyFileSync(examplePath, configPath);
      console.log(chalk.green('✅ Configuration file initialized'));
      console.log(chalk.gray(`   File: ${configPath}`));
      console.log(chalk.gray('   Edit the file to customize your settings'));
    } else {
      console.log(chalk.red('❌ Example configuration file not found'));
      console.log(chalk.gray(`   Expected: ${examplePath}`));
    }
  }
}

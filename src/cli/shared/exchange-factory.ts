/**
 * Exchange Factory - Unified exchange initialization for CLI commands
 */

import chalk from 'chalk';
import { SimulatorExchange } from '../../exchange/index.js';
import { PaperExchange } from '../../exchange/paper.js';
import { UnifiedLogger } from '../../logging/index.js';
import type { Exchange } from '../../exchange/types.js';

export interface ExchangeConfig {
  exchangeName: string;
  apiKey?: string;
  apiSecret?: string;
  testnet?: boolean;
}

export interface ExchangeFactoryOptions {
  mode: 'simulation' | 'paper' | 'live';
  config: ExchangeConfig;
  logToConsole?: boolean;
}

/**
 * Exchange type mapping
 */
const EXCHANGE_MAP: Record<string, string> = {
  okx: 'okx',
  binance: 'binance',
  bin: 'binance',
  coinbase: 'coinbase',
  cb: 'coinbase',
  hyperliquid: 'hyperliquid',
  hliq: 'hyperliquid',
  simulator: 'simulator',
};

/**
 * Create an exchange instance based on name
 */
async function createExchange(
  exchangeName: string,
  apiKey?: string,
  apiSecret?: string,
  testnet: boolean = true
): Promise<Exchange> {
  const normalizedName = EXCHANGE_MAP[exchangeName.toLowerCase()];

  if (!normalizedName) {
    throw new Error(`Unsupported exchange: ${exchangeName}`);
  }

  // Handle simulator
  if (normalizedName === 'simulator') {
    return new SimulatorExchange(10000);
  }

  // Dynamically import and create real exchange
  const module = await import(`../../exchange/${normalizedName}.js`);
  const ExchangeClass = Object.values(module)[0] as new (
    apiKey?: string,
    apiSecret?: string,
    testnet?: boolean
  ) => unknown;
  return new ExchangeClass(apiKey, apiSecret, testnet) as Exchange;
}

/**
 * Create exchange instance for the specified mode
 */
export async function createExchangeForMode(options: ExchangeFactoryOptions): Promise<Exchange> {
  const { mode, config, logToConsole = true } = options;
  const { exchangeName, apiKey, apiSecret, testnet = true } = config;

  const originalConsole = UnifiedLogger.getInstance().getOriginalConsole();

  if (mode === 'simulation') {
    // Pure mock data simulator
    if (logToConsole) {
      originalConsole.log('📊 Simulation mode: Using pure mock data (no real exchange data)');
    }
    return new SimulatorExchange(10000);
  } else if (mode === 'paper') {
    // Paper trading: real data with simulated execution
    if (exchangeName === 'simulator') {
      throw new Error(
        'Paper trading mode requires a real exchange data source (okx, binance, coinbase, etc.). ' +
          'Update config.json exchange.name to use a real exchange.'
      );
    }
    const dataExchange = await createExchange(exchangeName, apiKey, apiSecret, testnet);
    // Wrap the real exchange with PaperExchange to simulate execution while using real market data
    return new PaperExchange(dataExchange as any, 10000);
  } else {
    // Live mode - real exchanges
    if (exchangeName === 'simulator') {
      throw new Error(
        'Cannot use simulator exchange in live mode. Please use a real exchange (okx, binance, coinbase, etc.)'
      );
    }
    return await createExchange(exchangeName, apiKey, apiSecret, testnet);
  }
}

/**
 * Validate mode configuration
 */
export function validateModeConfiguration(
  mode: string,
  exchangeName: string,
  exchangeApiKey?: string,
  exchangeApiSecret?: string
): void {
  if (mode === 'live') {
    if (exchangeName === 'simulator') {
      throw new Error(
        formatError(
          'Configuration Error: Live mode cannot use simulator',
          'You have configured live mode but are using the simulator exchange.',
          `Update ${chalk.cyan('config.json')} to use a real exchange like okx, binance, or coinbase with API credentials`
        )
      );
    }

    if (!exchangeApiKey || !exchangeApiSecret) {
      throw new Error(
        formatError(
          `Missing API credentials for ${exchangeName.toUpperCase()}`,
          'Live trading requires API key and secret for authentication.',
          `Add your ${exchangeName.toUpperCase()} credentials to ${chalk.cyan('config.json')}`
        )
      );
    }
  } else if (mode === 'paper') {
    if (exchangeName === 'simulator') {
      throw new Error(
        formatError(
          'Configuration Error: Paper trading mode requires real exchange',
          'Paper trading mode needs a real exchange for data (okx, binance, coinbase, etc.).',
          `Update ${chalk.cyan('config.json')} exchange.name to a real exchange`
        )
      );
    }

    // API keys optional but show warning
    if (!exchangeApiKey || !exchangeApiSecret) {
      const originalConsole = UnifiedLogger.getInstance().getOriginalConsole();
      originalConsole.log(chalk.yellow('⚠️  Warning: Running paper trading without API keys'));
      originalConsole.log(
        chalk.gray(
          '   Some features may be limited. Consider adding API keys to config.json for full access.'
        )
      );
      originalConsole.log('');
    }
  }
  // simulation mode - no validation needed
}

/**
 * Helper to format error messages with consistent styling
 */
function formatError(title: string, issue: string, solution: string, tip?: string): string {
  let message = chalk.red(`❌ ${title}`) + chalk.white('\n\n');
  message += chalk.yellow('📝 Issue:') + chalk.gray(` ${issue}\n`);
  message += chalk.white('\n');
  message += chalk.yellow('🔧 Solution:') + chalk.white(` ${solution}`);
  if (tip) {
    message += chalk.white('\n\n') + chalk.yellow('💡 Tip:') + chalk.gray(` ${tip}`);
  }
  return message;
}


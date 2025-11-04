import { Exchange } from '../exchange/types.js';
import { SimulatorExchange } from '../exchange/simulator.js';
import { PaperExchange } from '../exchange/paper.js';
import { OKXExchange } from '../exchange/okx.js';
import { BinanceExchange } from '../exchange/binance.js';
import { CoinbaseExchange } from '../exchange/coinbase.js';
import { Config, getExchangeConfig } from '../config/settings.js';

export interface DataSourceManager {
  getExchange(): Exchange;
}

export class SimpleDataSourceManager implements DataSourceManager {
  private exchange: Exchange;
  private config: Config;

  constructor(config: Config) {
    this.config = config;
    const exchangeConfig = getExchangeConfig(config);
    this.exchange = this.createExchange({
      name: exchangeConfig.name || 'simulator',
      apiKey: exchangeConfig.apiKey,
      apiSecret: exchangeConfig.apiSecret,
      testnet: exchangeConfig.testnet,
    });
  }

  private createExchange(config: {
    name: string;
    apiKey?: string;
    apiSecret?: string;
    testnet?: boolean;
  }): Exchange {
    const exchangeName = config.name.toLowerCase();

    // In simulate env with real exchange: use SimulatorExchange (mock data generation)
    if (this.config.env === 'simulate' && exchangeName !== 'simulator') {
      const dataExchange = this.createRealExchange(exchangeName, config);
      return new SimulatorExchange(10000, dataExchange);
    }

    // In paper env with real exchange: wrap real exchange with PaperExchange (real data, simulated exec)
    if (this.config.env === 'paper' && exchangeName !== 'simulator') {
      const real = this.createRealExchange(exchangeName, config);
      return new PaperExchange(real, 10000);
    }

    // Pure simulation or live/backtest modes
    switch (exchangeName) {
      case 'simulator':
        return new SimulatorExchange(10000);
      case 'okx':
        return new OKXExchange(config.apiKey, config.apiSecret, config.testnet);
      case 'binance':
        return new BinanceExchange(config.apiKey, config.apiSecret, config.testnet);
      case 'coinbase':
        return new CoinbaseExchange(config.apiKey, config.apiSecret, config.testnet);
      default:
        throw new Error(
          `Unsupported exchange: ${exchangeName}. Supported exchanges: simulator, okx, binance, coinbase`
        );
    }
  }

  private createRealExchange(
    name: string,
    config: { apiKey?: string; apiSecret?: string; testnet?: boolean }
  ): Exchange {
    const exchangeName = name.toLowerCase();

    switch (exchangeName) {
      case 'okx':
        return new OKXExchange(config.apiKey, config.apiSecret, config.testnet);
      case 'binance':
        return new BinanceExchange(config.apiKey, config.apiSecret, config.testnet);
      case 'coinbase':
        return new CoinbaseExchange(config.apiKey, config.apiSecret, config.testnet);
      default:
        throw new Error(
          `Unsupported real exchange for data source: ${exchangeName}. Supported: okx, binance, coinbase`
        );
    }
  }

  getExchange(): Exchange {
    return this.exchange;
  }

  // Helper method to get exchange info for logging
  getExchangeInfo(): { name: string; type: string; testnet: boolean } {
    const exchange = this.exchange as Exchange & {
      getExchangeName?: () => string;
      isTestnetMode?: () => boolean;
    };

    return {
      name: this.exchange.constructor.name,
      type: exchange.getExchangeName ? exchange.getExchangeName() : 'Unknown',
      testnet: exchange.isTestnetMode ? exchange.isTestnetMode() : false,
    };
  }

  // Method to validate exchange is working
  async validateExchange(): Promise<{ valid: boolean; error?: string }> {
    try {
      // Test basic functionality
      await this.exchange.getCandlesticks('BTC/USDT', '3m', 1);
      return { valid: true };
    } catch (error) {
      return {
        valid: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  }
}

// Factory function to create data source manager
export function createDataSourceManager(config: Config): DataSourceManager {
  return new SimpleDataSourceManager(config);
}

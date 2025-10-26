import { Exchange } from '../exchange/types';
import { SimulatorExchange } from '../exchange/simulator';
import { GenericExchange } from '../exchange/generic';
import { Config, getExchangeConfig } from '../config/settings';

export interface DataSourceManager {
  getExchange(): Exchange;
}

export class SimpleDataSourceManager implements DataSourceManager {
  private exchange: Exchange;

  constructor(config: Config) {
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
    if (config.name === 'simulator') {
      return new SimulatorExchange(10000);
    } else {
      return new GenericExchange(config.name, config.apiKey, config.apiSecret, config.testnet);
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

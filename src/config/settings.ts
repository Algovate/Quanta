import { z } from 'zod';
import dotenv from 'dotenv';

// Load environment variables
dotenv.config();

// Configuration schema validation
const ConfigSchema = z.object({
  mode: z.enum(['live', 'simulation', 'backtest']).default('simulation'),
  exchange: z.object({
    name: z.literal('binance'),
    apiKey: z.string().optional(),
    apiSecret: z.string().optional(),
    testnet: z.boolean().default(true),
  }),
  ai: z.object({
    provider: z.literal('openrouter'),
    apiKey: z.string(),
    model: z.string().default('deepseek/deepseek-chat'),
    temperature: z.number().min(0).max(2).default(0.7),
  }),
  trading: z.object({
    coins: z.array(z.string()).default(['BTC', 'ETH', 'SOL']),
    cyclePeriod: z.number().default(180000), // 3 minutes in ms
    maxPositions: z.number().default(6),
    leverageRange: z.tuple([z.number(), z.number()]).default([5, 40]),
    defaultStopLoss: z.number().default(0.03), // 3%
    maxRiskPerTrade: z.number().default(0.05), // 5%
    maxTotalRisk: z.number().default(0.30), // 30%
  }),
  ui: z.object({
    mode: z.enum(['tui', 'cli']).default('tui'),
    refreshRate: z.number().default(1000), // ms
  }),
  backtest: z.object({
    startDate: z.string().optional(),
    endDate: z.string().optional(),
    initialBalance: z.number().default(10000),
  }).optional(),
});

export type Config = z.infer<typeof ConfigSchema>;

// Parse environment variables
function parseEnvConfig(): Partial<Config> {
  const coins = process.env.TRADING_COINS?.split(',').map(c => c.trim()) || ['BTC', 'ETH', 'SOL'];
  
  return {
    mode: (process.env.EXCHANGE_MODE as 'live' | 'simulation' | 'backtest') || 'simulation',
    exchange: {
      name: 'binance',
      apiKey: process.env.BINANCE_API_KEY,
      apiSecret: process.env.BINANCE_API_SECRET,
      testnet: process.env.BINANCE_TESTNET === 'true',
    },
    ai: {
      provider: 'openrouter',
      apiKey: process.env.OPENROUTER_API_KEY || '',
      model: process.env.AI_MODEL || 'deepseek/deepseek-chat',
      temperature: parseFloat(process.env.AI_TEMPERATURE || '0.7'),
    },
    trading: {
      coins,
      cyclePeriod: parseInt(process.env.CYCLE_PERIOD || '180000'),
      maxPositions: parseInt(process.env.MAX_POSITIONS || '6'),
      leverageRange: [
        parseInt(process.env.LEVERAGE_MIN || '5'),
        parseInt(process.env.LEVERAGE_MAX || '40')
      ],
      defaultStopLoss: parseFloat(process.env.DEFAULT_STOP_LOSS || '0.03'),
      maxRiskPerTrade: parseFloat(process.env.MAX_RISK_PER_TRADE || '0.05'),
      maxTotalRisk: parseFloat(process.env.MAX_TOTAL_RISK || '0.30'),
    },
    ui: {
      mode: (process.env.UI_MODE as 'tui' | 'cli') || 'tui',
      refreshRate: parseInt(process.env.UI_REFRESH_RATE || '1000'),
    },
  };
}

// Global config instance
let globalConfig: Config | null = null;

export function getConfig(): Config {
  if (!globalConfig) {
    const envConfig = parseEnvConfig();
    globalConfig = ConfigSchema.parse(envConfig);
  }
  return globalConfig;
}

export function updateConfig(updates: Partial<Config>): Config {
  const currentConfig = getConfig();
  const mergedConfig = {
    ...currentConfig,
    ...updates,
    exchange: { ...currentConfig.exchange, ...updates.exchange },
    ai: { ...currentConfig.ai, ...updates.ai },
    trading: { ...currentConfig.trading, ...updates.trading },
    ui: { ...currentConfig.ui, ...updates.ui },
  };
  
  globalConfig = ConfigSchema.parse(mergedConfig);
  return globalConfig;
}

export function validateConfig(config: unknown): Config {
  return ConfigSchema.parse(config);
}

// CLI argument parsing helpers
export function parseCliArgs(args: string[]): Partial<Config> {
  const config: Partial<Config> = {};
  
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    
    switch (arg) {
      case '--mode':
        config.mode = args[++i] as 'live' | 'simulation' | 'backtest';
        break;
      case '--coins':
        config.trading = {
          ...config.trading,
          coins: args[++i].split(',').map(c => c.trim())
        };
        break;
      case '--start':
        config.backtest = {
          ...config.backtest,
          startDate: args[++i]
        };
        break;
      case '--end':
        config.backtest = {
          ...config.backtest,
          endDate: args[++i]
        };
        break;
    }
  }
  
  return config;
}

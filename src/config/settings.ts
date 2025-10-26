import { z } from 'zod';
import fs from 'fs';
import path from 'path';
import dotenv from 'dotenv';

// Load environment variables
dotenv.config();

const ExchangeConfigSchema = z.object({
  name: z.string(),
  apiKey: z.string().optional(),
  apiSecret: z.string().optional(),
  testnet: z.boolean().default(true),
});

const ConfigSchema = z.object({
  mode: z.enum(['live', 'simulation', 'backtest']).default('simulation'),
  exchange: ExchangeConfigSchema,
  ai: z.object({
    apiKey: z.string(),
    model: z.string().default('deepseek/deepseek-chat'),
    temperature: z.number().min(0).max(2).default(0.7),
  }),
  trading: z.object({
    coins: z.array(z.string()).default(['BTC', 'ETH', 'SOL']),
    cyclePeriod: z.number().default(180000), // 3 minutes in ms
    maxPositions: z.number().default(6),
    leverageRange: z.tuple([z.number(), z.number()]).default([5, 40]),
    stopLoss: z.number().default(0.03), // 3%
    maxRisk: z.number().default(0.05), // 5%
  }),
  ui: z.object({
    mode: z.enum(['tui', 'cli']).default('tui'),
    refreshRate: z.number().default(1000), // ms
  }),
  backtest: z
    .object({
      startDate: z.string().optional(),
      endDate: z.string().optional(),
      initialBalance: z.number().default(10000),
    })
    .optional(),
  notifications: z
    .object({
      enabled: z.boolean().default(false),
      webhook: z.string().optional(),
    })
    .optional(),
});

export type Config = z.infer<typeof ConfigSchema>;
export type ExchangeConfig = z.infer<typeof ExchangeConfigSchema>;

// Configuration file paths
const CONFIG_DIR = path.join(process.cwd(), 'config');
const CONFIG_FILE = path.join(CONFIG_DIR, 'config.json');
const CONFIG_EXAMPLE_FILE = path.join(CONFIG_DIR, 'config.example.json');

// Default configuration
const DEFAULT_CONFIG: Partial<Config> = {
  mode: 'simulation',
  exchange: {
    name: 'simulator',
    testnet: true,
  },
  ai: {
    apiKey: '',
    model: 'deepseek/deepseek-chat',
    temperature: 0.7,
  },
  trading: {
    coins: ['BTC', 'ETH', 'SOL'],
    cyclePeriod: 180000,
    maxPositions: 6,
    leverageRange: [5, 40],
    stopLoss: 0.03,
    maxRisk: 0.05,
  },
  ui: {
    mode: 'tui',
    refreshRate: 1000,
  },
  backtest: {
    initialBalance: 10000,
  },
  notifications: {
    enabled: false,
  },
};

function ensureConfigDir(): void {
  if (!fs.existsSync(CONFIG_DIR)) {
    fs.mkdirSync(CONFIG_DIR, { recursive: true });
  }
}

function createExampleConfig(): void {
  if (!fs.existsSync(CONFIG_EXAMPLE_FILE)) {
    fs.writeFileSync(CONFIG_EXAMPLE_FILE, JSON.stringify(DEFAULT_CONFIG, null, 2));
  }
}

function loadConfigFromFile(): Partial<Config> {
  try {
    if (fs.existsSync(CONFIG_FILE)) {
      const configData = fs.readFileSync(CONFIG_FILE, 'utf8');
      return JSON.parse(configData);
    }
  } catch (error) {
    console.warn('Warning: Failed to load config file, using defaults:', error);
  }
  return {};
}

function parseEnvConfig(): Partial<Config> {
  const coins = process.env.TRADING_COINS?.split(',').map(c => c.trim()) || ['BTC', 'ETH', 'SOL'];

  return {
    mode: (process.env.EXCHANGE_MODE as 'live' | 'simulation' | 'backtest') || 'simulation',
    exchange: {
      name: process.env.EXCHANGE_NAME || 'simulator',
      apiKey: process.env.EXCHANGE_API_KEY,
      apiSecret: process.env.EXCHANGE_API_SECRET,
      testnet: process.env.EXCHANGE_TESTNET !== 'false',
    },
    ai: {
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
        parseInt(process.env.LEVERAGE_MAX || '40'),
      ],
      stopLoss: parseFloat(process.env.STOP_LOSS || '0.03'),
      maxRisk: parseFloat(process.env.MAX_RISK || '0.05'),
    },
    ui: {
      mode: (process.env.UI_MODE as 'tui' | 'cli') || 'tui',
      refreshRate: parseInt(process.env.UI_REFRESH_RATE || '1000'),
    },
    backtest: {
      startDate: process.env.BACKTEST_START_DATE,
      endDate: process.env.BACKTEST_END_DATE,
      initialBalance: parseFloat(process.env.BACKTEST_INITIAL_BALANCE || '10000'),
    },
    notifications: {
      enabled: process.env.NOTIFICATIONS_ENABLED === 'true',
      webhook: process.env.NOTIFICATION_WEBHOOK,
    },
  };
}

let globalConfig: Config | null = null;

export function getConfig(): Config {
  if (!globalConfig) {
    // Ensure config directory exists
    ensureConfigDir();
    createExampleConfig();

    // Load configuration from multiple sources (file > env > defaults)
    const fileConfig = loadConfigFromFile();
    const envConfig = parseEnvConfig();

    // Merge configurations (file config takes precedence over env config)
    const mergedConfig = {
      ...DEFAULT_CONFIG,
      ...envConfig,
      ...fileConfig,
      // Deep merge for nested objects
      exchange: {
        ...DEFAULT_CONFIG.exchange,
        ...envConfig.exchange,
        ...fileConfig.exchange,
      },
      ai: {
        ...DEFAULT_CONFIG.ai,
        ...envConfig.ai,
        ...fileConfig.ai,
      },
      trading: {
        ...DEFAULT_CONFIG.trading,
        ...envConfig.trading,
        ...fileConfig.trading,
      },
      ui: {
        ...DEFAULT_CONFIG.ui,
        ...envConfig.ui,
        ...fileConfig.ui,
      },
      backtest: {
        ...DEFAULT_CONFIG.backtest,
        ...envConfig.backtest,
        ...fileConfig.backtest,
      },
      notifications: {
        ...DEFAULT_CONFIG.notifications,
        ...envConfig.notifications,
        ...fileConfig.notifications,
      },
    };

    globalConfig = ConfigSchema.parse(mergedConfig);
  }
  return globalConfig;
}

export function saveConfig(config: Partial<Config>): void {
  try {
    ensureConfigDir();
    const currentConfig = getConfig();
    const mergedConfig = { ...currentConfig, ...config };
    fs.writeFileSync(CONFIG_FILE, JSON.stringify(mergedConfig, null, 2));
    console.log(`Configuration saved to ${CONFIG_FILE}`);
  } catch (error) {
    console.error('Failed to save configuration:', error);
    throw error;
  }
}

export function resetConfig(): void {
  try {
    if (fs.existsSync(CONFIG_FILE)) {
      fs.unlinkSync(CONFIG_FILE);
    }
    globalConfig = null;
    console.log('Configuration reset to defaults');
  } catch (error) {
    console.error('Failed to reset configuration:', error);
    throw error;
  }
}

export function validateConfig(config: unknown): Config {
  return ConfigSchema.parse(config);
}

export function getExchangeConfig(config: Config): ExchangeConfig {
  return config.exchange;
}

export function getConfigFilePath(): string {
  return CONFIG_FILE;
}

export function getConfigExamplePath(): string {
  return CONFIG_EXAMPLE_FILE;
}

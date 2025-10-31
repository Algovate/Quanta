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
  mode: z.enum(['live', 'simulation', 'paper']).default('simulation'), // backtest mode is handled by separate command
  exchange: ExchangeConfigSchema,
  ai: z.object({
    apiKey: z.string(),
    model: z.string().default('deepseek/deepseek-chat'),
    temperature: z.number().min(0).max(2).default(0.7),
    prompt: z
      .object({
        candles: z
          .object({
            m3: z.number().int().min(1).max(200).default(10),
            h4: z.number().int().min(1).max(200).default(5),
          })
          .default({ m3: 10, h4: 5 }),
        sections: z
          .object({
            candlesTA: z.boolean().default(true),
            sentiment: z.boolean().default(true),
            technicalState: z.boolean().default(true),
          })
          .default({ candlesTA: true, sentiment: true, technicalState: true }),
      })
      .default({
        candles: { m3: 10, h4: 5 },
        sections: { candlesTA: true, sentiment: true, technicalState: true },
      }),
  }),
  trading: z.object({
    coins: z.array(z.string()).default(['BTC', 'ETH', 'SOL']),
    cyclePeriod: z.number().default(180000), // 3 minutes in ms
    maxPositions: z.number().default(6),
    leverageRange: z.tuple([z.number(), z.number()]).default([5, 40]),
    stopLoss: z.number().default(0.05), // 5%
    maxRisk: z.number().default(0.05), // 5%
    marketFetchParallel: z.boolean().default(true),
    priceSanity: z
      .object({
        enabled: z.boolean().default(true),
        maxDeviation: z.number().min(0).max(1).default(0.05),
      })
      .default({ enabled: true, maxDeviation: 0.05 }),
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
  logging: z
    .object({
      level: z.enum(['error', 'warn', 'info', 'debug']).default('info'),
      fileOutput: z.boolean().default(true),
      logDir: z.string().default('./logs'),
      maxFileSize: z.number().default(10485760), // 10MB
      maxFiles: z.number().default(14), // 14 days
      backgroundMode: z.boolean().default(false), // auto-detect
    })
    .optional(),
  resilience: z
    .object({
      retry: z
        .object({
          maxRetries: z.number().default(3),
          baseDelay: z.number().default(1000), // milliseconds
          maxDelay: z.number().default(10000), // milliseconds
        })
        .default({ maxRetries: 3, baseDelay: 1000, maxDelay: 10000 }),
      circuitBreaker: z
        .object({
          failureThreshold: z.number().default(5),
          resetTimeout: z.number().default(60000), // milliseconds
          halfOpenMaxAttempts: z.number().default(3),
        })
        .default({ failureThreshold: 5, resetTimeout: 60000, halfOpenMaxAttempts: 3 }),
      rateLimit: z
        .object({
          openRouterRpm: z.number().default(20),
          exchangeRpm: z.number().default(60),
        })
        .default({ openRouterRpm: 20, exchangeRpm: 60 }),
      timeout: z
        .object({
          aiRequest: z.number().default(30000), // milliseconds
          exchangeRequest: z.number().default(10000), // milliseconds
          cycleMaxDuration: z.number().default(120000), // milliseconds
        })
        .default({ aiRequest: 30000, exchangeRequest: 10000, cycleMaxDuration: 120000 }),
      degradedMode: z
        .object({
          enabled: z.boolean().default(true),
          useMockAIOnFailure: z.boolean().default(false),
          maxConsecutiveErrors: z.number().default(5),
          pauseOnPersistentErrors: z.boolean().default(true),
        })
        .default({
          enabled: true,
          useMockAIOnFailure: false,
          maxConsecutiveErrors: 5,
          pauseOnPersistentErrors: true,
        }),
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
    model: 'deepseek/deepseek-chat-v3-0324',
    temperature: 0.7,
    prompt: {
      candles: { m3: 10, h4: 5 },
      sections: { candlesTA: true, sentiment: true, technicalState: true },
    },
  },
  trading: {
    coins: ['BTC', 'ETH', 'SOL'],
    cyclePeriod: 180000,
    maxPositions: 6,
    leverageRange: [5, 40],
    stopLoss: 0.05,
    maxRisk: 0.05,
    marketFetchParallel: true,
    priceSanity: {
      enabled: true,
      maxDeviation: 0.05,
    },
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
    mode: (process.env.EXCHANGE_MODE as 'live' | 'simulation' | 'paper') || 'simulation',
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
      prompt: {
        candles: {
          m3: parseInt(process.env.PROMPT_CANDLES_3M || '10'),
          h4: parseInt(process.env.PROMPT_CANDLES_4H || '5'),
        },
        sections: {
          candlesTA: process.env.PROMPT_SECTIONS_CANDLES_TA !== 'false',
          sentiment: process.env.PROMPT_SECTIONS_SENTIMENT !== 'false',
          technicalState: process.env.PROMPT_SECTIONS_TECH_STATE !== 'false',
        },
      },
    },
    trading: {
      coins,
      cyclePeriod: parseInt(process.env.CYCLE_PERIOD || '180000'),
      maxPositions: parseInt(process.env.MAX_POSITIONS || '6'),
      leverageRange: [
        parseInt(process.env.LEVERAGE_MIN || '5'),
        parseInt(process.env.LEVERAGE_MAX || '40'),
      ],
      stopLoss: parseFloat(process.env.STOP_LOSS || '0.05'),
      maxRisk: parseFloat(process.env.MAX_RISK || '0.05'),
      marketFetchParallel: process.env.TRADING_FETCH_PARALLEL !== 'false',
      priceSanity: {
        enabled: process.env.TRADING_PRICE_SANITY_ENABLED !== 'false',
        maxDeviation: parseFloat(process.env.TRADING_PRICE_SANITY_MAX_DEVIATION || '0.05'),
      },
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

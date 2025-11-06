import { UnifiedLogger } from '../logging/index.js';
import { z } from 'zod';
import fs from 'fs';
import path from 'path';
import dotenv from 'dotenv';
import { deepMerge } from '../utils/object.js';
import { normalizeMode, normalizeEnvironment } from '../types/index.js';

// Load environment variables
dotenv.config();

const ExchangeConfigSchema = z.object({
  name: z.string(),
  apiKey: z.string().optional(),
  apiSecret: z.string().optional(),
  testnet: z.boolean().default(true),
  marketType: z.enum(['spot', 'swap', 'perp', 'perpetual']).optional(),
});

// Simulation (CLI) configuration lives under config.json -> simulation
const SimulationConfigSchema = z.object({
  simulation: z
    .object({
      enabled: z.boolean().default(true),
      defaultInitialBalance: z.number().default(10000),
      defaultMaxPositions: z.number().default(6),
      defaultAI: z.enum(['mock', 'real']).default('mock'),
      autoRun: z.boolean().default(false),
      confirmBeforeExecute: z.boolean().default(true),
    })
    .default({
      enabled: true,
      defaultInitialBalance: 10000,
      defaultMaxPositions: 6,
      defaultAI: 'mock',
      autoRun: false,
      confirmBeforeExecute: true,
    }),
  scenarios: z
    .object({
      defaultCoins: z.array(z.string()).default(['BTC', 'ETH', 'SOL']),
      testScenarios: z.array(z.string()).default(['bullish', 'bearish', 'sideways', 'volatile']),
    })
    .default({
      defaultCoins: ['BTC', 'ETH', 'SOL'],
      testScenarios: ['bullish', 'bearish', 'sideways', 'volatile'],
    }),
  risk: z
    .object({
      minConfidence: z.number().default(0.5),
      maxRiskPerTrade: z.number().default(0.05),
      maxTotalRisk: z.number().default(0.3),
      stopLoss: z.number().default(0.03),
      takeProfit: z.number().default(0.06),
    })
    .default({
      minConfidence: 0.5,
      maxRiskPerTrade: 0.05,
      maxTotalRisk: 0.3,
      stopLoss: 0.03,
      takeProfit: 0.06,
    }),
  logging: z
    .object({
      verbose: z.boolean().default(false),
      logTrades: z.boolean().default(true),
      logPositions: z.boolean().default(true),
      logRiskMetrics: z.boolean().default(true),
      saveResults: z.boolean().default(false),
      resultsDir: z.string().default('./results'),
    })
    .default({
      verbose: false,
      logTrades: true,
      logPositions: true,
      logRiskMetrics: true,
      saveResults: false,
      resultsDir: './results',
    }),
  performance: z
    .object({
      trackPnL: z.boolean().default(true),
      trackDrawdown: z.boolean().default(true),
      calculateSharpeRatio: z.boolean().default(true),
      benchmark: z.string().default('BTC'),
    })
    .default({
      trackPnL: true,
      trackDrawdown: true,
      calculateSharpeRatio: true,
      benchmark: 'BTC',
    }),
  ai: z
    .object({
      mock: z
        .object({
          signalInterval: z.number().default(10000),
          confidenceRange: z
            .object({ min: z.number().default(0.5), max: z.number().default(0.95) })
            .default({ min: 0.5, max: 0.95 }),
        })
        .default({ signalInterval: 10000, confidenceRange: { min: 0.5, max: 0.95 } }),
      real: z
        .object({
          apiKey: z.string().optional(),
          model: z.string().default('deepseek/deepseek-chat'),
          temperature: z.number().min(0).max(2).default(0.7),
          maxRetries: z.number().default(3),
          timeout: z.number().default(30000),
        })
        .default({
          model: 'deepseek/deepseek-chat',
          temperature: 0.7,
          maxRetries: 3,
          timeout: 30000,
        }),
    })
    .default({
      mock: { signalInterval: 10000, confidenceRange: { min: 0.5, max: 0.95 } },
      real: { model: 'deepseek/deepseek-chat', temperature: 0.7, maxRetries: 3, timeout: 30000 },
    }),
});

// LangSmith tracing configuration under ai.tracing.langsmith
const LangsmithTracingSchema = z
  .object({
    enabled: z.boolean().default(false),
    project: z.string().optional().default(''),
    apiKey: z.string().optional().default(''),
    redact: z.boolean().default(true),
    includeSections: z
      .object({
        prompts: z.boolean().default(true),
        response: z.boolean().default(true),
        market: z.boolean().default(false),
      })
      .default({ prompts: true, response: true, market: false }),
  })
  .default({
    enabled: false,
    project: '',
    apiKey: '',
    redact: true,
    includeSections: { prompts: true, response: true, market: false },
  });

const AITracingSchema = z
  .object({
    langsmith: LangsmithTracingSchema,
  })
  .default({
    langsmith: {
      enabled: false,
      project: '',
      apiKey: '',
      redact: true,
      includeSections: { prompts: true, response: true, market: false },
    },
  });

const ConfigSchema = z.object({
  // Runtime targeting
  mode: z
    .enum(['arena', 'single'])
    .default('single')
    .describe("Execution mode: 'single' (single workflow) or 'arena' (multi-drone)."),
  env: z.enum(['live', 'paper', 'simulate']).default('simulate'),
  exchange: ExchangeConfigSchema,
  ai: z.object({
    provider: z.enum(['openrouter', 'openai', 'dashscope', 'deepseek']).default('openrouter'),
    temperature: z.number().min(0).max(2).default(0.7),
    // Legacy fields for backward compatibility (used when provider not specified)
    apiKey: z.string().optional(),
    model: z.string().optional(),
    baseUrl: z.string().optional(),
    // Provider-specific configurations
    openrouter: z
      .object({
        apiKey: z.string(),
        model: z.string().default('deepseek/deepseek-chat-v3-0324'),
        baseUrl: z.string().optional(),
        temperature: z.number().min(0).max(2).optional(),
      })
      .optional(),
    openai: z
      .object({
        apiKey: z.string(),
        model: z.string().default('gpt-4'),
        baseUrl: z.string().optional(),
        temperature: z.number().min(0).max(2).optional(),
      })
      .optional(),
    dashscope: z
      .object({
        apiKey: z.string(),
        model: z.string().default('qwen-max'),
        baseUrl: z.string().optional(),
        temperature: z.number().min(0).max(2).optional(),
      })
      .optional(),
    deepseek: z
      .object({
        apiKey: z.string(),
        model: z.string().default('deepseek-chat'),
        baseUrl: z.string().optional(),
        temperature: z.number().min(0).max(2).optional(),
      })
      .optional(),
    tracing: AITracingSchema.optional(),
    prompt: z.object({
      activeGroup: z.string(),
      candles: z
        .object({
          m3: z.number().int().min(1).max(200).default(10),
          h1: z.number().int().min(1).max(200).optional(),
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
    funding: z
      .object({
        warnings: z.boolean().default(true),
      })
      .default({ warnings: true }),
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
      // Scheme B: Output routing configuration
      output: z
        .object({
          debug: z
            .object({
              console: z.boolean().default(false),
              file: z.boolean().default(true),
              format: z.enum(['json', 'text']).default('json'),
              includeContext: z.boolean().default(true),
            })
            .optional(),
          info: z
            .object({
              console: z.boolean().default(true),
              file: z.boolean().default(false),
              format: z.enum(['json', 'text']).default('text'),
              includeContext: z.boolean().default(false),
            })
            .optional(),
          warn: z
            .object({
              console: z.boolean().default(true),
              file: z.boolean().default(true),
              format: z.enum(['json', 'text']).default('text'),
              includeContext: z.boolean().default(false),
            })
            .optional(),
          error: z
            .object({
              console: z.boolean().default(true),
              file: z.boolean().default(true),
              format: z.enum(['json', 'text']).default('text'),
              includeContext: z.boolean().default(true),
              includeStack: z.boolean().default(true),
            })
            .optional(),
        })
        .optional(),
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
  // Optional simulation settings (unified config)
  simulation: SimulationConfigSchema.optional(),
});

export type Config = z.infer<typeof ConfigSchema>;
export type ExchangeConfig = z.infer<typeof ExchangeConfigSchema>;

// Configuration file paths
const CONFIG_DIR = path.join(process.cwd(), 'config');
const CONFIG_FILE = path.join(CONFIG_DIR, 'config.json');
const CONFIG_EXAMPLE_FILE = path.join(CONFIG_DIR, 'config.example.json');

// Helpers for parsing environment variables safely
function parseNumberEnv(value: string | undefined, fallback: number): number {
  if (value === undefined) return fallback;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function parseIntegerEnv(value: string | undefined, fallback: number): number {
  if (value === undefined) return fallback;
  const parsed = parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function parseBooleanEnv(value: string | undefined, defaultTrue: boolean = true): boolean {
  if (value === undefined) return defaultTrue;
  const v = value.toLowerCase();
  if (['true', '1', 'yes', 'on'].includes(v)) return true;
  if (['false', '0', 'no', 'off'].includes(v)) return false;
  return defaultTrue;
}

// Default configuration
const DEFAULT_CONFIG: Partial<Config> = {
  mode: 'single',
  env: 'simulate',
  exchange: {
    name: 'simulator',
    testnet: true,
  },
  ai: {
    provider: 'openrouter',
    temperature: 0.7,
    apiKey: '', // Legacy field for backward compatibility
    model: 'deepseek/deepseek-chat-v3-0324', // Legacy field for backward compatibility
    baseUrl: undefined, // Legacy field for backward compatibility
    openrouter: {
      apiKey: '',
      model: 'deepseek/deepseek-chat-v3-0324',
      baseUrl: undefined, // Defaults to https://openrouter.ai/api/v1
    },
    openai: {
      apiKey: '',
      model: 'gpt-4',
      baseUrl: undefined, // Defaults to https://api.openai.com/v1
    },
    dashscope: {
      apiKey: '',
      model: 'qwen-max',
      baseUrl: undefined, // Defaults to https://dashscope.aliyuncs.com/api/v1
    },
    deepseek: {
      apiKey: '',
      model: 'deepseek-chat',
      baseUrl: undefined, // Defaults to https://api.deepseek.com/v1
    },
    tracing: {
      langsmith: {
        enabled: false,
        project: '',
        apiKey: '',
        redact: true,
        includeSections: { prompts: true, response: true, market: false },
      },
    },
    prompt: {
      activeGroup: 'default',
      candles: { m3: 10, h1: 8, h4: 5 },
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
    funding: {
      warnings: true,
    },
  },
  backtest: {
    initialBalance: 10000,
  },
  notifications: {
    enabled: false,
  },
  logging: {
    level: 'info',
    fileOutput: true,
    logDir: './logs',
    maxFileSize: 10485760,
    maxFiles: 14,
    backgroundMode: false,
    // Scheme B: Default output routing configuration
    output: {
      debug: {
        console: false,
        file: true,
        format: 'json',
        includeContext: true,
      },
      info: {
        console: true,
        file: false,
        format: 'text',
        includeContext: false,
      },
      warn: {
        console: true,
        file: true,
        format: 'text',
        includeContext: false,
      },
      error: {
        console: true,
        file: true,
        format: 'text',
        includeContext: true,
        includeStack: true,
      },
    },
  },
  simulation: {
    simulation: {
      enabled: true,
      defaultInitialBalance: 10000,
      defaultMaxPositions: 6,
      defaultAI: 'mock',
      autoRun: false,
      confirmBeforeExecute: true,
    },
    scenarios: {
      defaultCoins: ['BTC', 'ETH', 'SOL'],
      testScenarios: ['bullish', 'bearish', 'sideways', 'volatile'],
    },
    risk: {
      minConfidence: 0.5,
      maxRiskPerTrade: 0.05,
      maxTotalRisk: 0.3,
      stopLoss: 0.03,
      takeProfit: 0.06,
    },
    logging: {
      verbose: false,
      logTrades: true,
      logPositions: true,
      logRiskMetrics: true,
      saveResults: false,
      resultsDir: './results',
    },
    performance: {
      trackPnL: true,
      trackDrawdown: true,
      calculateSharpeRatio: true,
      benchmark: 'BTC',
    },
    ai: {
      mock: { signalInterval: 10000, confidenceRange: { min: 0.5, max: 0.95 } },
      real: { model: 'deepseek/deepseek-chat', temperature: 0.7, maxRetries: 3, timeout: 30000 },
    },
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
    UnifiedLogger.getInstance().warn(
      'Warning: Failed to load config file, using defaults:',
      error instanceof Error ? error : undefined,
      'Settings'
    );
  }
  return {};
}

function parseEnvConfig(): Partial<Config> {
  return {
    // New vars preferred; fall back to EXCHANGE_MODE for environment
    mode: normalizeMode(process.env.QUANTA_MODE || process.env.MODE),
    env: normalizeEnvironment(process.env.QUANTA_ENV || process.env.EXCHANGE_MODE || 'simulate'),
    exchange: {
      name: process.env.EXCHANGE_NAME || 'simulator',
      apiKey: process.env.EXCHANGE_API_KEY,
      apiSecret: process.env.EXCHANGE_API_SECRET,
      testnet: parseBooleanEnv(process.env.EXCHANGE_TESTNET, true),
      marketType: (process.env.EXCHANGE_MARKET_TYPE || undefined) as
        | 'spot'
        | 'swap'
        | 'perp'
        | 'perpetual'
        | undefined,
    },
    ai: {
      provider: (process.env.AI_PROVIDER || 'openrouter') as
        | 'openrouter'
        | 'openai'
        | 'dashscope'
        | 'deepseek',
      apiKey: process.env.OPENROUTER_API_KEY || '',
      model: process.env.OPENROUTER_MODEL || process.env.AI_MODEL || 'deepseek/deepseek-chat',
      temperature: parseNumberEnv(process.env.AI_TEMPERATURE, 0.7),
      baseUrl: process.env.OPENROUTER_BASE_URL || undefined,
      openrouter: {
        apiKey: process.env.OPENROUTER_API_KEY || '',
        model: process.env.OPENROUTER_MODEL || 'deepseek/deepseek-chat-v3-0324',
        baseUrl: process.env.OPENROUTER_BASE_URL || undefined,
        temperature: parseNumberEnv(process.env.OPENROUTER_TEMPERATURE, undefined),
      },
      openai: {
        apiKey: process.env.OPENAI_API_KEY || '',
        model: process.env.OPENAI_MODEL || 'gpt-4',
        baseUrl: process.env.OPENAI_BASE_URL || undefined,
        temperature: parseNumberEnv(process.env.OPENAI_TEMPERATURE, undefined),
      },
      dashscope: {
        apiKey: process.env.DASHSCOPE_API_KEY || '',
        model: process.env.DASHSCOPE_MODEL || 'qwen-max',
        baseUrl: process.env.DASHSCOPE_BASE_URL || undefined,
        temperature: parseNumberEnv(process.env.DASHSCOPE_TEMPERATURE, undefined),
      },
      deepseek: {
        apiKey: process.env.DEEPSEEK_API_KEY || '',
        model: process.env.DEEPSEEK_MODEL || 'deepseek-chat',
        baseUrl: process.env.DEEPSEEK_BASE_URL || undefined,
        temperature: parseNumberEnv(process.env.DEEPSEEK_TEMPERATURE, undefined),
      },
      tracing: {
        langsmith: {
          enabled: parseBooleanEnv(process.env.LANGCHAIN_TRACING_V2, false),
          project: process.env.LANGCHAIN_PROJECT || '',
          apiKey: process.env.LANGCHAIN_API_KEY || '',
          redact: parseBooleanEnv(process.env.LANGSMITH_REDACT, true),
          includeSections: {
            prompts: parseBooleanEnv(process.env.LANGSMITH_INCLUDE_PROMPTS, true),
            response: parseBooleanEnv(process.env.LANGSMITH_INCLUDE_RESPONSE, true),
            market: parseBooleanEnv(process.env.LANGSMITH_INCLUDE_MARKET, false),
          },
        },
      },
      prompt: {
        activeGroup: process.env.PROMPT_ACTIVE_GROUP || 'default',
        candles: {
          m3: parseIntegerEnv(process.env.PROMPT_CANDLES_3M, 10),
          h1: parseIntegerEnv(process.env.PROMPT_CANDLES_1H, 8),
          h4: parseIntegerEnv(process.env.PROMPT_CANDLES_4H, 5),
        },
        sections: {
          candlesTA: parseBooleanEnv(process.env.PROMPT_SECTIONS_CANDLES_TA, true),
          sentiment: parseBooleanEnv(process.env.PROMPT_SECTIONS_SENTIMENT, true),
          technicalState: parseBooleanEnv(process.env.PROMPT_SECTIONS_TECH_STATE, true),
        },
      },
    },
    trading: {
      ...(process.env.TRADING_COINS && {
        coins: process.env.TRADING_COINS.split(',').map(c => c.trim()),
      }),
      cyclePeriod: parseIntegerEnv(process.env.CYCLE_PERIOD, 180000),
      maxPositions: parseIntegerEnv(process.env.MAX_POSITIONS, 6),
      leverageRange: [
        parseIntegerEnv(process.env.LEVERAGE_MIN, 5),
        parseIntegerEnv(process.env.LEVERAGE_MAX, 40),
      ],
      stopLoss: parseNumberEnv(process.env.STOP_LOSS, 0.05),
      maxRisk: parseNumberEnv(process.env.MAX_RISK, 0.05),
      marketFetchParallel: parseBooleanEnv(process.env.TRADING_FETCH_PARALLEL, true),
      priceSanity: {
        enabled: parseBooleanEnv(process.env.TRADING_PRICE_SANITY_ENABLED, true),
        maxDeviation: parseNumberEnv(process.env.TRADING_PRICE_SANITY_MAX_DEVIATION, 0.05),
      },
      funding: {
        warnings: parseBooleanEnv(process.env.TRADING_FUNDING_WARNINGS, true),
      },
    },
    backtest: {
      startDate: process.env.BACKTEST_START_DATE,
      endDate: process.env.BACKTEST_END_DATE,
      initialBalance: parseNumberEnv(process.env.BACKTEST_INITIAL_BALANCE, 10000),
    },
    notifications: {
      enabled: parseBooleanEnv(process.env.NOTIFICATIONS_ENABLED, false),
      webhook: process.env.NOTIFICATION_WEBHOOK,
    },
    logging: {
      level: (process.env.LOG_LEVEL || undefined) as
        | 'error'
        | 'warn'
        | 'info'
        | 'debug'
        | undefined,
      fileOutput: parseBooleanEnv(process.env.LOG_FILE_OUTPUT, true),
      logDir: process.env.LOG_DIR || undefined,
      maxFileSize: parseIntegerEnv(process.env.LOG_MAX_FILE_SIZE, 10485760),
      maxFiles: parseIntegerEnv(process.env.LOG_MAX_FILES, 14),
      backgroundMode: parseBooleanEnv(process.env.LOG_BACKGROUND_MODE, false),
    },
  };
}

let globalConfig: Config | null = null;

type RiskProfile = {
  leverageRange: [number, number];
  stopLoss: [number, number];
  maxRisk: [number, number];
  maxPositions: [number, number];
};

function deriveRiskProfile(marketType?: string | null): RiskProfile | null {
  const mt = (marketType || '').toLowerCase();
  if (mt === 'swap' || mt === 'perp' || mt === 'perpetual') {
    return {
      leverageRange: [3, 10],
      stopLoss: [0.01, 0.02],
      maxRisk: [0.01, 0.02],
      maxPositions: [1, 4],
    };
  }
  if (mt === 'spot') {
    return {
      leverageRange: [1, 1],
      stopLoss: [0.03, 0.07],
      maxRisk: [0.03, 0.05],
      maxPositions: [6, 10],
    };
  }
  return null;
}

function applyRiskProfileToConfig(cfg: Partial<Config>): Partial<Config> {
  const profile = deriveRiskProfile(cfg.exchange?.marketType);
  if (!profile) return cfg;

  const trading = cfg.trading ?? {};

  const [levMin, levMax] = profile.leverageRange;
  const [slMin, slMax] = profile.stopLoss;
  const [riskMin, riskMax] = profile.maxRisk;
  const [posMin, posMax] = profile.maxPositions;

  const result: Partial<Config> = deepMerge(
    cfg as Record<string, unknown>,
    {
      trading: {
        leverageRange: trading.leverageRange ?? [levMin, levMax],
        stopLoss:
          typeof trading.stopLoss === 'number'
            ? trading.stopLoss
            : Math.min(Math.max(DEFAULT_CONFIG.trading?.stopLoss ?? slMin, slMin), slMax),
        maxRisk:
          typeof trading.maxRisk === 'number'
            ? trading.maxRisk
            : Math.min(Math.max(DEFAULT_CONFIG.trading?.maxRisk ?? riskMin, riskMin), riskMax),
        maxPositions:
          typeof trading.maxPositions === 'number'
            ? trading.maxPositions
            : Math.min(Math.max(DEFAULT_CONFIG.trading?.maxPositions ?? posMin, posMin), posMax),
      },
    } as unknown as Record<string, unknown>
  ) as Partial<Config>;

  return result;
}

export function getConfig(): Config {
  if (!globalConfig) {
    // Ensure config directory exists
    ensureConfigDir();
    createExampleConfig();

    // Load configuration from multiple sources (file > env > defaults)
    const fileConfig = loadConfigFromFile();
    const envConfig = parseEnvConfig();

    // Merge configurations (file config takes precedence over env config)
    // Deep merge precedence: defaults < env < file
    let mergedConfig = deepMerge(
      deepMerge(DEFAULT_CONFIG as Record<string, unknown>, envConfig as Record<string, unknown>),
      fileConfig as Record<string, unknown>
    ) as Partial<Config>;

    // Normalize mode and environment values
    mergedConfig.mode = normalizeMode((mergedConfig as any).mode);
    mergedConfig.env = normalizeEnvironment((mergedConfig as any).env as string);

    // Apply marketType-aware risk profile to fill in safe defaults where not explicitly set
    mergedConfig = applyRiskProfileToConfig(mergedConfig);

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
    UnifiedLogger.getInstance().info(`Configuration saved to ${CONFIG_FILE}`, {}, 'Settings');
  } catch (error) {
    UnifiedLogger.getInstance().error(
      'Failed to save configuration:',
      error instanceof Error ? error : undefined,
      'Settings'
    );
    throw error;
  }
}

export function resetConfig(): void {
  try {
    if (fs.existsSync(CONFIG_FILE)) {
      fs.unlinkSync(CONFIG_FILE);
    }
    globalConfig = null;
    UnifiedLogger.getInstance().info('Configuration reset to defaults', {}, 'Settings');
  } catch (error) {
    UnifiedLogger.getInstance().error(
      'Failed to reset configuration:',
      error instanceof Error ? error : undefined,
      'Settings'
    );
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

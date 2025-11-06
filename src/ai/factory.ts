/**
 * AI Client Factory
 * Creates appropriate AI client based on configuration
 */

import type { Config } from '../config/settings.js';
import { OpenRouterClient } from './agent.js';
import { OpenAIClient } from './openai-client.js';
import { DashScopeClient } from './dashscope-client.js';
import { DeepseekClient } from './deepseek-client.js';
import { OllamaClient } from './ollama-client.js';
import type { IAIClient } from './types.js';
import { AIClientError } from './agent.js';
import { UnifiedLogger } from '../logging/index.js';

interface ProviderConfig {
  apiKey?: string;
  model: string;
  temperature: number;
  baseUrl?: string;
}

interface ProviderConfigOptions {
  requireApiKey: boolean;
  defaultModel: string;
  errorMessage: string;
}

/**
 * Get provider configuration with fallback to legacy config
 */
function getProviderConfig(
  config: Config,
  providerName: string,
  options: ProviderConfigOptions
): ProviderConfig | null {
  const providerConfig = (config.ai as Record<string, unknown>)[providerName] as
    | { apiKey?: string; model?: string; temperature?: number; baseUrl?: string }
    | undefined;

  // Check provider-specific config
  if (providerConfig) {
    if (options.requireApiKey && !providerConfig.apiKey) {
      return null;
    }
    return {
      apiKey: providerConfig.apiKey,
      model: providerConfig.model || config.ai.model || options.defaultModel,
      temperature: providerConfig.temperature ?? config.ai.temperature ?? 0.7,
      baseUrl: providerConfig.baseUrl,
    };
  }

  // Fallback to legacy config for backward compatibility
  if (config.ai.apiKey) {
    return {
      apiKey: config.ai.apiKey,
      model: config.ai.model || options.defaultModel,
      temperature: config.ai.temperature ?? 0.7,
      baseUrl: config.ai.baseUrl,
    };
  }

  return null;
}

/**
 * Create provider client with common validation and logging
 */
function createProviderClient<T extends IAIClient>(
  providerName: string,
  providerConfig: ProviderConfig | null,
  errorMessage: string,
  clientFactory: (config: ProviderConfig, promptGroup: string) => T,
  promptGroup: string,
  logger: UnifiedLogger,
  context: string
): T {
  if (!providerConfig) {
    throw new AIClientError(errorMessage);
  }

  logger.debug(
    `Creating ${providerName} client with model: ${providerConfig.model}`,
    {
      provider: providerName,
      model: providerConfig.model,
    },
    context
  );

  return clientFactory(providerConfig, promptGroup);
}

/**
 * Create AI client based on configuration
 * Supports backward compatibility with legacy config format
 */
export function createAIClient(config: Config): IAIClient {
  const logger = UnifiedLogger.getInstance();
  const context = 'AIClientFactory';
  const provider = config.ai.provider || 'openrouter';
  const promptGroup = config.ai.prompt.activeGroup;

  switch (provider) {
    case 'openrouter': {
      const providerConfig = getProviderConfig(config, 'openrouter', {
        requireApiKey: true,
        defaultModel: 'deepseek/deepseek-chat',
        errorMessage:
          'OpenRouter configuration is missing. Please set ai.openrouter.apiKey in config.json or use legacy ai.apiKey field.',
      });
      return createProviderClient(
        'OpenRouter',
        providerConfig,
        'OpenRouter configuration is missing. Please set ai.openrouter.apiKey in config.json or use legacy ai.apiKey field.',
        (cfg, pg) => new OpenRouterClient(cfg.apiKey!, cfg.model, cfg.temperature, pg, cfg.baseUrl),
        promptGroup,
        logger,
        context
      );
    }

    case 'openai': {
      const providerConfig = getProviderConfig(config, 'openai', {
        requireApiKey: true,
        defaultModel: 'gpt-4',
        errorMessage:
          'OpenAI configuration is missing. Please set ai.openai.apiKey in config.json.',
      });
      return createProviderClient(
        'OpenAI',
        providerConfig,
        'OpenAI configuration is missing. Please set ai.openai.apiKey in config.json.',
        (cfg, pg) => new OpenAIClient(cfg.apiKey!, cfg.model, cfg.temperature, pg, cfg.baseUrl),
        promptGroup,
        logger,
        context
      );
    }

    case 'dashscope': {
      const providerConfig = getProviderConfig(config, 'dashscope', {
        requireApiKey: true,
        defaultModel: 'qwen-max',
        errorMessage:
          'DashScope configuration is missing. Please set ai.dashscope.apiKey in config.json.',
      });
      return createProviderClient(
        'DashScope',
        providerConfig,
        'DashScope configuration is missing. Please set ai.dashscope.apiKey in config.json.',
        (cfg, pg) => new DashScopeClient(cfg.apiKey!, cfg.model, cfg.temperature, pg, cfg.baseUrl),
        promptGroup,
        logger,
        context
      );
    }

    case 'deepseek': {
      const providerConfig = getProviderConfig(config, 'deepseek', {
        requireApiKey: true,
        defaultModel: 'deepseek-chat',
        errorMessage:
          'Deepseek configuration is missing. Please set ai.deepseek.apiKey in config.json.',
      });
      return createProviderClient(
        'Deepseek',
        providerConfig,
        'Deepseek configuration is missing. Please set ai.deepseek.apiKey in config.json.',
        (cfg, pg) => new DeepseekClient(cfg.apiKey!, cfg.model, cfg.temperature, pg, cfg.baseUrl),
        promptGroup,
        logger,
        context
      );
    }

    case 'ollama': {
      // Ollama doesn't require an API key, so we handle it separately
      const ollamaConfig = (config.ai as Record<string, unknown>).ollama as
        | { apiKey?: string; model?: string; temperature?: number; baseUrl?: string }
        | undefined;

      if (!ollamaConfig || !ollamaConfig.model) {
        throw new AIClientError(
          'Ollama configuration is missing. Please set ai.ollama.model in config.json. Note: apiKey is optional for local Ollama instances.'
        );
      }

      const ollamaProviderConfig: ProviderConfig = {
        apiKey: ollamaConfig.apiKey,
        model: ollamaConfig.model || config.ai.model || 'llama2',
        temperature: ollamaConfig.temperature ?? config.ai.temperature ?? 0.7,
        baseUrl: ollamaConfig.baseUrl,
      };

      logger.info(
        `Creating Ollama client with model: ${ollamaProviderConfig.model}`,
        {
          provider: 'ollama',
          model: ollamaProviderConfig.model,
          baseUrl: ollamaProviderConfig.baseUrl || 'http://localhost:11434',
        },
        context
      );

      return new OllamaClient(
        ollamaProviderConfig.apiKey,
        ollamaProviderConfig.model,
        ollamaProviderConfig.temperature,
        promptGroup,
        ollamaProviderConfig.baseUrl
      );
    }

    default:
      throw new AIClientError(
        `Unsupported AI provider: ${provider}. Supported providers: openrouter, openai, dashscope, deepseek, ollama`
      );
  }
}

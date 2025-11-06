/**
 * AI Client Factory
 * Creates appropriate AI client based on configuration
 */

import type { Config } from '../config/settings.js';
import { OpenRouterClient } from './agent.js';
import { OpenAIClient } from './openai-client.js';
import { DashScopeClient } from './dashscope-client.js';
import { DeepseekClient } from './deepseek-client.js';
import type { IAIClient } from './types.js';
import { AIClientError } from './agent.js';
import { UnifiedLogger } from '../logging/index.js';

/**
 * Create AI client based on configuration
 * Supports backward compatibility with legacy config format
 */
export function createAIClient(config: Config): IAIClient {
  const logger = UnifiedLogger.getInstance();
  const context = 'AIClientFactory';
  const provider = config.ai.provider || 'openrouter';

  // Helper to get provider config with fallback to legacy config
  const getProviderConfig = (providerName: string) => {
    const providerConfig = (config.ai as any)[providerName];
    if (providerConfig && providerConfig.apiKey) {
      return {
        apiKey: providerConfig.apiKey,
        model: providerConfig.model || config.ai.model || 'deepseek/deepseek-chat',
        temperature: providerConfig.temperature ?? config.ai.temperature ?? 0.7,
        baseUrl: providerConfig.baseUrl,
      };
    }
    // Fallback to legacy config for backward compatibility
    if (config.ai.apiKey) {
      return {
        apiKey: config.ai.apiKey,
        model: config.ai.model || 'deepseek/deepseek-chat',
        temperature: config.ai.temperature ?? 0.7,
        baseUrl: config.ai.baseUrl,
      };
    }
    return null;
  };

  switch (provider) {
    case 'openrouter': {
      const providerConfig = getProviderConfig('openrouter');
      if (!providerConfig) {
        throw new AIClientError(
          'OpenRouter configuration is missing. Please set ai.openrouter.apiKey in config.json or use legacy ai.apiKey field.'
        );
      }
      logger.info(
        `Creating OpenRouter client with model: ${providerConfig.model}`,
        { provider: 'openrouter', model: providerConfig.model },
        context
      );
      return new OpenRouterClient(
        providerConfig.apiKey,
        providerConfig.model,
        providerConfig.temperature,
        config.ai.prompt.activeGroup,
        providerConfig.baseUrl
      );
    }

    case 'openai': {
      const providerConfig = getProviderConfig('openai');
      if (!providerConfig) {
        throw new AIClientError(
          'OpenAI configuration is missing. Please set ai.openai.apiKey in config.json.'
        );
      }
      logger.info(
        `Creating OpenAI client with model: ${providerConfig.model}`,
        { provider: 'openai', model: providerConfig.model },
        context
      );
      return new OpenAIClient(
        providerConfig.apiKey,
        providerConfig.model,
        providerConfig.temperature,
        config.ai.prompt.activeGroup,
        providerConfig.baseUrl
      );
    }

    case 'dashscope': {
      const providerConfig = getProviderConfig('dashscope');
      if (!providerConfig) {
        throw new AIClientError(
          'DashScope configuration is missing. Please set ai.dashscope.apiKey in config.json.'
        );
      }
      logger.info(
        `Creating DashScope client with model: ${providerConfig.model}`,
        { provider: 'dashscope', model: providerConfig.model },
        context
      );
      return new DashScopeClient(
        providerConfig.apiKey,
        providerConfig.model,
        providerConfig.temperature,
        config.ai.prompt.activeGroup,
        providerConfig.baseUrl
      );
    }

    case 'deepseek': {
      const providerConfig = getProviderConfig('deepseek');
      if (!providerConfig) {
        throw new AIClientError(
          'Deepseek configuration is missing. Please set ai.deepseek.apiKey in config.json.'
        );
      }
      logger.info(
        `Creating Deepseek client with model: ${providerConfig.model}`,
        { provider: 'deepseek', model: providerConfig.model },
        context
      );
      return new DeepseekClient(
        providerConfig.apiKey,
        providerConfig.model,
        providerConfig.temperature,
        config.ai.prompt.activeGroup,
        providerConfig.baseUrl
      );
    }

    default:
      throw new AIClientError(
        `Unsupported AI provider: ${provider}. Supported providers: openrouter, openai, dashscope, deepseek`
      );
  }
}

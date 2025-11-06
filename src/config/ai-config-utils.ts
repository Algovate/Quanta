/**
 * AI Configuration Utilities
 * Helper functions for extracting AI provider configuration
 */

import type { Config } from './settings.js';

export interface AIProviderInfo {
  provider: 'openrouter' | 'openai' | 'dashscope' | 'deepseek' | 'ollama';
  model: string;
  temperature: number;
  apiKey?: string;
  baseUrl?: string;
}

/**
 * Get AI provider information from config
 * Returns provider name, model, and temperature with fallback logic
 */
export function getAIProviderInfo(config: Config): AIProviderInfo {
  const provider = (config.ai.provider || 'openrouter') as
    | 'openrouter'
    | 'openai'
    | 'dashscope'
    | 'deepseek'
    | 'ollama';

  const providerConfig = (config.ai as any)[provider];

  // Get model with fallback: provider config -> legacy config -> default
  const model =
    providerConfig?.model ||
    config.ai.model ||
    (provider === 'openrouter'
      ? 'deepseek/deepseek-chat-v3-0324'
      : provider === 'openai'
        ? 'gpt-4'
        : provider === 'dashscope'
          ? 'qwen-max'
          : provider === 'ollama'
            ? 'llama2'
            : 'deepseek-chat');

  // Get temperature with fallback: provider config -> legacy config -> default
  const temperature = providerConfig?.temperature ?? config.ai.temperature ?? 0.7;

  return {
    provider,
    model,
    temperature,
    apiKey: providerConfig?.apiKey || config.ai.apiKey,
    baseUrl: providerConfig?.baseUrl || config.ai.baseUrl,
  };
}

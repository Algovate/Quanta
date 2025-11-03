import { traceable } from 'langsmith/traceable';
import { getConfig } from '../config/settings.js';
import { UnifiedLogger } from '../logging/index.js';

type IncludeSections = {
  prompts: boolean;
  response: boolean;
  market: boolean;
};

export type LangsmithTracingOptions = {
  enabled: boolean;
  project?: string;
  apiKey?: string;
  redact: boolean;
  includeSections: IncludeSections;
};

let initialized = false;
const logger = UnifiedLogger.getInstance();
const loggerContext = 'LangSmithTracer';

/**
 * Initialize LangChain tracing from config.
 * Maps config settings to environment variables that LangChain uses.
 */
export function initLangSmithTracing(): void {
  if (initialized) return;
  initialized = true;

  try {
    const cfg = getConfig();
    const tracingConfig = cfg.ai?.tracing?.langsmith;

    if (!tracingConfig?.enabled) {
      return;
    }

    // Map config to LangChain environment variables
    const apiKey = tracingConfig.apiKey || process.env.LANGCHAIN_API_KEY;
    const project = tracingConfig.project || process.env.LANGCHAIN_PROJECT || 'default';

    if (!apiKey) {
      logger.warn(
        'LangSmith tracing enabled but no API key found in config or LANGCHAIN_API_KEY',
        {},
        loggerContext
      );
      return;
    }

    // Set environment variables for LangChain to use
    // These are read by langsmith/traceable automatically
    if (!process.env.LANGCHAIN_API_KEY) {
      process.env.LANGCHAIN_API_KEY = apiKey;
    }
    if (!process.env.LANGCHAIN_PROJECT) {
      process.env.LANGCHAIN_PROJECT = project;
    }
    if (!process.env.LANGCHAIN_TRACING_V2) {
      process.env.LANGCHAIN_TRACING_V2 = 'true';
    }

    logger.info(
      'LangSmith tracing initialized',
      {
        project,
        hasApiKey: !!apiKey,
      },
      loggerContext
    );
  } catch (err) {
    logger.warn(
      'LangSmith tracing initialization failed',
      {
        error: err instanceof Error ? err.message : String(err),
      },
      loggerContext
    );
  }
}

/**
 * Redact sensitive information from payloads
 */
export function safePayload<T>(payload: T, shouldRedact: boolean = true): T {
  if (!shouldRedact) return payload;
  try {
    const json = JSON.stringify(payload);
    const masked = json
      .replace(/sk-[a-zA-Z0-9_-]{10,}/g, 'sk-***')
      .replace(/api[_-]?key"?\s*:\s*"[^"]+"/gi, 'apiKey:"***"')
      .replace(/Authorization":\s*"Bearer [^"]+"/gi, 'Authorization:"Bearer ***"');
    return JSON.parse(masked);
  } catch {
    return '[redacted]' as unknown as T;
  }
}

/**
 * Get tracing configuration from config file
 */
export function getTracingConfig(): LangsmithTracingOptions {
  const cfg = getConfig();
  const tracingConfig = cfg.ai?.tracing?.langsmith;

  return {
    enabled: tracingConfig?.enabled ?? false,
    project: tracingConfig?.project || process.env.LANGCHAIN_PROJECT || 'default',
    apiKey: tracingConfig?.apiKey || process.env.LANGCHAIN_API_KEY || '',
    redact: tracingConfig?.redact ?? true,
    includeSections: (tracingConfig?.includeSections as IncludeSections) || {
      prompts: true,
      response: true,
      market: false,
    },
  };
}

/**
 * Format prompt for trace inclusion
 */
export function formatPromptForTrace(
  prompt: string,
  redact: boolean = true
): {
  system_prompt: string;
  user_prompt: string;
} {
  const safePrompt = redact ? (safePayload(prompt) as string) : prompt;

  // Split prompt into system and user parts
  // No need for full_prompt as it's redundant (system + separator + user)
  const separator = '\n---USER---\n';
  const sepIdx = safePrompt.indexOf(separator);
  const systemPrompt = sepIdx >= 0 ? safePrompt.substring(0, sepIdx).trim() : '';
  const userPrompt =
    sepIdx >= 0 ? safePrompt.substring(sepIdx + separator.length).trim() : safePrompt;

  return {
    system_prompt: systemPrompt,
    user_prompt: userPrompt,
  };
}

/**
 * Format response for trace inclusion
 */
export function formatResponseForTrace(response: string, redact: boolean = true): string {
  return redact ? (safePayload(response) as string) : response;
}

/**
 * Build trace inputs by attaching prompt sections when enabled in config
 */
export function buildTraceInputs(
  baseInputs: Record<string, unknown>,
  prompt: string,
  tracingConfig: LangsmithTracingOptions
): Record<string, unknown> {
  if (!tracingConfig.enabled || !tracingConfig.includeSections?.prompts) return baseInputs;
  const promptData = formatPromptForTrace(prompt, tracingConfig.redact);
  return { ...baseInputs, ...promptData };
}

/**
 * Build trace outputs by attaching raw API response when enabled in config
 */
export function buildTraceOutputs(
  baseOutputs: Record<string, unknown>,
  apiResponse: string,
  tracingConfig: LangsmithTracingOptions
): Record<string, unknown> {
  if (!tracingConfig.enabled || !tracingConfig.includeSections?.response) return baseOutputs;
  return {
    ...baseOutputs,
    api_response: formatResponseForTrace(apiResponse, tracingConfig.redact),
  };
}

/**
 * Re-export traceable for convenience
 */
export { traceable };

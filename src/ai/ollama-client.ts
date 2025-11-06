/**
 * Ollama Client Implementation
 * Supports Ollama models via local or remote Ollama API
 */

import axios from 'axios';
import { withRetry, createRetryConfig } from '../utils/retry.js';
import { CircuitBreaker, createCircuitBreaker } from '../utils/circuit-breaker.js';
import { AIClientError } from './agent.js';
import { BaseAIClient } from './base-ai-client.js';

export class OllamaClient extends BaseAIClient {
  private apiKey?: string;
  private model: string;
  private baseUrl: string;
  private temperature: number;
  protected readonly providerName = 'Ollama';
  protected readonly defaultBaseUrl = 'http://localhost:11434';
  private circuitBreaker: CircuitBreaker;

  constructor(
    apiKey: string | undefined,
    model: string = 'llama2',
    temperature: number = 0.7,
    promptGroupName?: string,
    baseUrl?: string
  ) {
    super(promptGroupName);
    this.validateConfig(apiKey, model, baseUrl);

    this.apiKey = apiKey;
    this.model = model;
    this.baseUrl = baseUrl || this.defaultBaseUrl;
    this.temperature = temperature;
    this.circuitBreaker = createCircuitBreaker(this.providerName, {
      failureThreshold: 5,
      resetTimeout: 60000,
      halfOpenMaxAttempts: 2,
    });
  }

  protected getModel(): string {
    return this.model;
  }

  protected getTemperature(): number {
    return this.temperature;
  }

  static validateConfig(_apiKey: string | undefined, model: string, baseUrl?: string): void {
    const errors: string[] = [];

    // Ollama doesn't require an API key, but we validate model
    if (!model || model.trim().length === 0) {
      errors.push(
        'AI model is missing or empty. Please set ai.ollama.model in config.json (e.g., "llama2", "mistral", "qwen").'
      );
    }

    if (baseUrl) {
      try {
        const url = new URL(baseUrl);
        if (!['http:', 'https:'].includes(url.protocol)) {
          errors.push(`Invalid baseUrl protocol: ${url.protocol}. Must be http:// or https://`);
        }
      } catch {
        errors.push(
          `Invalid baseUrl format: ${baseUrl}. Must be a valid URL (e.g., http://localhost:11434)`
        );
      }
    }

    if (errors.length > 0) {
      throw new AIClientError(
        `Ollama configuration validation failed:\n${errors.map(e => `  - ${e}`).join('\n')}`
      );
    }
  }

  private validateConfig(apiKey: string | undefined, model: string, baseUrl?: string): void {
    OllamaClient.validateConfig(apiKey, model, baseUrl);
  }

  private translateOllamaError(error: unknown): Error {
    const errorObj = error as {
      response?: { status?: number; statusText?: string; data?: { error?: string } };
      code?: string;
      message?: string;
    };
    if (errorObj.response?.status) {
      const status = errorObj.response.status;
      const statusText = errorObj.response.statusText || '';
      const errorData = errorObj.response.data;

      let userFriendlyMessage: string;

      switch (status) {
        case 400:
          userFriendlyMessage = `Ollama API Error (400): Invalid request. ${errorData?.error || statusText || 'Please check your request parameters.'}`;
          break;
        case 401:
          userFriendlyMessage = `Ollama API Error (401): Unauthorized. ${errorData?.error || statusText || 'Please check your authentication.'}`;
          break;
        case 404:
          userFriendlyMessage = `Ollama API Error (404): Model not found. The model "${this.model}" may not be available. Please ensure it is pulled using "ollama pull ${this.model}". ${errorData?.error || statusText || ''}`;
          break;
        case 429:
          userFriendlyMessage = `Ollama API Error (429): Rate Limit Exceeded. Please wait before retrying.`;
          break;
        default:
          if (status >= 400 && status < 500) {
            userFriendlyMessage = `Ollama API Error (${status}): ${statusText || 'Client Error'}. ${errorData?.error || ''}`;
          } else if (status >= 500) {
            userFriendlyMessage = `Ollama API Error (${status}): Server Error. Ollama service may be experiencing issues. Please check if Ollama is running and try again.`;
          } else {
            userFriendlyMessage = errorObj.message || String(error);
          }
      }

      if (status >= 400 && status < 500 && status !== 429) {
        const originalError = error instanceof Error ? error : new Error(String(error));
        throw new AIClientError(userFriendlyMessage, status, originalError);
      }

      const translatedError = error instanceof Error ? error : new Error(userFriendlyMessage);
      translatedError.message = userFriendlyMessage;
      if (errorObj.response) {
        (translatedError as { response?: unknown }).response = errorObj.response;
      }
      if (errorObj.code) {
        (translatedError as { code?: string }).code = errorObj.code;
      }
      return translatedError;
    }

    if (errorObj.code === 'ECONNABORTED' || errorObj.message?.includes('timeout')) {
      const message = `Ollama API Error: Request timeout. The request took too long to complete. Please check if Ollama is running and try again.`;
      const translatedError = error instanceof Error ? error : new Error(message);
      translatedError.message = message;
      if (errorObj.code) {
        (translatedError as { code?: string }).code = errorObj.code;
      }
      return translatedError;
    }

    if (errorObj.code === 'ECONNREFUSED' || errorObj.code === 'ENOTFOUND') {
      const message = `Ollama API Error: Connection refused. Please ensure Ollama is running at ${this.baseUrl}. You can start Ollama with "ollama serve" or check your baseUrl configuration.`;
      const translatedError = error instanceof Error ? error : new Error(message);
      translatedError.message = message;
      if (errorObj.code) {
        (translatedError as { code?: string }).code = errorObj.code;
      }
      return translatedError;
    }

    return error instanceof Error ? error : new Error(`Ollama API Error: ${String(error)}`);
  }

  protected async callAPI(prompt: string): Promise<string> {
    return await this.circuitBreaker.execute(
      async () => {
        return await withRetry(
          async () => {
            try {
              const separator = '\n---USER---\n';
              const sepIdx = prompt.indexOf(separator);
              const systemPrompt = sepIdx >= 0 ? prompt.substring(0, sepIdx).trim() : '';
              const userPrompt =
                sepIdx >= 0 ? prompt.substring(sepIdx + separator.length).trim() : prompt.trim();

              // Build messages array
              const messages: Array<{ role: string; content: string }> = [];
              if (systemPrompt) {
                messages.push({
                  role: 'system',
                  content: systemPrompt,
                });
              }
              messages.push({
                role: 'user',
                content: userPrompt,
              });

              const apiUrl = `${this.baseUrl}/api/chat`;
              const response = await axios.post(
                apiUrl,
                {
                  model: this.model,
                  messages: messages,
                  options: {
                    temperature: this.temperature,
                  },
                  stream: false,
                },
                {
                  headers: {
                    ...(this.apiKey && { Authorization: `Bearer ${this.apiKey}` }),
                    'Content-Type': 'application/json',
                  },
                  timeout: 60000, // Ollama may take longer for local models
                }
              );

              // Ollama returns { message: { content: string } }
              return response.data.message?.content || response.data.response || '';
            } catch (error) {
              throw this.translateOllamaError(error);
            }
          },
          createRetryConfig({
            maxRetries: 3,
            baseDelay: 2000,
            maxDelay: 15000,
            timeout: 60000,
            shouldRetry: (error: unknown) => {
              const errorObj = error as {
                isClientError?: boolean;
                message?: string;
                statusCode?: number;
                response?: { status?: number };
              };
              if (error instanceof AIClientError || errorObj.isClientError) {
                this.logger.warn(
                  'Not retrying Ollama API call due to AI client error',
                  {
                    message: errorObj.message,
                    status: errorObj.statusCode ?? errorObj.response?.status,
                  },
                  this.providerName
                );
                return false;
              }
              if (
                errorObj.response?.status &&
                errorObj.response.status >= 400 &&
                errorObj.response.status < 500 &&
                errorObj.response.status !== 429
              ) {
                this.logger.warn(
                  'Not retrying Ollama API call due to client error',
                  {
                    status: errorObj.response.status,
                    message: errorObj.message,
                  },
                  this.providerName
                );
                return false;
              }
              return true;
            },
            onRetry: (attempt: number, error: unknown) => {
              const errorObj = error as { message?: string; response?: { status?: number } };
              this.logger.warn(
                'Retrying Ollama API call',
                {
                  attempt,
                  error: error instanceof Error ? error.message : String(error),
                  status: errorObj.response?.status,
                },
                this.providerName
              );
            },
          })
        );
      },
      async () => {
        this.logger.error(
          'Ollama circuit breaker is OPEN, returning empty response',
          new Error('Circuit breaker open'),
          this.providerName
        );
        return '{"signals": []}';
      }
    );
  }
}

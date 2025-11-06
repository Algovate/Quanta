/**
 * DashScope Client Implementation
 * Supports Alibaba DashScope API for Qwen models
 * API endpoint: https://dashscope.aliyuncs.com/api/v1/services/aigc/text-generation/generation
 */

import axios from 'axios';
import { withRetry, createRetryConfig } from '../utils/retry.js';
import { CircuitBreaker, createCircuitBreaker } from '../utils/circuit-breaker.js';
import { AIClientError } from './agent.js';
import { BaseAIClient } from './base-ai-client.js';

export class DashScopeClient extends BaseAIClient {
  private apiKey: string;
  private model: string;
  private baseUrl: string;
  private temperature: number;
  protected readonly providerName = 'DashScope';
  protected readonly defaultBaseUrl = 'https://dashscope.aliyuncs.com/api/v1';
  private circuitBreaker: CircuitBreaker;

  constructor(
    apiKey: string,
    model: string = 'qwen-max',
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

  static validateConfig(apiKey: string, model: string, baseUrl?: string): void {
    const errors: string[] = [];

    if (!apiKey || apiKey.trim().length === 0) {
      errors.push(
        'DASHSCOPE_API_KEY is missing or empty. Please set it in config.json or environment variables.'
      );
    }

    if (!model || model.trim().length === 0) {
      errors.push(
        'AI model is missing or empty. Please set ai.dashscope.model in config.json or DASHSCOPE_MODEL environment variable.'
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
          `Invalid baseUrl format: ${baseUrl}. Must be a valid URL (e.g., https://dashscope.aliyuncs.com/api/v1)`
        );
      }
    }

    if (errors.length > 0) {
      throw new AIClientError(
        `DashScope configuration validation failed:\n${errors.map(e => `  - ${e}`).join('\n')}`
      );
    }
  }

  private validateConfig(apiKey: string, model: string, baseUrl?: string): void {
    DashScopeClient.validateConfig(apiKey, model, baseUrl);
  }

  private translateDashScopeError(error: any): any {
    if (error.response?.status) {
      const status = error.response.status;
      const statusText = error.response.statusText || '';
      const errorData = error.response.data;

      let userFriendlyMessage: string;

      switch (status) {
        case 400:
          userFriendlyMessage = `DashScope API Error (400): Invalid request. ${errorData?.message || errorData?.error?.message || statusText || 'Please check your request parameters.'}`;
          break;
        case 401:
          userFriendlyMessage = `DashScope API Error (401): Unauthorized. Your API key is invalid or missing. Please verify your DASHSCOPE_API_KEY in config.json or environment variables.`;
          break;
        case 402:
          userFriendlyMessage = `DashScope API Error (402): Payment Required. Your DashScope account has insufficient credits or requires payment. Please check your account balance.`;
          break;
        case 403:
          userFriendlyMessage = `DashScope API Error (403): Forbidden. Your API key does not have permission to access this resource. ${errorData?.message || errorData?.error?.message || statusText || ''}`;
          break;
        case 404:
          userFriendlyMessage = `DashScope API Error (404): Not Found. The requested model or endpoint was not found. ${errorData?.message || errorData?.error?.message || statusText || ''}`;
          break;
        case 429:
          userFriendlyMessage = `DashScope API Error (429): Rate Limit Exceeded. You have exceeded the rate limit for your API key. Please wait before retrying or upgrade your plan.`;
          break;
        default:
          if (status >= 400 && status < 500) {
            userFriendlyMessage = `DashScope API Error (${status}): ${statusText || 'Client Error'}. ${errorData?.message || errorData?.error?.message || ''}`;
          } else if (status >= 500) {
            userFriendlyMessage = `DashScope API Error (${status}): Server Error. DashScope is experiencing issues. Please try again later.`;
          } else {
            userFriendlyMessage = error.message || String(error);
          }
      }

      if (status >= 400 && status < 500 && status !== 429) {
        const originalError = error instanceof Error ? error : new Error(String(error));
        throw new AIClientError(userFriendlyMessage, status, originalError);
      }

      const translatedError = error instanceof Error ? error : new Error(userFriendlyMessage);
      translatedError.message = userFriendlyMessage;
      if (error.response) {
        (translatedError as any).response = error.response;
      }
      if (error.code) {
        (translatedError as any).code = error.code;
      }
      return translatedError;
    }

    if (error.code === 'ECONNABORTED' || error.message?.includes('timeout')) {
      const message = `DashScope API Error: Request timeout. The request took too long to complete. Please check your network connection and try again.`;
      const translatedError = error instanceof Error ? error : new Error(message);
      translatedError.message = message;
      if (error.code) {
        (translatedError as any).code = error.code;
      }
      return translatedError;
    }

    if (error.code === 'ENOTFOUND' || error.code === 'ECONNREFUSED') {
      const message = `DashScope API Error: Network error. Unable to connect to DashScope API. Please check your internet connection.`;
      const translatedError = error instanceof Error ? error : new Error(message);
      translatedError.message = message;
      if (error.code) {
        (translatedError as any).code = error.code;
      }
      return translatedError;
    }

    return error instanceof Error ? error : new Error(`DashScope API Error: ${String(error)}`);
  }

  protected async callAPI(prompt: string): Promise<string> {
    return await this.circuitBreaker.execute(
      async () => {
        return await withRetry(
          async () => {
            try {
              const separator = '\n---USER---\n';
              const sepIdx = prompt.indexOf(separator);
              const systemPrompt = sepIdx >= 0 ? prompt.substring(0, sepIdx).trim() : prompt;
              const userPrompt =
                sepIdx >= 0 ? prompt.substring(sepIdx + separator.length).trim() : '';

              const apiUrl = `${this.baseUrl}/services/aigc/text-generation/generation`;
              const response = await axios.post(
                apiUrl,
                {
                  model: this.model,
                  input: {
                    messages: [
                      {
                        role: 'system',
                        content: systemPrompt,
                      },
                      {
                        role: 'user',
                        content: userPrompt,
                      },
                    ],
                  },
                  parameters: {
                    temperature: this.temperature,
                    max_tokens: 4000,
                  },
                },
                {
                  headers: {
                    Authorization: `Bearer ${this.apiKey}`,
                    'Content-Type': 'application/json',
                    'X-DashScope-SSE': 'disable',
                  },
                  timeout: 30000,
                }
              );

              // DashScope API response structure
              if (response.data.output?.choices?.[0]?.message?.content) {
                return response.data.output.choices[0].message.content;
              }
              throw new Error('Invalid response format from DashScope API');
            } catch (error) {
              throw this.translateDashScopeError(error);
            }
          },
          createRetryConfig({
            maxRetries: 3,
            baseDelay: 2000,
            maxDelay: 15000,
            timeout: 30000,
            shouldRetry: (error: any) => {
              if (error instanceof AIClientError || (error && error.isClientError)) {
                this.logger.warn(
                  'Not retrying DashScope API call due to AI client error',
                  {
                    message: error.message,
                    status: (error as any)?.statusCode ?? (error as any)?.response?.status,
                  },
                  this.providerName
                );
                return false;
              }
              if (
                error.response?.status &&
                error.response.status >= 400 &&
                error.response.status < 500 &&
                error.response.status !== 429
              ) {
                this.logger.warn(
                  'Not retrying DashScope API call due to client error',
                  {
                    status: error.response.status,
                    message: error.message,
                  },
                  this.providerName
                );
                return false;
              }
              return true;
            },
            onRetry: (attempt: number, error: any) => {
              this.logger.warn(
                'Retrying DashScope API call',
                {
                  attempt,
                  error: error instanceof Error ? error.message : String(error),
                  status: error.response?.status,
                },
                this.providerName
              );
            },
          })
        );
      },
      async () => {
        this.logger.error(
          'DashScope circuit breaker is OPEN, returning empty response',
          new Error('Circuit breaker open'),
          this.providerName
        );
        return '{"signals": []}';
      }
    );
  }
}

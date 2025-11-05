import { UnifiedLogger } from '../logging/index.js';

export interface RetryConfig {
  maxRetries: number;
  baseDelay: number; // milliseconds
  maxDelay: number; // milliseconds
  timeout?: number; // milliseconds
  shouldRetry?: (error: any) => boolean;
  onRetry?: (attempt: number, error: any) => void;
}

export class RetryError extends Error {
  constructor(
    message: string,
    public attempts: number,
    public lastError: any
  ) {
    super(message);
    this.name = 'RetryError';
  }
}

const logger = UnifiedLogger.getInstance();
const loggerContext = 'Retry';

/**
 * Default retry predicate - retry on network errors, timeouts, and 5xx errors
 * Do not retry on client errors (4xx) or validation errors
 */
export function defaultShouldRetry(error: any): boolean {
  // Axios errors
  if (error.code === 'ECONNABORTED' || error.code === 'ETIMEDOUT') {
    return true;
  }

  // Network errors
  if (
    error.code === 'ENOTFOUND' ||
    error.code === 'ECONNREFUSED' ||
    error.code === 'ECONNRESET' ||
    error.code === 'EPIPE'
  ) {
    return true;
  }

  // Abort errors (from request cancellation)
  if (error.message === 'aborted' || error.name === 'AbortError') {
    return true;
  }

  // HTTP status codes
  if (error.response?.status) {
    const status = error.response.status;
    // Retry on 5xx server errors and 429 rate limit
    if (status >= 500 || status === 429) {
      return true;
    }
    // Don't retry on 4xx client errors (except 429)
    if (status >= 400 && status < 500) {
      return false;
    }
  }

  // Unknown errors - be conservative and retry
  return true;
}

/**
 * Calculate delay with exponential backoff and jitter
 * @param attempt - Current attempt number (0-indexed)
 * @param baseDelay - Base delay in milliseconds
 * @param maxDelay - Maximum delay in milliseconds
 * @returns Delay in milliseconds with jitter applied
 */
function calculateDelay(attempt: number, baseDelay: number, maxDelay: number): number {
  // Exponential backoff: baseDelay * 2^attempt
  const exponentialDelay = baseDelay * Math.pow(2, attempt);

  // Cap at maxDelay
  const cappedDelay = Math.min(exponentialDelay, maxDelay);

  // Add jitter (random value between 0 and 25% of delay)
  // This prevents thundering herd problem
  const jitter = Math.random() * 0.25 * cappedDelay;

  return Math.floor(cappedDelay + jitter);
}

/**
 * Retry a function with exponential backoff
 * @param fn - Async function to retry
 * @param config - Retry configuration
 * @returns Result of the function
 * @throws RetryError if all retries are exhausted
 */
export async function withRetry<T>(fn: () => Promise<T>, config: RetryConfig): Promise<T> {
  const {
    maxRetries,
    baseDelay,
    maxDelay,
    timeout,
    shouldRetry = defaultShouldRetry,
    onRetry,
  } = config;

  let lastError: any;
  let attempt = 0;

  while (attempt <= maxRetries) {
    try {
      // Apply timeout if specified
      if (timeout) {
        const timeoutPromise = new Promise<never>((_, reject) => {
          setTimeout(() => reject(new Error('Operation timeout')), timeout);
        });
        return await Promise.race([fn(), timeoutPromise]);
      } else {
        return await fn();
      }
    } catch (error) {
      lastError = error;

      // Check if we should retry this error
      const shouldRetryError = shouldRetry(error);

      // Log retry attempt
      const isAIClientError =
        error && ((error as any).isClientError || (error as any).name === 'AIClientError');
      if (!isAIClientError) {
        logger.debug(
          'Function failed, checking retry eligibility',
          {
            attempt: attempt + 1,
            maxRetries,
            shouldRetry: shouldRetryError,
            error: error instanceof Error ? error.message : String(error),
          },
          loggerContext
        );
      }

      // If this was the last attempt or we shouldn't retry, throw
      if (attempt >= maxRetries || !shouldRetryError) {
        // If the error is an AIClientError, propagate it directly without wrapping
        // This allows the workflow to stop immediately on client errors
        if (error && (error.isClientError || error.name === 'AIClientError')) {
          throw error;
        }
        throw new RetryError(
          `Failed after ${attempt + 1} attempt(s): ${error instanceof Error ? error.message : String(error)}`,
          attempt + 1,
          error
        );
      }

      // Calculate delay for next attempt
      const delay = calculateDelay(attempt, baseDelay, maxDelay);

      // Call onRetry callback if provided
      if (onRetry) {
        onRetry(attempt + 1, error);
      }

      if (shouldRetryError) {
        logger.info(
          'Retrying after delay',
          {
            attempt: attempt + 1,
            delay,
            error: error instanceof Error ? error.message : String(error),
          },
          loggerContext
        );
      }

      // Wait before retrying
      await new Promise(resolve => setTimeout(resolve, delay));

      attempt++;
    }
  }

  // This should never be reached, but TypeScript doesn't know that
  throw new RetryError(`Failed after ${attempt} attempt(s)`, attempt, lastError);
}

/**
 * Create a retry configuration with sensible defaults
 */
export function createRetryConfig(overrides?: Partial<RetryConfig>): RetryConfig {
  return {
    maxRetries: 3,
    baseDelay: 1000,
    maxDelay: 10000,
    shouldRetry: defaultShouldRetry,
    ...overrides,
  };
}

/**
 * Decorator for retrying async methods
 * Usage:
 *   @retryable({ maxRetries: 3, baseDelay: 1000 })
 *   async myMethod() { ... }
 */
export function retryable(config: Partial<RetryConfig> = {}) {
  return function (_target: any, _propertyKey: string, descriptor: PropertyDescriptor) {
    const originalMethod = descriptor.value;

    descriptor.value = async function (...args: any[]) {
      return withRetry(() => originalMethod.apply(this, args), createRetryConfig(config));
    };

    return descriptor;
  };
}

import { UnifiedLogger } from '../logging/index.js';

export interface CircuitBreakerConfig {
  failureThreshold: number; // Number of failures before opening circuit
  resetTimeout: number; // Time in ms before attempting to close circuit
  halfOpenMaxAttempts: number; // Max attempts in half-open state before deciding
  name?: string; // Name for logging
}

export type CircuitState = 'CLOSED' | 'OPEN' | 'HALF_OPEN';

export interface CircuitBreakerStats {
  state: CircuitState;
  failureCount: number;
  successCount: number;
  lastFailureTime: number | null;
  lastSuccessTime: number | null;
  consecutiveFailures: number;
  consecutiveSuccesses: number;
}

export class CircuitBreakerError extends Error {
  constructor(
    message: string,
    public state: CircuitState,
    public stats: CircuitBreakerStats
  ) {
    super(message);
    this.name = 'CircuitBreakerError';
  }
}

/**
 * Circuit Breaker implementation to prevent cascading failures
 *
 * States:
 * - CLOSED: Normal operation, requests pass through
 * - OPEN: Circuit is open due to failures, requests fail fast
 * - HALF_OPEN: Testing if service recovered, limited requests allowed
 *
 * State transitions:
 * - CLOSED -> OPEN: After failureThreshold consecutive failures
 * - OPEN -> HALF_OPEN: After resetTimeout expires
 * - HALF_OPEN -> CLOSED: After halfOpenMaxAttempts successful requests
 * - HALF_OPEN -> OPEN: After any failure in half-open state
 */
export class CircuitBreaker {
  private state: CircuitState = 'CLOSED';
  private failureCount: number = 0;
  private successCount: number = 0;
  private consecutiveFailures: number = 0;
  private consecutiveSuccesses: number = 0;
  private lastFailureTime: number | null = null;
  private lastSuccessTime: number | null = null;
  private halfOpenAttempts: number = 0;
  private logger: UnifiedLogger;
  private readonly context: string;

  constructor(private config: CircuitBreakerConfig) {
    this.logger = UnifiedLogger.getInstance();
    this.context = `CircuitBreaker:${config.name || 'default'}`;
    this.logger.info(
      'Circuit breaker initialized',
      {
        failureThreshold: config.failureThreshold,
        resetTimeout: config.resetTimeout,
        halfOpenMaxAttempts: config.halfOpenMaxAttempts,
      },
      this.context
    );
  }

  /**
   * Get current circuit breaker statistics
   */
  getStats(): CircuitBreakerStats {
    return {
      state: this.state,
      failureCount: this.failureCount,
      successCount: this.successCount,
      lastFailureTime: this.lastFailureTime,
      lastSuccessTime: this.lastSuccessTime,
      consecutiveFailures: this.consecutiveFailures,
      consecutiveSuccesses: this.consecutiveSuccesses,
    };
  }

  /**
   * Get current state
   */
  getState(): CircuitState {
    return this.state;
  }

  /**
   * Reset circuit breaker to closed state
   */
  reset(): void {
    this.logger.info('Circuit breaker manually reset', {}, this.context);
    this.state = 'CLOSED';
    this.failureCount = 0;
    this.successCount = 0;
    this.consecutiveFailures = 0;
    this.consecutiveSuccesses = 0;
    this.lastFailureTime = null;
    this.lastSuccessTime = null;
    this.halfOpenAttempts = 0;
  }

  /**
   * Execute function with circuit breaker protection
   * @param fn - Function to execute
   * @param fallback - Optional fallback function to call when circuit is open
   * @returns Result of fn or fallback
   * @throws CircuitBreakerError if circuit is open and no fallback provided
   */
  async execute<T>(fn: () => Promise<T>, fallback?: () => Promise<T>): Promise<T> {
    // Check if we should transition from OPEN to HALF_OPEN
    if (this.state === 'OPEN') {
      const now = Date.now();
      const timeSinceLastFailure = this.lastFailureTime ? now - this.lastFailureTime : 0;

      if (timeSinceLastFailure >= this.config.resetTimeout) {
        this.logger.info(
          'Circuit breaker transitioning to HALF_OPEN',
          {
            timeSinceLastFailure,
            resetTimeout: this.config.resetTimeout,
          },
          this.context
        );
        this.state = 'HALF_OPEN';
        this.halfOpenAttempts = 0;
      } else {
        // Circuit is open, fail fast
        this.logger.warn(
          'Circuit breaker is OPEN, failing fast',
          {
            timeSinceLastFailure,
            resetTimeout: this.config.resetTimeout,
          },
          this.context
        );

        if (fallback) {
          this.logger.info('Using fallback function', {}, this.context);
          return await fallback();
        }

        throw new CircuitBreakerError(
          `Circuit breaker is OPEN for ${this.config.name || 'service'}. Try again in ${Math.ceil((this.config.resetTimeout - timeSinceLastFailure) / 1000)}s`,
          this.state,
          this.getStats()
        );
      }
    }

    // Execute the function
    try {
      const result = await fn();
      this.onSuccess();
      return result;
    } catch (error) {
      // If this is an AIClientError, propagate it immediately without using fallback
      // This allows the workflow to stop on client errors (e.g., 402 Payment Required)
      if (error && ((error as any).isClientError || (error as any).name === 'AIClientError')) {
        throw error;
      }

      this.onFailure(error);

      // If we have a fallback and circuit is open, use it
      // Note: onFailure might have changed state to OPEN
      if (fallback && this.getState() === 'OPEN') {
        this.logger.info('Circuit opened, using fallback function', {}, this.context);
        return await fallback();
      }

      throw error;
    }
  }

  /**
   * Handle successful execution
   */
  private onSuccess(): void {
    this.successCount++;
    this.consecutiveSuccesses++;
    this.consecutiveFailures = 0;
    this.lastSuccessTime = Date.now();

    if (this.state === 'HALF_OPEN') {
      this.halfOpenAttempts++;
      this.logger.debug(
        'Success in HALF_OPEN state',
        {
          halfOpenAttempts: this.halfOpenAttempts,
          maxAttempts: this.config.halfOpenMaxAttempts,
        },
        this.context
      );

      // If we've had enough successful attempts in half-open, close the circuit
      if (this.halfOpenAttempts >= this.config.halfOpenMaxAttempts) {
        this.logger.info(
          'Circuit breaker transitioning to CLOSED',
          {
            halfOpenAttempts: this.halfOpenAttempts,
            successCount: this.successCount,
          },
          this.context
        );
        this.state = 'CLOSED';
        this.consecutiveFailures = 0;
        this.halfOpenAttempts = 0;
      }
    }
  }

  /**
   * Handle failed execution
   */
  private onFailure(error: any): void {
    // Skip logging in onFailure if this is an AI client error; it should have been propagated.
    if (error && ((error as any).isClientError || (error as any).name === 'AIClientError')) {
      return;
    }
    this.failureCount++;
    this.consecutiveFailures++;
    this.consecutiveSuccesses = 0;
    this.lastFailureTime = Date.now();

    this.logger.warn(
      'Circuit breaker recorded failure',
      {
        state: this.state,
        consecutiveFailures: this.consecutiveFailures,
        failureThreshold: this.config.failureThreshold,
        error: error instanceof Error ? error.message : String(error),
      },
      this.context
    );

    // Transition based on current state
    if (this.state === 'HALF_OPEN') {
      // Any failure in half-open state opens the circuit immediately
      this.logger.warn(
        'Circuit breaker transitioning to OPEN from HALF_OPEN',
        {
          error: error instanceof Error ? error.message : String(error),
        },
        this.context
      );
      this.state = 'OPEN';
      this.halfOpenAttempts = 0;
    } else if (this.state === 'CLOSED') {
      // Open circuit if we've exceeded the failure threshold
      if (this.consecutiveFailures >= this.config.failureThreshold) {
        this.logger.error(
          'Circuit breaker transitioning to OPEN from CLOSED',
          new Error(
            `Consecutive failures: ${this.consecutiveFailures}, threshold: ${this.config.failureThreshold}`
          ),
          this.context
        );
        this.state = 'OPEN';
      }
    }
  }

  /**
   * Force circuit to open state
   */
  forceOpen(): void {
    this.logger.warn('Circuit breaker manually forced to OPEN', {}, this.context);
    this.state = 'OPEN';
    this.lastFailureTime = Date.now();
  }

  /**
   * Force circuit to closed state
   */
  forceClose(): void {
    this.logger.info('Circuit breaker manually forced to CLOSED', {}, this.context);
    this.reset();
  }
}

/**
 * Create a circuit breaker with default configuration
 */
export function createCircuitBreaker(
  name: string,
  overrides?: Partial<CircuitBreakerConfig>
): CircuitBreaker {
  return new CircuitBreaker({
    failureThreshold: 5,
    resetTimeout: 60000, // 1 minute
    halfOpenMaxAttempts: 3,
    name,
    ...overrides,
  });
}

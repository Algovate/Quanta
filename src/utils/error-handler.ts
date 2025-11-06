import {
  QuantaError,
  ExchangeError,
  AIError,
  ValidationError,
  UserFriendlyError,
} from '../types/index.js';
import { UnifiedLogger } from '../logging/index.js';

/**
 * Normalize unknown error to Error instance
 * Converts any error-like value to a proper Error object
 * This is useful for error handling where we need to ensure we have an Error instance
 */
export function toError(error: unknown): Error {
  if (error instanceof Error) {
    return error;
  }
  return new Error(String(error));
}

/**
 * Check if an error is a UserFriendlyError
 */
export function isUserFriendlyError(error: unknown): error is UserFriendlyError {
  return error instanceof UserFriendlyError;
}

/**
 * Handle UserFriendlyError by logging message and exiting gracefully
 * Returns a promise that never resolves to prevent propagation
 */
function handleUserFriendlyError(error: UserFriendlyError): Promise<never> {
  const logger = UnifiedLogger.getInstance();
  // Log the error message directly (without error object to avoid stack trace)
  logger.error(error.message, undefined, 'ErrorHandler');
  // Exit immediately - logger will flush automatically on process exit
  // Use setImmediate to ensure exit happens after current event loop tick
  // but before any promise rejection handlers can run
  setImmediate(() => {
    process.exit(1);
  });
  // Return a promise that never resolves to prevent propagation
  // This prevents commander.js from catching the rejection
  return new Promise(() => {
    // Never resolves, keeps promise pending until process exits
  });
}

export class ErrorHandler {
  static handle(error: unknown, context?: string): QuantaError {
    // Preserve UserFriendlyError as-is (don't wrap)
    if (error instanceof UserFriendlyError) {
      return error;
    }

    if (error instanceof QuantaError) {
      return error;
    }

    if (error instanceof Error) {
      return new QuantaError(error.message, 'UNKNOWN_ERROR', {
        originalError: error.message,
        context,
      });
    }

    return new QuantaError('An unknown error occurred', 'UNKNOWN_ERROR', { error, context });
  }

  static createExchangeError(message: string, context?: Record<string, unknown>): ExchangeError {
    return new ExchangeError(message, context);
  }

  static createAIError(message: string, context?: Record<string, unknown>): AIError {
    return new AIError(message, context);
  }

  static createValidationError(
    message: string,
    context?: Record<string, unknown>
  ): ValidationError {
    return new ValidationError(message, context);
  }

  static logError(error: QuantaError): void {
    // Skip logging user-friendly errors as they're already logged by handleAsync
    if (isUserFriendlyError(error)) {
      return;
    }

    // After the type guard, error is a QuantaError (not UserFriendlyError)
    // Access properties directly since QuantaError has these properties
    const logger = UnifiedLogger.getInstance();
    const code = (error as QuantaError).code;
    const message = (error as QuantaError).message;
    const context = (error as QuantaError).context;
    logger.error(`[${code}] ${message}`, undefined, 'ErrorHandler');
    this.logContext(context);
  }

  private static logContext(context?: Record<string, unknown>): void {
    if (!context) return;

    const logger = UnifiedLogger.getInstance();
    const contextObj = context as Record<string, unknown>;

    // Extract and clean original error message
    if (typeof contextObj.originalError === 'string') {
      const cleaned = this.cleanErrorMessage(contextObj.originalError);
      logger.error(`Error: ${cleaned}`, undefined, 'ErrorHandler');
    }

    // Show additional context (excluding originalError)
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const { originalError: _originalError, ...otherContext } = contextObj;
    if (Object.keys(otherContext).length > 0) {
      logger.error(`Context: ${JSON.stringify(otherContext, null, 2)}`, undefined, 'ErrorHandler');
    }
  }

  private static cleanErrorMessage(msg: string): string {
    // Remove stack traces
    let cleaned = msg
      .split('\n')
      .filter(line => !line.trim().startsWith('at '))
      .join('\n');

    // Truncate long messages
    if (cleaned.length > 300) {
      cleaned = cleaned.substring(0, 300) + '...';
    }

    // Extract error from CCXT JSON
    const match = cleaned.match(/"msg":\s*"([^"]+)"/);
    return match ? match[1] : cleaned;
  }
}

export const handleAsync = async <T>(operation: () => Promise<T>, context?: string): Promise<T> => {
  try {
    return await operation();
  } catch (error) {
    // For user-friendly errors, handle gracefully and exit
    if (isUserFriendlyError(error)) {
      return handleUserFriendlyError(error) as Promise<T>;
    }

    // For other errors, log with context
    const handledError = ErrorHandler.handle(error, context);
    ErrorHandler.logError(handledError);
    throw handledError;
  }
};

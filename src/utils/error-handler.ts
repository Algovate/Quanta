import { QuantaError, ExchangeError, AIError, ValidationError } from '../types/index.js';
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

export class ErrorHandler {
  static handle(error: unknown, context?: string): QuantaError {
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
    const logger = UnifiedLogger.getInstance();
    logger.error(`[${error.code}] ${error.message}`, undefined, 'ErrorHandler');
    this.logContext(error.context);
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
    const logger = UnifiedLogger.getInstance();

    // For user-friendly errors, show clean message without stack trace
    if (error instanceof Error) {
      const isUserFriendlyError =
        error.message.includes('Configuration Error') ||
        error.message.includes('Missing API') ||
        error.message.includes('requires API') ||
        error.message.includes('Invalid mode');

      if (isUserFriendlyError) {
        // Log the error message directly and signal non-zero exit
        logger.error(error.message, error, 'ErrorHandler');
        process.exitCode = 1;
        throw error;
      }
    }

    // For other errors, log with context
    const handledError = ErrorHandler.handle(error, context);
    ErrorHandler.logError(handledError);
    throw handledError;
  }
};

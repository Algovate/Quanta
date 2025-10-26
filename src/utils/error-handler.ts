import { BetaArenaError, ExchangeError, AIError, ValidationError } from '../types';

export class ErrorHandler {
  static handle(error: unknown, context?: string): BetaArenaError {
    if (error instanceof BetaArenaError) {
      return error;
    }

    if (error instanceof Error) {
      return new BetaArenaError(error.message, 'UNKNOWN_ERROR', {
        originalError: error.message,
        context,
      });
    }

    return new BetaArenaError('An unknown error occurred', 'UNKNOWN_ERROR', { error, context });
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

  static logError(error: BetaArenaError): void {
    console.error(`\n[${error.code}] ${error.message}`);

    // Show concise context if available
    if (error.context) {
      const context = error.context as Record<string, unknown>;

      // Extract original error message if available
      if (context.originalError && typeof context.originalError === 'string') {
        // Extract just the important part of long error messages
        const originalMsg = context.originalError as string;
        const cleanedMsg = this.cleanErrorMessage(originalMsg);
        if (cleanedMsg !== error.message) {
          console.error(`\nError details: ${cleanedMsg}`);
        }
      }

      // Show context if it's not just repeating the error
      const otherContext = { ...context };
      delete otherContext.originalError;
      if (Object.keys(otherContext).length > 0 && otherContext.context) {
        console.error(`Context: ${otherContext.context}`);
      }
    }
  }

  private static cleanErrorMessage(errorMsg: string): string {
    // Remove excessive stack traces and redundant information
    let cleaned = errorMsg;

    // Remove stack trace lines (they start with "   at ")
    cleaned = cleaned
      .split('\n')
      .filter(line => !line.trim().startsWith('at '))
      .join('\n');

    // Truncate very long messages
    if (cleaned.length > 500) {
      cleaned = cleaned.substring(0, 500) + '...';
    }

    // Extract key error message from CCXT errors
    if (cleaned.includes('msg":')) {
      const match = cleaned.match(/"msg":\s*"([^"]+)"/);
      if (match && match[1]) {
        cleaned = match[1];
      }
    }

    return cleaned;
  }
}

export const handleAsync = async <T>(operation: () => Promise<T>, context?: string): Promise<T> => {
  try {
    return await operation();
  } catch (error) {
    const handledError = ErrorHandler.handle(error, context);
    ErrorHandler.logError(handledError);
    throw handledError;
  }
};

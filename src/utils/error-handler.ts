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
    console.error(`[${error.code}] ${error.message}`);
    if (error.context) {
      console.error('Context:', error.context);
    }
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

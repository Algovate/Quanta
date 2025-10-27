import { QuantaError, ExchangeError, AIError, ValidationError } from '../types/index.js';

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
    console.error(`\n[${error.code}] ${error.message}`);
    this.logContext(error.context);
  }

  private static logContext(context?: Record<string, unknown>): void {
    if (!context) return;

    const contextObj = context as Record<string, unknown>;

    // Extract and clean original error message
    if (typeof contextObj.originalError === 'string') {
      const cleaned = this.cleanErrorMessage(contextObj.originalError);
      console.error(`Error: ${cleaned}`);
    }

    // Show additional context (excluding originalError)
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const { originalError: _originalError, ...otherContext } = contextObj;
    if (Object.keys(otherContext).length > 0) {
      console.error(`Context: ${JSON.stringify(otherContext, null, 2)}`);
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
    const handledError = ErrorHandler.handle(error, context);
    ErrorHandler.logError(handledError);
    throw handledError;
  }
};

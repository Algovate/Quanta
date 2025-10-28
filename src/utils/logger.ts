/**
 * Structured logging utility
 * Replaces console.error with proper error tracking
 */

export enum LogLevel {
  ERROR = 'error',
  WARN = 'warn',
  INFO = 'info',
  DEBUG = 'debug',
}

export type LogMetadata = Record<string, unknown>;

export class Logger {
  private static instance: Logger;
  private context: string;

  constructor(context: string = 'Quanta') {
    this.context = context;
  }

  static getInstance(context?: string): Logger {
    if (!Logger.instance) {
      Logger.instance = new Logger(context);
    }
    return Logger.instance;
  }

  private log(level: LogLevel, message: string, error?: unknown, metadata?: LogMetadata): void {
    const timestamp = new Date().toISOString();
    const formattedMessage = `[${timestamp}] [${level.toUpperCase()}] [${this.context}] ${message}`;

    // Include error details if provided
    const logData: Record<string, unknown> = {
      message: formattedMessage,
      ...metadata,
    };

    if (error) {
      logData.error = error instanceof Error ? error.message : String(error);
      logData.stack = error instanceof Error ? error.stack : undefined;
    }

    // Output to console with appropriate method
    switch (level) {
      case LogLevel.ERROR:
        console.error(JSON.stringify(logData, null, 2));
        break;
      case LogLevel.WARN:
        console.warn(message, metadata || '');
        break;
      case LogLevel.INFO:
        console.log(message, metadata || '');
        break;
      case LogLevel.DEBUG:
        console.log(`[DEBUG] ${message}`, metadata || '');
        break;
    }
  }

  error(context: string, error: unknown, metadata?: LogMetadata): void {
    this.log(LogLevel.ERROR, context, error, metadata);
  }

  warn(message: string, metadata?: LogMetadata): void {
    this.log(LogLevel.WARN, message, undefined, metadata);
  }

  info(message: string, metadata?: LogMetadata): void {
    this.log(LogLevel.INFO, message, undefined, metadata);
  }

  debug(message: string, metadata?: LogMetadata): void {
    this.log(LogLevel.DEBUG, message, undefined, metadata);
  }
}

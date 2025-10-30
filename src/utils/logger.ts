/**
 * Enhanced logging utility with file rotation, dual output, and background mode
 * Supports both file-based structured logs (JSON) and console output (formatted)
 */

import fs from 'fs';
import path from 'path';
import { LogLevel, LogMetadata, LogConfig, BufferedLogEntry } from './logger-types.js';
import { LogFormatter } from './logger-formatter.js';
import { LogRotation } from './logger-rotation.js';

export class Logger {
  private static instance: Logger;
  private static currentLogDate: string = '';

  private context: string;
  private config: LogConfig;
  private writeBuffer: BufferedLogEntry[] = [];
  private flushTimer?: NodeJS.Timeout;
  private isShuttingDown = false;

  private formatter: LogFormatter;
  private rotation: LogRotation;

  constructor(context: string = 'Quanta') {
    this.context = context;
    this.config = this.createConfig();

    this.formatter = new LogFormatter(this.config, this.context);
    this.rotation = new LogRotation(this.config);

    if (this.config.fileOutput) {
      this.ensureLogDirectory();
      this.rotation.cleanupOldLogs();
    }

    this.setupShutdownHandler();
  }

  static getInstance(context?: string): Logger {
    if (!Logger.instance) {
      Logger.instance = new Logger(context);
    }
    if (context && Logger.instance.context !== context) {
      Logger.instance.context = context;
      Logger.instance.formatter = new LogFormatter(Logger.instance.config, context);
    }
    return Logger.instance;
  }

  private createConfig(): LogConfig {
    return {
      level: this.parseLogLevel(process.env.LOG_LEVEL || 'info'),
      fileOutput: process.env.LOG_FILE_OUTPUT !== 'false',
      logDir: process.env.LOG_DIR || './logs',
      maxFileSize: parseInt(process.env.LOG_MAX_SIZE || '10485760', 10), // 10MB default
      maxFiles: parseInt(process.env.LOG_MAX_FILES || '14', 10), // 14 days default
      backgroundMode: this.detectBackgroundMode(),
    };
  }

  private parseLogLevel(level: string): LogLevel {
    const levelMap: Record<string, LogLevel> = {
      error: LogLevel.ERROR,
      warn: LogLevel.WARN,
      info: LogLevel.INFO,
      debug: LogLevel.DEBUG,
    };
    return levelMap[level.toLowerCase()] || LogLevel.INFO;
  }

  private detectBackgroundMode(): boolean {
    if (process.env.BACKGROUND_MODE) {
      return process.env.BACKGROUND_MODE.toLowerCase() === 'true';
    }
    return !process.stdout.isTTY;
  }

  private ensureLogDirectory(): void {
    if (!fs.existsSync(this.config.logDir)) {
      fs.mkdirSync(this.config.logDir, { recursive: true });
    }
  }

  private getCurrentLogDate(): string {
    return new Date().toISOString().split('T')[0];
  }

  private getLogFilePath(filename: string): string {
    return path.join(this.config.logDir, filename);
  }

  private shouldLog(level: LogLevel): boolean {
    const levels = [LogLevel.ERROR, LogLevel.WARN, LogLevel.INFO, LogLevel.DEBUG];
    const configLevelIndex = levels.indexOf(this.config.level);
    const entryLevelIndex = levels.indexOf(level);
    return entryLevelIndex <= configLevelIndex;
  }

  private addToBuffer(entry: BufferedLogEntry): void {
    // Add entry atomically
    this.writeBuffer.push(entry);
    const bufferLength = this.writeBuffer.length;

    // Flush immediately if buffer is full
    if (bufferLength >= 50) {
      // Clear any pending timer to avoid duplicate flush
      if (this.flushTimer) {
        clearTimeout(this.flushTimer);
        this.flushTimer = undefined;
      }
      this.flush();
    } else if (!this.flushTimer) {
      // Schedule a flush if not already scheduled
      this.flushTimer = setTimeout(() => {
        this.flushTimer = undefined; // Clear before flush to allow new timers
        this.flush();
      }, 100);
    }
  }

  /**
   * Flush buffered log entries to outputs
   * - Background mode: Outputs to both console and file
   * - Foreground mode: Outputs to both console and file
   * Thread-safe: creates a snapshot of the buffer before clearing
   */
  private flush(): void {
    if (this.isShuttingDown) {
      return;
    }

    // Check buffer length before proceeding
    if (this.writeBuffer.length === 0) {
      return;
    }

    // Create snapshot and clear buffer atomically
    const entries = [...this.writeBuffer];
    this.writeBuffer = [];

    // Clear timer after buffer is cleared
    this.clearFlushTimer();

    // Console output in all modes
    this.outputToConsole(entries);

    // File output in all modes
    if (this.config.fileOutput) {
      this.outputToFile(entries);
    }
  }

  /**
   * Clear the auto-flush timer if active
   */
  private clearFlushTimer(): void {
    if (this.flushTimer) {
      clearTimeout(this.flushTimer);
      this.flushTimer = undefined;
    }
  }

  /**
   * Output log entries to console
   */
  private outputToConsole(entries: BufferedLogEntry[]): void {
    for (const entry of entries) {
      const formatted = this.formatter.formatForConsole(entry);
      this.writeToConsole(entry.level, formatted);
    }
  }

  /**
   * Write a formatted message to the appropriate console stream
   */
  private writeToConsole(level: LogLevel, message: string): void {
    switch (level) {
      case LogLevel.ERROR:
        console.error(message);
        break;
      case LogLevel.WARN:
        console.warn(message);
        break;
      case LogLevel.INFO:
      case LogLevel.DEBUG:
        console.log(message);
        break;
    }
  }

  private outputToFile(entries: BufferedLogEntry[]): void {
    try {
      // Check if we need to rotate (new day)
      const currentDate = this.getCurrentLogDate();
      if (currentDate !== Logger.currentLogDate) {
        this.rotation.rotateLogs();
        Logger.currentLogDate = currentDate;
      }

      const combinedLogPath = this.getLogFilePath('combined.log');
      const errorLogPath = this.getLogFilePath('error.log');

      const allLines: string[] = [];
      const errorLines: string[] = [];

      for (const entry of entries) {
        const line = this.formatter.formatForFile(entry);
        allLines.push(line);
        if (entry.level === LogLevel.ERROR) {
          errorLines.push(line);
        }
      }

      this.rotation.checkAndRotateIfNeeded(combinedLogPath);
      this.rotation.checkAndRotateIfNeeded(errorLogPath);

      if (allLines.length > 0) {
        fs.appendFileSync(combinedLogPath, allLines.join('\n') + '\n');
      }
      if (errorLines.length > 0) {
        fs.appendFileSync(errorLogPath, errorLines.join('\n') + '\n');
      }
    } catch (error) {
      console.error('Failed to write log file:', error);
    }
  }

  private setupShutdownHandler(): void {
    const flushAndExit = () => {
      this.isShuttingDown = true;
      this.flush();
      process.exit(0);
    };

    process.on('SIGTERM', flushAndExit);
    process.on('SIGINT', flushAndExit);
    process.on('beforeExit', () => {
      this.isShuttingDown = true;
      this.flush();
    });
  }

  private log(level: LogLevel, message: string, error?: unknown, metadata?: LogMetadata): void {
    if (!this.shouldLog(level)) {
      return;
    }

    const entry: BufferedLogEntry = {
      level,
      message,
      metadata,
      error,
      timestamp: new Date().toISOString(),
      context: this.context,
    };

    this.addToBuffer(entry);
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

  /**
   * Synchronously flush all buffered logs
   * Should be called before process exit to ensure all logs are written
   */
  flushSync(): void {
    // Clear any pending timer first
    if (this.flushTimer) {
      clearTimeout(this.flushTimer);
      this.flushTimer = undefined;
    }
    // Flush immediately
    this.flush();
  }

  isBackgroundMode(): boolean {
    return this.config.backgroundMode;
  }

  updateConfig(config: Partial<LogConfig>): void {
    this.config = { ...this.config, ...config };
    this.formatter = new LogFormatter(this.config, this.context);
    this.rotation = new LogRotation(this.config);
  }

  getConfig(): LogConfig {
    return { ...this.config };
  }
}

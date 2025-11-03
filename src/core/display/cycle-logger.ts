import { UnifiedLogger } from '../../logging/index.js';
import { CycleDisplay } from './cycle-display.js';

/**
 * Handles logging of cycle events with proper foreground/background mode handling
 * Uses CycleDisplay for formatting
 */
export class CycleLogger {
  private logger: UnifiedLogger;
  private readonly context = 'CycleLogger';
  private display: CycleDisplay;
  private isBackgroundMode: boolean;

  constructor() {
    this.logger = UnifiedLogger.getInstance();
    this.display = new CycleDisplay();
    this.isBackgroundMode = this.logger.isBackgroundMode();
  }

  /**
   * Log message with proper handling for foreground vs background mode
   * - Foreground: Direct synchronous console output for chronological ordering
   * - Background: Buffered logger output for efficiency
   */
  log(level: 'info' | 'warn' | 'error' | 'success', message: string): void {
    const plainMessage = this.display.getPlainText(message);

    if (this.isBackgroundMode) {
      this.logToStructuredLogger(level, plainMessage);
    } else {
      this.logToConsole(level, plainMessage);
    }
  }

  /**
   * Log directly to console (foreground mode only)
   */
  private logToConsole(level: 'info' | 'warn' | 'error' | 'success', message: string): void {
    switch (level) {
      case 'error':
        console.error(message);
        break;
      case 'warn':
        console.warn(message);
        break;
      default:
        console.log(message);
    }
  }

  /**
   * Log to structured logger (background mode only)
   */
  private logToStructuredLogger(
    level: 'info' | 'warn' | 'error' | 'success',
    message: string
  ): void {
    switch (level) {
      case 'error':
        this.logger.error(message, undefined, this.context);
        break;
      case 'warn':
        this.logger.warn(message, {}, this.context);
        break;
      default:
        this.logger.info(message, {}, this.context);
    }
  }

  /**
   * Log formatted content to console only (when not in background mode)
   */
  logFormatted(content: string): void {
    if (!this.isBackgroundMode) {
      console.log(content);
    }
  }

  /**
   * Log structured data for file output
   */
  info(context: string, data?: Record<string, unknown>): void {
    this.logger.info(context, data, this.context);
  }

  warn(message: string): void {
    this.logger.warn(message, {}, this.context);
  }

  error(message: string, error?: unknown): void {
    this.logger.error(
      message,
      error instanceof Error ? error : error ? new Error(String(error)) : undefined,
      this.context
    );
  }

  debug(message: string, data?: Record<string, unknown>): void {
    this.logger.debug(message, data, this.context);
  }
}

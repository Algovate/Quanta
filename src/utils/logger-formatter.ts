/**
 * Log formatting utilities
 */

import { BufferedLogEntry, LogConfig } from './logger-types.js';

export class LogFormatter {
  constructor(
    private config: LogConfig,
    private context: string
  ) {}

  formatForConsole(entry: BufferedLogEntry): string {
    if (this.config.backgroundMode) {
      // Background mode: minimal formatting
      return `[${entry.timestamp}] [${entry.level.toUpperCase()}] [${this.context}] ${entry.message}`;
    } else {
      // Interactive mode: preserve chalk formatting
      return entry.message;
    }
  }

  formatForFile(entry: BufferedLogEntry): string {
    const logData: Record<string, unknown> = {
      timestamp: entry.timestamp,
      level: entry.level,
      context: entry.context,
      message: entry.message,
      ...entry.metadata,
    };

    if (entry.error) {
      logData.error = entry.error instanceof Error ? entry.error.message : String(entry.error);
      if (entry.error instanceof Error && entry.error.stack) {
        logData.stack = entry.error.stack;
      }
    }

    return JSON.stringify(logData);
  }
}

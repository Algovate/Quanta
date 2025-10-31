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
      let formatted = entry.message;

      // Enhance warnings with metadata details (especially for price deviation warnings)
      if (entry.level === 'warn' && entry.metadata) {
        const meta = entry.metadata;

        // Special formatting for price deviation warnings
        if (entry.message.includes('stale entry price')) {
          const coin = meta.coin as string;
          const side = meta.side as string;
          const entryPrice = meta.entryPrice as number;
          const currentPrice = meta.currentPrice as number;
          const relativeDiff = meta.relativeDiff as number;
          const maxAllowed = meta.maxAllowed as number;

          const deviationPercent = (relativeDiff * 100).toFixed(2);
          const thresholdPercent = (maxAllowed * 100).toFixed(0);

          formatted +=
            `\n  📍 ${coin} ${side.toUpperCase()}: Entry=$${entryPrice.toFixed(2)}, ` +
            `Market=$${currentPrice.toFixed(2)}, Deviation=${deviationPercent}% (threshold: ${thresholdPercent}%)`;
        } else if (entry.metadata.coin || entry.metadata.side) {
          // Format other warnings with coin/side if available
          const parts: string[] = [];
          if (meta.coin) parts.push(`Coin: ${meta.coin}`);
          if (meta.side) parts.push(`Side: ${meta.side}`);
          if (parts.length > 0) {
            formatted += ` (${parts.join(', ')})`;
          }
        }
      }

      return formatted;
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

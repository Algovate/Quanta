/**
 * Log Command Formatters - Formatting utilities for log command output
 */

import chalk from 'chalk';
import type { LogFileMetadata } from './log-helpers.js';
import type { TextLog } from '../../logging/types.js';
import { formatFileSize } from './log-helpers.js';
import { formatUTCLogTime, formatUTCTime } from '../../utils/time.js';

/**
 * Level styling configuration
 */
const LEVEL_STYLES = {
  error: { color: chalk.red, symbol: '✗' },
  warn: { color: chalk.yellow, symbol: '⚠' },
  info: { color: chalk.blue, symbol: 'ℹ' },
  debug: { color: chalk.gray, symbol: '•' },
} as const;

/**
 * Get level style configuration
 */
function getLevelStyle(level: TextLog['level']): { color: typeof chalk; symbol: string } {
  return LEVEL_STYLES[level] || { color: chalk.white, symbol: '•' };
}

/**
 * Format log files as JSON
 */
export function formatLogFilesAsJson(files: LogFileMetadata[]): string {
  return JSON.stringify(
    files.map(f => ({
      name: f.name,
      date: f.dateKey,
      size: f.size,
      sizeFormatted: formatFileSize(f.size),
      lines: f.lineCount || 0,
      modified: f.mtime.toISOString(),
    })),
    null,
    2
  );
}

/**
 * Format log files as CSV
 */
export function formatLogFilesAsCsv(files: LogFileMetadata[]): string {
  const lines = ['name,date,size,sizeFormatted,lines,modified'];
  for (const f of files) {
    lines.push(
      `${f.name},${f.dateKey},${f.size},${formatFileSize(f.size)},${f.lineCount || 0},${f.mtime.toISOString()}`
    );
  }
  return lines.join('\n');
}

/**
 * Format log files as table
 */
export function formatLogFilesAsTable(files: LogFileMetadata[]): string {
  const lines: string[] = [];
  lines.push(chalk.blue(`\n📋 Log Files (${files.length}):\n`));
  lines.push(
    `${chalk.bold('Filename')}              ${chalk.bold('Date')}      ${chalk.bold('Size')}     ${chalk.bold('Lines')}`
  );
  lines.push(chalk.gray('─'.repeat(70)));

  for (const f of files) {
    const name = f.name.padEnd(25);
    const date = f.dateKey.padEnd(12);
    const size = formatFileSize(f.size).padEnd(10);
    const linesCount = (f.lineCount || 0).toString().padStart(8);
    lines.push(`${name} ${date} ${size} ${linesCount}`);
  }

  return lines.join('\n');
}

/**
 * Format statistics as JSON
 */
export function formatStatsAsJson(stats: {
  total: number;
  byLevel: Record<string, number>;
  byContext: Record<string, number>;
  errors: number;
  warnings: number;
  errorRate: number;
  warningRate: number;
  timeRange: { earliest: number; latest: number };
}): string {
  return JSON.stringify(
    {
      total: stats.total,
      byLevel: stats.byLevel,
      byContext: stats.byContext,
      errors: stats.errors,
      warnings: stats.warnings,
      errorRate: stats.errorRate.toFixed(2),
      warningRate: stats.warningRate.toFixed(2),
      timeRange: {
        earliest: new Date(stats.timeRange.earliest).toISOString(),
        latest: new Date(stats.timeRange.latest).toISOString(),
      },
    },
    null,
    2
  );
}

/**
 * Format statistics as table
 */
export function formatStatsAsTable(
  stats: {
  total: number;
  byLevel: Record<string, number>;
  byContext: Record<string, number>;
  errors: number;
  warnings: number;
  errorRate: number;
  warningRate: number;
  timeRange: { earliest: number; latest: number };
  },
  showAllContexts: boolean = false
): string {
  const lines: string[] = [];
  lines.push(chalk.blue('\n📊 Log Statistics\n'));
  lines.push(chalk.bold(`Total entries: ${stats.total}`));
  lines.push(
    chalk.bold(
      `Time range: ${new Date(stats.timeRange.earliest).toLocaleString()} - ${new Date(stats.timeRange.latest).toLocaleString()}`
    )
  );

  lines.push(chalk.bold(`\nBy Level:`));
  for (const [level, count] of Object.entries(stats.byLevel).sort((a, b) => b[1] - a[1])) {
    const percentage = ((count / stats.total) * 100).toFixed(1);
    lines.push(`  ${level.padEnd(8)} ${count.toString().padStart(8)} (${percentage}%)`);
  }

  lines.push(chalk.bold(`\nBy Context:`));
  const sortedContexts = Object.entries(stats.byContext).sort((a, b) => b[1] - a[1]);
  const contextsToShow = showAllContexts ? sortedContexts : sortedContexts.slice(0, 10);
  
  for (const [context, count] of contextsToShow) {
    const percentage = ((count / stats.total) * 100).toFixed(1);
    lines.push(`  ${context.padEnd(20)} ${count.toString().padStart(8)} (${percentage}%)`);
  }
  
  if (!showAllContexts && sortedContexts.length > 10) {
    lines.push(chalk.dim(`  ... and ${sortedContexts.length - 10} more (use --all-contexts to show all)`));
  }

  lines.push(chalk.bold(`\nError Rate: ${stats.errorRate.toFixed(2)}% (${stats.errors} errors)`));
  lines.push(
    chalk.bold(`Warning Rate: ${stats.warningRate.toFixed(2)}% (${stats.warnings} warnings)`)
  );

  return lines.join('\n');
}

/**
 * Format stack trace with proper indentation
 */
function formatStackTrace(error: any): string {
  if (!error) return '';

  let stack = '';
  if (typeof error === 'string') {
    stack = error;
  } else if (typeof error.stack === 'string') {
    stack = error.stack;
  } else if (error.message && error.type) {
    stack = `${error.type}: ${error.message}`;
  } else if (error.message) {
    stack = error.message;
  } else {
    return '';
  }

  // Split stack trace by lines and indent each line
  const lines = stack.split('\n');
  return lines
    .map((line, index) => {
      // First line is usually the error message, indent it
      // Subsequent lines are stack frames, indent more
      if (index === 0) {
        return `    ${line}`;
      }
      return `      ${line}`;
    })
    .join('\n');
}

/**
 * Extract metadata fields from log metadata
 */
function extractMetadata(metadata: Record<string, any>): {
  cycleId?: number;
  operationId?: string;
  traceId?: string;
  formattedMessage?: string;
  error?: any;
  other?: Record<string, any>;
} {
  const result: any = {};

  if (metadata.cycleId !== undefined && metadata.cycleId !== null) {
    result.cycleId = metadata.cycleId;
  }
  if (metadata.operationId) {
    result.operationId = metadata.operationId;
  }
  if (metadata.traceId) {
    result.traceId = metadata.traceId;
  }
  if (metadata.formattedMessage) {
    result.formattedMessage = metadata.formattedMessage;
  }
  if (metadata.error) {
    result.error = metadata.error;
  }

  // Extract other metadata
  const otherMetadata = { ...metadata };
  delete otherMetadata.cycleId;
  delete otherMetadata.operationId;
  delete otherMetadata.traceId;
  delete otherMetadata.formattedMessage;
  delete otherMetadata.error;

  if (Object.keys(otherMetadata).length > 0) {
    result.other = otherMetadata;
  }

  return result;
}

/**
 * Format error details for structured output
 */
function formatErrorDetails(error: any, useColors: boolean = true): string[] {
  const lines: string[] = [];

  if (!error) return lines;

  if (error.type || error.message) {
    if (useColors) {
      lines.push(`  ${chalk.red('Error:')}`);
    } else {
      lines.push(`  Error:`);
    }

    if (error.type) {
      if (useColors) {
        lines.push(`    ${chalk.dim('Type:')} ${error.type}`);
      } else {
        lines.push(`    Type: ${error.type}`);
      }
    }
    if (error.message) {
      if (useColors) {
        lines.push(`    ${chalk.dim('Message:')} ${error.message}`);
      } else {
        lines.push(`    Message: ${error.message}`);
      }
    }
    if (error.code) {
      if (useColors) {
        lines.push(`    ${chalk.dim('Code:')} ${error.code}`);
      } else {
        lines.push(`    Code: ${error.code}`);
      }
    }
  }

  // Stack trace
  const stackTrace = formatStackTrace(error);
  if (stackTrace) {
    if (useColors) {
      lines.push(`  ${chalk.dim('Stack:')}`);
    } else {
      lines.push(`  Stack:`);
    }
    lines.push(stackTrace);
  }

  return lines;
}

/**
 * Format metadata fields as colored lines
 */
function formatMetadataLines(extracted: ReturnType<typeof extractMetadata>): string[] {
  const lines: string[] = [];
  if (extracted.cycleId !== undefined) {
    lines.push(`  ${chalk.dim('cycleId:')} ${extracted.cycleId}`);
  }
  if (extracted.operationId) {
    lines.push(`  ${chalk.dim('operationId:')} ${extracted.operationId}`);
  }
  if (extracted.traceId) {
    lines.push(`  ${chalk.dim('traceId:')} ${extracted.traceId}`);
  }
  return lines;
}

/**
 * Format logs as structured output for console display
 */
export function formatLogsAsStructured(logs: TextLog[]): string {
  const lines: string[] = [];

  for (const log of logs) {
    const timestamp = formatUTCLogTime(log.timestamp);
    const extracted = extractMetadata(log.metadata || {});
    const levelStyle = getLevelStyle(log.level);

    // Header line: timestamp, level, context
    const levelLabel = levelStyle.color(`${levelStyle.symbol} ${log.level.toUpperCase()}`);
    lines.push(`${chalk.dim(timestamp)} ${levelLabel} ${chalk.cyan(`[${log.context}]`)}`);

    // Message line
    const formattedMessage = extracted.formattedMessage || log.message;
    lines.push(`  ${formattedMessage}`);

    // Metadata fields
    const metadataLines = formatMetadataLines(extracted);
    if (metadataLines.length > 0) {
      lines.push(...metadataLines);
    }

    // Error details and stack trace
    if (extracted.error) {
      lines.push(...formatErrorDetails(extracted.error, true));
    }

    // Add separator between logs
    lines.push('');
  }

  return lines.join('\n');
}

/**
 * Build JSON log object from TextLog (jq-friendly format)
 */
function buildJsonLogObject(log: TextLog): Record<string, any> {
  const extracted = extractMetadata(log.metadata || {});

  const result: Record<string, any> = {
    timestamp: formatUTCTime(log.timestamp), // ISO 8601 format for jq
    timestampMs: log.timestamp,
    level: log.level,
    context: log.context,
    message: log.message,
  };

  // Add metadata fields
  if (extracted.cycleId !== undefined) {
    result.cycleId = extracted.cycleId;
  }
  if (extracted.operationId) {
    result.operationId = extracted.operationId;
  }
  if (extracted.traceId) {
    result.traceId = extracted.traceId;
  }

  // Add formatted message if different from plain message
  if (extracted.formattedMessage && extracted.formattedMessage !== log.message) {
    result.formattedMessage = extracted.formattedMessage;
  }

  // Add error details if present
  if (extracted.error) {
    const error = extracted.error;
    result.error = {
      type: error.type,
      message: error.message,
      code: error.code,
      details: error.details,
    };
    // Keep stack trace as string for jq compatibility
    if (error.stack) {
      result.error.stack = error.stack;
    }
  }

  // Add any other metadata
  if (extracted.other) {
    result.metadata = extracted.other;
  }

  return result;
}

/**
 * Format logs as JSONL (JSON Lines) - jq-friendly format
 * - Each log entry on a separate line (JSONL format)
 * - ISO 8601 timestamps for machine readability
 * - Stack traces as strings (not arrays) for jq compatibility
 * - Compact JSON (no indentation) per line
 */
export function formatLogsAsJson(logs: TextLog[]): string {
  const transformedLogs = logs.map(buildJsonLogObject);
  // JSONL format: one JSON object per line
  return transformedLogs.map(log => JSON.stringify(log)).join('\n');
}


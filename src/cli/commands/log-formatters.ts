/**
 * Log Command Formatters - Formatting utilities for log command output
 */

import chalk from 'chalk';
import type { LogFileMetadata } from './log-helpers.js';
import type { TextLog } from '../../logging/types.js';
import { formatFileSize } from './log-helpers.js';

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
export function formatStatsAsTable(stats: {
  total: number;
  byLevel: Record<string, number>;
  byContext: Record<string, number>;
  errors: number;
  warnings: number;
  errorRate: number;
  warningRate: number;
  timeRange: { earliest: number; latest: number };
}): string {
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
  for (const [context, count] of sortedContexts.slice(0, 10)) {
    const percentage = ((count / stats.total) * 100).toFixed(1);
    lines.push(`  ${context.padEnd(20)} ${count.toString().padStart(8)} (${percentage}%)`);
  }
  if (sortedContexts.length > 10) {
    lines.push(chalk.dim(`  ... and ${sortedContexts.length - 10} more`));
  }

  lines.push(chalk.bold(`\nError Rate: ${stats.errorRate.toFixed(2)}% (${stats.errors} errors)`));
  lines.push(
    chalk.bold(`Warning Rate: ${stats.warningRate.toFixed(2)}% (${stats.warnings} warnings)`)
  );

  return lines.join('\n');
}

/**
 * Export logs as JSON
 */
export function exportLogsAsJson(logs: TextLog[]): string {
  return JSON.stringify(logs, null, 2);
}

/**
 * Export logs as CSV
 */
export function exportLogsAsCsv(logs: TextLog[]): string {
  const lines = ['timestamp,level,context,message,cycleId,operationId,traceId'];
  for (const log of logs) {
    const timestamp = new Date(log.timestamp).toISOString();
    const level = log.level || '';
    const context = log.context || '';
    const message = (log.message || '').replace(/"/g, '""'); // Escape quotes
    const metadata = log.metadata || {};
    const cycleId = metadata.cycleId?.toString() || '';
    const operationId = (metadata.operationId as string) || '';
    const traceId = (metadata.traceId as string) || '';
    lines.push(
      `"${timestamp}","${level}","${context}","${message}","${cycleId}","${operationId}","${traceId}"`
    );
  }
  return lines.join('\n');
}

/**
 * Export logs as plain text
 */
export function exportLogsAsText(logs: TextLog[]): string {
  const lines: string[] = [];
  for (const log of logs) {
    const timestamp = new Date(log.timestamp).toISOString();
    const level = log.level?.toUpperCase().padEnd(5) || '';
    const context = log.context?.padEnd(15) || '';
    const message = log.message || '';
    lines.push(`[${timestamp}] ${level} [${context}] ${message}`);
  }
  return lines.join('\n');
}

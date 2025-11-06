import { Command } from 'commander';
import chalk from 'chalk';
import fs from 'fs';
import { QueryInterface } from '../../logging/index.js';
import { UnifiedLogger } from '../../logging/index.js';
import { safeAction } from '../shared/command-utils.js';
import {
  getLogFiles,
  formatFileSize,
  promptConfirmation,
  calculateTimeRange,
  parseDate,
  parseDateEndOfDay,
  filterLogsByGrep,
  parseLogLevel,
  countFileLines,
  type LogFileMetadata,
} from './log-helpers.js';
import {
  formatLogFilesAsJson,
  formatLogFilesAsCsv,
  formatLogFilesAsTable,
  formatStatsAsJson,
  formatStatsAsTable,
  exportLogsAsJson,
  exportLogsAsCsv,
  exportLogsAsText,
} from './log-formatters.js';
import type { TextLog } from '../../logging/types.js';

export class LogCommands {
  static register(program: Command): void {
    // Show console output
    program
      .command('view')
      .description('View console output logs')
      .option('--lines <n>', 'Show last N lines (default: 50)', parseInt, 50)
      .option('-f, --follow', 'Follow mode (real-time updates)', false)
      .option('--context <context>', 'Filter by logger context (e.g., TradeStart, Server)')
      .option('--level <level>', 'Filter by log level (info|warn|error|debug)')
      .option('--grep <pattern>', 'Search/filter by pattern in message')
      .option('--format <format>', 'Output format (formatted|raw)', 'formatted')
      .action(
        safeAction(async options => {
          await LogCommands.showConsoleOutput(options);
        }, 'LogCommands.view')
      );

    // Clean old log files
    program
      .command('clean')
      .description('Clean old log files')
      .option('--all', 'Delete all log files (with confirmation)', false)
      .option('--days <n>', 'Delete files older than N days', parseInt)
      .option('--force', 'Skip confirmation prompt', false)
      .option('--dry-run', 'Show what would be deleted without deleting', false)
      .action(
        safeAction(async options => {
          await LogCommands.cleanLogs(options);
        }, 'LogCommands.clean')
      );

    // List log files
    program
      .command('list')
      .description('List available log files with metadata')
      .option('--format <format>', 'Output format: table, json, csv', 'table')
      .option('--sort <field>', 'Sort by: date, size, name', 'date')
      .action(
        safeAction(async options => {
          await LogCommands.listLogFiles(options);
        }, 'LogCommands.list')
      );

    // Show log statistics
    program
      .command('stats')
      .description('Show log statistics and aggregates')
      .option('--days <n>', 'Analyze last N days', parseInt)
      .option('--context <context>', 'Filter by context')
      .option('--level <level>', 'Filter by log level (info|warn|error|debug)')
      .option('--format <format>', 'Output format: table, json', 'table')
      .action(
        safeAction(async options => {
          await LogCommands.showStats(options);
        }, 'LogCommands.stats')
      );

    // Export logs
    program
      .command('export')
      .description('Export logs to different formats')
      .option('--format <format>', 'Export format: json, csv, txt', 'json')
      .option('--output <file>', 'Output file path (required)')
      .option('--days <n>', 'Export last N days', parseInt)
      .option('--context <context>', 'Filter by context')
      .option('--level <level>', 'Filter by log level (info|warn|error|debug)')
      .option('--since <date>', 'Start date (YYYY-MM-DD)')
      .option('--until <date>', 'End date (YYYY-MM-DD)')
      .action(
        safeAction(async options => {
          await LogCommands.exportLogs(options);
        }, 'LogCommands.export')
      );
  }

  private static async showConsoleOutput(options: {
    lines?: number;
    follow?: boolean;
    context?: string;
    level?: string;
    grep?: string;
    format?: string;
  }): Promise<void> {
    const query = QueryInterface.getInstance();
    const logger = UnifiedLogger.getInstance();
    const context = 'LogCommands';

    // Parse and validate level
    const level = parseLogLevel(options.level);

    try {
      // Query text logs
      const result = await query.queryTextLogs({
        context: options.context,
        level,
        limit: options.lines || 50,
        offset: 0,
      });

      // Filter logs by grep pattern if specified
      const logs = filterLogsByGrep(result.logs, options.grep);

      // Display logs
      if (logs.length === 0) {
        logger.info(chalk.yellow('⚠️  No console output found matching the criteria'), {}, context);
        return;
      }

      // Display initial logs (sorted chronologically)
      this.displayLogs(logs, options.format);

      // Show info message for non-follow mode
      if (!options.follow) {
        logger.info(
          chalk.gray(
            `\n--- Showing last ${logs.length} log entries (use --follow for real-time updates) ---`
          ),
          {},
          context
        );
      }

      // Follow mode: Poll for new logs
      if (options.follow) {
        await this.startFollowMode({
          query,
          options: {
            context: options.context,
            level,
            grep: options.grep,
            format: options.format,
          },
          initialTimestamp: logs.length > 0 ? logs[0].timestamp : Date.now(),
        });
      }
    } finally {
      // Always cleanup resources before exiting (only for non-follow mode)
      // In follow mode, cleanup already happened in startFollowMode
      if (!options.follow) {
        this.cleanupResources();
      }
    }
  }

  /**
   * Display logs to console
   */
  private static displayLogs(
    logs: Array<{ message: string; formattedMessage?: string }>,
    format?: string
  ): void {
    const logger = UnifiedLogger.getInstance();
    const context = 'LogCommands';
    // Logs are already sorted by timestamp DESC (newest first)
    // For display, we want oldest first so they appear in chronological order
    const sortedLogs = [...logs].reverse();

    for (const log of sortedLogs) {
      if (format === 'raw') {
        logger.info(log.message, {}, context);
      } else {
        // Use formatted message (with ANSI codes) for display
        logger.info(log.formattedMessage || log.message, {}, context);
      }
    }
  }

  /**
   * Start follow mode to poll for new logs
   */
  private static async startFollowMode(options: {
    query: QueryInterface;
    options: {
      context?: string;
      level?: 'info' | 'warn' | 'error' | 'debug';
      grep?: string;
      format?: string;
    };
    initialTimestamp: number;
  }): Promise<void> {
    const logger = UnifiedLogger.getInstance();
    const context = 'LogCommands';
    const { query, options: queryOptions, initialTimestamp } = options;
    let pollInterval: NodeJS.Timeout | undefined;
    let lastTimestamp = initialTimestamp;

    try {
      logger.info(chalk.gray('\n--- Following logs (press Ctrl+C to stop) ---\n'), {}, context);

      pollInterval = setInterval(async () => {
        try {
          const newResult = await query.queryTextLogs({
            context: queryOptions.context,
            level: queryOptions.level,
            since: lastTimestamp + 1, // Only get logs newer than last seen
            limit: 100,
          });

          const newLogs = filterLogsByGrep(newResult.logs, queryOptions.grep);

          // Sort by timestamp ascending (oldest first)
          newLogs.sort((a, b) => a.timestamp - b.timestamp);

          // Display new logs and update timestamp
          for (const log of newLogs) {
            this.displayLogs([log], queryOptions.format);
            lastTimestamp = Math.max(lastTimestamp, log.timestamp);
          }
        } catch (error) {
          logger.error(chalk.red('Error polling logs:'), error, context);
        }
      }, 1000); // Poll every second

      // Handle Ctrl+C
      const sigintHandler = () => {
        if (pollInterval) {
          clearInterval(pollInterval);
        }
        this.cleanupResources();
        logger.info(chalk.yellow('\n\nStopped following logs.'));
        process.exitCode = 0;
        return;
      };
      process.on('SIGINT', sigintHandler);

      // Keep process alive
      await new Promise(() => {
        // Never resolves, keeps process alive until SIGINT or error
      });
    } catch (error) {
      // Handle any errors that occur during follow mode setup or execution
      logger.error(chalk.red('Error in follow mode:'), error);
      throw error;
    } finally {
      // Ensure cleanup happens even if an error occurs
      if (pollInterval) {
        clearInterval(pollInterval);
      }
      // Cleanup resources (idempotent, safe to call multiple times)
      this.cleanupResources();
    }
  }

  /**
   * Cleanup resources and allow process to exit cleanly
   */
  private static cleanupResources(): void {
    try {
      // Shutdown logging services (stop intervals)
      UnifiedLogger.getInstance().shutdown();
    } catch {
      // Ignore errors during cleanup
    }
  }

  /**
   * Clean log files
   */
  private static async cleanLogs(options: {
    all?: boolean;
    days?: number;
    force?: boolean;
    dryRun?: boolean;
  }): Promise<void> {
    const logger = UnifiedLogger.getInstance();
    const context = 'LogCommands';
    const files = await getLogFiles();

    if (files.length === 0) {
      logger.info(chalk.yellow('⚠️  No log files found'), {}, context);
      return;
    }

    let filesToDelete: typeof files = [];

    if (options.all) {
      filesToDelete = files;
    } else if (options.days) {
      const cutoff = Date.now() - options.days * 24 * 60 * 60 * 1000;
      filesToDelete = files.filter(f => f.mtime.getTime() < cutoff);
    } else {
      // Default: delete files older than retention period (7 days)
      const retentionDays = 7;
      const cutoff = Date.now() - retentionDays * 24 * 60 * 60 * 1000;
      filesToDelete = files.filter(f => f.mtime.getTime() < cutoff);
    }

    if (filesToDelete.length === 0) {
      logger.info(chalk.green('✓ No files to delete'));
      return;
    }

    // Show what would be deleted
    logger.info(chalk.blue(`\n📋 Files to delete (${filesToDelete.length}):\n`));
    let totalSize = 0;
    for (const file of filesToDelete) {
      totalSize += file.size;
      logger.info(`  ${chalk.gray(file.name)} ${chalk.dim(`(${formatFileSize(file.size)})`)}`);
    }
    logger.info(chalk.dim(`\nTotal size: ${formatFileSize(totalSize)}\n`));

    if (options.dryRun) {
      logger.info(chalk.yellow('🔍 Dry run mode - no files were deleted'));
      return;
    }

    // Confirm deletion
    if (!options.force) {
      const confirmed = await promptConfirmation(`Delete ${filesToDelete.length} file(s)?`);
      if (!confirmed) {
        logger.info(chalk.yellow('✗ Cleanup cancelled'));
        return;
      }
    }

    // Delete files
    let deletedCount = 0;
    let errorCount = 0;

    for (const file of filesToDelete) {
      try {
        await fs.promises.unlink(file.path);
        deletedCount++;
      } catch (error) {
        errorCount++;
        logger.error(chalk.red(`Failed to delete ${file.name}:`), error);
      }
    }

    if (deletedCount > 0) {
      logger.info(chalk.green(`\n✓ Deleted ${deletedCount} file(s)`));
    }
    if (errorCount > 0) {
      logger.info(chalk.red(`✗ Failed to delete ${errorCount} file(s)`));
    }
  }

  /**
   * Sort log files by field
   */
  private static sortLogFiles(files: LogFileMetadata[], sortField: string): LogFileMetadata[] {
    return [...files].sort((a, b) => {
      if (sortField === 'date') {
        return b.mtime.getTime() - a.mtime.getTime(); // Newest first
      } else if (sortField === 'size') {
        return b.size - a.size; // Largest first
      } else if (sortField === 'name') {
        return a.name.localeCompare(b.name);
      }
      return 0;
    });
  }

  /**
   * List log files
   */
  private static async listLogFiles(options: { format?: string; sort?: string }): Promise<void> {
    const logger = UnifiedLogger.getInstance();
    const context = 'LogCommands';
    const files = await getLogFiles();

    if (files.length === 0) {
      logger.info(chalk.yellow('⚠️  No log files found'), {}, context);
      return;
    }

    // Sort files
    const sortField = options.sort || 'date';
    const sortedFiles = this.sortLogFiles(files, sortField);

    // Count lines in files
    const filesWithLineCounts = await Promise.all(
      sortedFiles.map(async file => ({
        ...file,
        lineCount: await countFileLines(file.path),
      }))
    );

    const format = options.format || 'table';
    let output = '';

    if (format === 'json') {
      output = formatLogFilesAsJson(filesWithLineCounts);
    } else if (format === 'csv') {
      output = formatLogFilesAsCsv(filesWithLineCounts);
    } else {
      output = formatLogFilesAsTable(filesWithLineCounts);
    }

    logger.info(output, {}, context);
  }

  /**
   * Aggregate statistics from logs
   */
  private static aggregateStats(logs: TextLog[]): {
    total: number;
    byLevel: Record<string, number>;
    byContext: Record<string, number>;
    errors: number;
    warnings: number;
    errorRate: number;
    warningRate: number;
    timeRange: { earliest: number; latest: number };
  } {
    const stats = {
      total: logs.length,
      byLevel: {} as Record<string, number>,
      byContext: {} as Record<string, number>,
      errors: 0,
      warnings: 0,
      timeRange: {
        earliest: Math.min(...logs.map(l => l.timestamp)),
        latest: Math.max(...logs.map(l => l.timestamp)),
      },
    };

    for (const log of logs) {
      stats.byLevel[log.level] = (stats.byLevel[log.level] || 0) + 1;
      stats.byContext[log.context] = (stats.byContext[log.context] || 0) + 1;
      if (log.level === 'error') stats.errors++;
      if (log.level === 'warn') stats.warnings++;
    }

    const errorRate = stats.total > 0 ? (stats.errors / stats.total) * 100 : 0;
    const warningRate = stats.total > 0 ? (stats.warnings / stats.total) * 100 : 0;

    return {
      ...stats,
      errorRate,
      warningRate,
    };
  }

  /**
   * Show log statistics
   */
  private static async showStats(options: {
    days?: number;
    context?: string;
    level?: string;
    format?: string;
  }): Promise<void> {
    const logger = UnifiedLogger.getInstance();
    const context = 'LogCommands';
    const query = QueryInterface.getInstance();

    // Calculate time range
    const since = calculateTimeRange(options.days);

    // Parse level
    const level = parseLogLevel(options.level);

    // Query logs
    const result = await query.queryTextLogs({
      context: options.context,
      level,
      since,
      limit: 100000, // Large limit to get all matching logs
    });

    const logs = result.logs;

    if (logs.length === 0) {
      logger.info(chalk.yellow('⚠️  No logs found matching the criteria'));
      return;
    }

    // Aggregate statistics
    const stats = this.aggregateStats(logs);

    const format = options.format || 'table';
    const output = format === 'json' ? formatStatsAsJson(stats) : formatStatsAsTable(stats);

    logger.info(output, {}, context);
  }

  /**
   * Calculate export time range from options
   */
  private static calculateExportTimeRange(options: {
    days?: number;
    since?: string;
    until?: string;
  }): { since?: number; until?: number; error?: string } {
    let since: number | undefined;
    let until: number | undefined;

    if (options.days) {
      since = calculateTimeRange(options.days);
    }

    if (options.since) {
      const parsed = parseDate(options.since);
      if (parsed === null) {
        return { error: `Invalid --since date: ${options.since}` };
      }
      since = parsed;
    }

    if (options.until) {
      const parsed = parseDateEndOfDay(options.until);
      if (parsed === null) {
        return { error: `Invalid --until date: ${options.until}` };
      }
      until = parsed;
    }

    return { since, until };
  }

  /**
   * Export logs
   */
  private static async exportLogs(options: {
    format?: string;
    output?: string;
    days?: number;
    context?: string;
    level?: string;
    since?: string;
    until?: string;
  }): Promise<void> {
    const logger = UnifiedLogger.getInstance();
    const context = 'LogCommands';
    const query = QueryInterface.getInstance();

    if (!options.output) {
      logger.error(chalk.red('✗ Error: --output is required'), undefined, context);
      return;
    }

    // Calculate time range
    const timeRange = this.calculateExportTimeRange(options);
    if (timeRange.error) {
      logger.error(chalk.red(`✗ ${timeRange.error}`));
      return;
    }

    // Parse level
    const level = parseLogLevel(options.level);

    // Query logs
    const result = await query.queryTextLogs({
      context: options.context,
      level,
      since: timeRange.since,
      until: timeRange.until,
      limit: 100000, // Large limit
    });

    const logs = result.logs;

    if (logs.length === 0) {
      logger.info(chalk.yellow('⚠️  No logs found matching the criteria'));
      return;
    }

    // Sort by timestamp ascending
    logs.sort((a, b) => a.timestamp - b.timestamp);

    const format = options.format || 'json';
    let content = '';

    if (format === 'json') {
      content = exportLogsAsJson(logs);
    } else if (format === 'csv') {
      content = exportLogsAsCsv(logs);
    } else if (format === 'txt') {
      content = exportLogsAsText(logs);
    } else {
      logger.error(chalk.red(`✗ Invalid format: ${format}. Use json, csv, or txt`));
      return;
    }

    // Write to file
    try {
      await fs.promises.writeFile(options.output, content, 'utf-8');
      logger.info(chalk.green(`✓ Exported ${logs.length} log entries to ${options.output}`));
      logger.info(chalk.dim(`Format: ${format}, Size: ${formatFileSize(content.length)}`));
    } catch (error) {
      logger.error(chalk.red(`✗ Failed to write file: ${options.output}`), error);
      throw error;
    }
  }
}

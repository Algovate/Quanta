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
  formatLogsAsStructured,
  formatLogsAsJson,
  formatDecisionFactors,
  formatDecisionSummary,
} from './log-formatters.js';
import type { TextLog } from '../../logging/types.js';
import { extractDecisionInfo, groupDecisionsByCycle, type DecisionInfo } from './log-helpers.js';

// Type definitions for command options
interface ViewOptions {
  lines?: number;
  follow?: boolean;
  context?: string;
  level?: string;
  grep?: string;
  format?: string;
  days?: number;
  since?: string;
  until?: string;
  decisionPath?: boolean;
}

interface DecisionsOptions {
  cycleId?: number;
  symbol?: string;
  since?: string;
  until?: string;
  days?: number;
  format?: string;
  follow?: boolean;
  verbose?: boolean;
}

interface CleanOptions {
  all?: boolean;
  days?: number;
  force?: boolean;
  dryRun?: boolean;
}

interface ListOptions {
  format?: string;
  sort?: string;
}

interface StatsOptions {
  days?: number;
  context?: string;
  level?: string;
  format?: string;
  allContexts?: boolean;
}

interface TimeRange {
  since?: number;
  until?: number;
}

interface FollowModeOptions {
  context?: string;
  level?: 'info' | 'warn' | 'error' | 'debug';
  grep?: string;
  format?: string;
}

// Constants
const DEFAULT_LINES = 50;
const DEFAULT_RETENTION_DAYS = 7;
const FOLLOW_MODE_POLL_INTERVAL = 1000; // 1 second
const FOLLOW_MODE_BATCH_LIMIT = 100;
const STATS_QUERY_LIMIT = 100000;

export class LogCommands {
  static register(program: Command): void {
    // Show console output
    program
      .command('view')
      .description('View console output logs')
      .option('--lines <n>', 'Show last N lines (default: 50)', parseInt, DEFAULT_LINES)
      .option('-f, --follow', 'Follow mode (real-time updates)', false)
      .option('--context <context>', 'Filter by logger context (e.g., TradeStart, Server)')
      .option('--level <level>', 'Filter by log level (info|warn|error|debug)')
      .option('--grep <pattern>', 'Search/filter by pattern in message')
      .option('--format <format>', 'Output format (structured|json)', 'structured')
      .option('--days <n>', 'Show logs from last N days', parseInt)
      .option('--since <date>', 'Start date (YYYY-MM-DD)')
      .option('--until <date>', 'End date (YYYY-MM-DD)')
      .option('--decision-path', 'Show decision path information', false)
      .action(
        safeAction(async options => {
          await LogCommands.showConsoleOutput(options);
        }, 'LogCommands.view')
      );

    // Show trading decisions
    program
      .command('decisions')
      .description('View trading decision analysis')
      .option('--cycle-id <n>', 'Show decisions for specific cycle ID', parseInt)
      .option('--symbol <symbol>', 'Filter by symbol/coin')
      .option('--since <date>', 'Start date (YYYY-MM-DD)')
      .option('--until <date>', 'End date (YYYY-MM-DD)')
      .option('--days <n>', 'Show decisions from last N days', parseInt)
      .option('--format <format>', 'Output format: structured, json, detailed', 'structured')
      .option('-f, --follow', 'Follow mode (real-time updates)', false)
      .option('--verbose', 'Show detailed decision factors', false)
      .action(
        safeAction(async options => {
          await LogCommands.showDecisions(options);
        }, 'LogCommands.decisions')
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
      .option('--all-contexts', 'Show all contexts (not just top 10)', false)
      .action(
        safeAction(async options => {
          await LogCommands.showStats(options);
        }, 'LogCommands.stats')
      );
  }

  /**
   * Parse time range options into since/until timestamps
   */
  private static parseTimeRange(options: {
    days?: number;
    since?: string;
    until?: string;
  }): TimeRange | { error: string } {
    const range: TimeRange = {};

    if (options.days) {
      range.since = calculateTimeRange(options.days);
    }

    if (options.since) {
      const parsed = parseDate(options.since);
      if (parsed === null) {
        return { error: `Invalid --since date: ${options.since}` };
      }
      range.since = parsed;
    }

    if (options.until) {
      const parsed = parseDateEndOfDay(options.until);
      if (parsed === null) {
        return { error: `Invalid --until date: ${options.until}` };
      }
      range.until = parsed;
    }

    return range;
  }

  private static async showConsoleOutput(options: ViewOptions): Promise<void> {
    const query = QueryInterface.getInstance();
    const logger = UnifiedLogger.getInstance();
    const context = 'LogCommands';

    // Parse and validate level
    const level = parseLogLevel(options.level);

    // Parse time range
    const timeRange = this.parseTimeRange(options);
    if ('error' in timeRange) {
      logger.error(chalk.red(`✗ ${timeRange.error}`), undefined, context);
      return;
    }

    try {
      // Query text logs
      const result = await query.queryTextLogs({
        context: options.context,
        level,
        since: timeRange.since,
        until: timeRange.until,
        limit: options.lines || DEFAULT_LINES,
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

      // Show decision path if requested
      if (options.decisionPath) {
        const decisions = extractDecisionInfo(logs);
        if (decisions.length > 0) {
          logger.info(chalk.blue('\n📊 Decision Path Information:\n'), {}, context);

          // Group by cycle if available
          const grouped = groupDecisionsByCycle(decisions);
          if (grouped.size > 0) {
            for (const [cycleId, cycleDecisions] of Array.from(grouped.entries()).sort(
              (a, b) => b[0] - a[0]
            )) {
              const summary = formatDecisionSummary(cycleId, cycleDecisions, false);
              logger.info(summary, {}, context);
            }
          } else {
            // Show individual decisions if no cycle grouping
            for (const decision of decisions) {
              const parts: string[] = [];
              if (decision.symbol) parts.push(`Symbol: ${decision.symbol}`);
              if (decision.action) parts.push(`Action: ${decision.action}`);
              if (decision.reasoning)
                parts.push(`Reasoning: ${decision.reasoning.substring(0, 100)}...`);
              if (parts.length > 0) {
                logger.info(`  ${parts.join(' | ')}`, {}, context);
              }
            }
          }
        } else {
          logger.info(chalk.dim('  No decision path information found in logs'), {}, context);
        }
      }

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
        // Use the latest timestamp (logs are sorted DESC, so first log is newest)
        const latestTimestamp = logs.length > 0 ? logs[0].timestamp : Date.now();
        await this.startFollowMode({
          query,
          options: {
            context: options.context,
            level,
            grep: options.grep,
            format: options.format,
          },
          initialTimestamp: latestTimestamp,
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
  private static displayLogs(logs: TextLog[], format?: string): void {
    const logger = UnifiedLogger.getInstance();
    const context = 'LogCommands';
    // Logs are already sorted by timestamp DESC (newest first)
    // For display, we want oldest first so they appear in chronological order
    const sortedLogs = [...logs].reverse();

    // Format based on user preference, default to structured
    const formatted =
      format === 'json' ? formatLogsAsJson(sortedLogs) : formatLogsAsStructured(sortedLogs);

    logger.info(formatted, {}, context);
  }

  /**
   * Start follow mode to poll for new logs
   */
  private static async startFollowMode(options: {
    query: QueryInterface;
    options: FollowModeOptions;
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
            limit: FOLLOW_MODE_BATCH_LIMIT,
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
      }, FOLLOW_MODE_POLL_INTERVAL);

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
   * Determine which files should be deleted based on options
   */
  private static getFilesToDelete(
    files: LogFileMetadata[],
    options: CleanOptions
  ): LogFileMetadata[] {
    if (options.all) {
      return files;
    }

    if (options.days) {
      const cutoff = Date.now() - options.days * 24 * 60 * 60 * 1000;
      return files.filter(f => f.mtime.getTime() < cutoff);
    }

    // Default: delete files older than retention period
    const cutoff = Date.now() - DEFAULT_RETENTION_DAYS * 24 * 60 * 60 * 1000;
    return files.filter(f => f.mtime.getTime() < cutoff);
  }

  /**
   * Clean log files
   */
  private static async cleanLogs(options: CleanOptions): Promise<void> {
    const logger = UnifiedLogger.getInstance();
    const context = 'LogCommands';
    const files = await getLogFiles();

    if (files.length === 0) {
      logger.info(chalk.yellow('⚠️  No log files found'), {}, context);
      return;
    }

    const filesToDelete = this.getFilesToDelete(files, options);

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
  private static async listLogFiles(options: ListOptions): Promise<void> {
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
  private static async showStats(options: StatsOptions): Promise<void> {
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
      limit: STATS_QUERY_LIMIT,
    });

    const logs = result.logs;

    if (logs.length === 0) {
      logger.info(chalk.yellow('⚠️  No logs found matching the criteria'));
      return;
    }

    // Aggregate statistics
    const stats = this.aggregateStats(logs);

    const format = options.format || 'table';
    const output =
      format === 'json' ? formatStatsAsJson(stats) : formatStatsAsTable(stats, options.allContexts);

    logger.info(output, {}, context);
  }

  /**
   * Filter decisions by options (cycle ID, symbol)
   */
  private static filterDecisions(
    decisions: DecisionInfo[],
    options: { cycleId?: number; symbol?: string }
  ): DecisionInfo[] {
    let filtered = decisions;

    if (options.cycleId !== undefined) {
      filtered = filtered.filter(d => d.cycleId === options.cycleId);
    }

    if (options.symbol) {
      const symbolUpper = options.symbol.toUpperCase();
      filtered = filtered.filter(
        d =>
          d.symbol?.toUpperCase() === symbolUpper || d.symbol?.toUpperCase().startsWith(symbolUpper)
      );
    }

    return filtered;
  }

  /**
   * Format decisions as JSON output
   */
  private static formatDecisionsAsJson(decisions: DecisionInfo[]): string {
    return JSON.stringify(
      decisions.map(d => ({
        cycleId: d.cycleId,
        timestamp: d.timestamp,
        timestampISO: new Date(d.timestamp).toISOString(),
        symbol: d.symbol,
        action: d.action,
        reasoning: d.reasoning,
        confidence: d.confidence,
        validation: d.validation,
        sizing: d.sizing,
        execution: d.execution,
        metadata: d.metadata,
      })),
      null,
      2
    );
  }

  /**
   * Format decisions as structured output
   */
  private static formatDecisionsAsStructured(decisions: DecisionInfo[], verbose: boolean): string {
    const grouped = groupDecisionsByCycle(decisions);
    const lines: string[] = [];

    if (grouped.size > 0) {
      // Show cycles in descending order (newest first)
      const sortedCycles = Array.from(grouped.entries()).sort((a, b) => b[0] - a[0]);

      for (const [cycleId, cycleDecisions] of sortedCycles) {
        lines.push(formatDecisionSummary(cycleId, cycleDecisions, verbose));

        // Show detailed factors if verbose
        if (verbose) {
          for (const decision of cycleDecisions) {
            if (decision.metadata?.factors) {
              const factorsStr = formatDecisionFactors(decision.metadata.factors, true);
              if (factorsStr) {
                lines.push(factorsStr);
              }
            }
          }
        }
      }
    } else {
      // No cycle grouping - show individual decisions
      lines.push(chalk.blue('\n📊 Trading Decisions\n'));
      for (const decision of decisions) {
        const parts: string[] = [];
        if (decision.symbol) parts.push(chalk.bold(decision.symbol));
        if (decision.action) {
          const actionColor =
            decision.action === 'LONG'
              ? chalk.green
              : decision.action === 'SHORT'
                ? chalk.red
                : decision.action === 'CLOSE'
                  ? chalk.yellow
                  : chalk.gray;
          parts.push(actionColor(decision.action));
        }
        if (decision.confidence !== undefined) {
          parts.push(`Confidence: ${(decision.confidence * 100).toFixed(1)}%`);
        }
        if (decision.reasoning) {
          const reasoning = verbose
            ? decision.reasoning
            : decision.reasoning.substring(0, 150) + '...';
          parts.push(`Reasoning: ${reasoning}`);
        }
        lines.push(`  ${parts.join(' | ')}`);
      }
    }

    return lines.join('\n');
  }

  /**
   * Display decisions based on format
   */
  private static displayDecisions(decisions: DecisionInfo[], options: DecisionsOptions): void {
    const logger = UnifiedLogger.getInstance();
    const context = 'LogCommands';
    const format = options.format || 'structured';
    const verbose = options.verbose || false;

    if (format === 'json') {
      const jsonOutput = this.formatDecisionsAsJson(decisions);
      logger.info(jsonOutput, {}, context);
    } else {
      const structuredOutput = this.formatDecisionsAsStructured(decisions, verbose);
      logger.info(structuredOutput, {}, context);
    }
  }

  /**
   * Start follow mode for decisions
   */
  private static async startDecisionsFollowMode(
    options: DecisionsOptions,
    initialTimestamp: number
  ): Promise<void> {
    const query = QueryInterface.getInstance();
    const logger = UnifiedLogger.getInstance();
    const context = 'LogCommands';
    const verbose = options.verbose || false;

    logger.info(chalk.gray('\n--- Following decisions (press Ctrl+C to stop) ---\n'), {}, context);

    let pollInterval: NodeJS.Timeout | undefined;
    let lastTimestamp = initialTimestamp;
    const seenDecisions = new Set<string>();

    try {
      pollInterval = setInterval(async () => {
        try {
          const newResult = await query.queryTextLogs({
            context: 'Workflow',
            since: lastTimestamp + 1,
            limit: 100,
          });

          const newDecisions = extractDecisionInfo(newResult.logs);
          const filtered = this.filterDecisions(newDecisions, options);

          // Display new decisions
          for (const decision of filtered) {
            const decisionKey = `${decision.cycleId}-${decision.symbol}-${decision.action}-${decision.timestamp}`;
            if (!seenDecisions.has(decisionKey)) {
              seenDecisions.add(decisionKey);
              const summary = formatDecisionSummary(decision.cycleId || 0, [decision], verbose);
              logger.info(summary, {}, context);
              lastTimestamp = Math.max(lastTimestamp, decision.timestamp);
            }
          }
        } catch (error) {
          logger.error(chalk.red('Error polling decisions:'), error, context);
        }
      }, FOLLOW_MODE_POLL_INTERVAL);

      // Handle Ctrl+C
      const sigintHandler = () => {
        if (pollInterval) {
          clearInterval(pollInterval);
        }
        this.cleanupResources();
        logger.info(chalk.yellow('\n\nStopped following decisions.'));
        process.exitCode = 0;
      };
      process.on('SIGINT', sigintHandler);

      // Keep process alive
      await new Promise(() => {
        // Never resolves, keeps process alive until SIGINT or error
      });
    } catch (error) {
      logger.error(chalk.red('Error in follow mode:'), error);
      throw error;
    } finally {
      if (pollInterval) {
        clearInterval(pollInterval);
      }
      this.cleanupResources();
    }
  }

  /**
   * Show trading decisions analysis
   */
  private static async showDecisions(options: DecisionsOptions): Promise<void> {
    const query = QueryInterface.getInstance();
    const logger = UnifiedLogger.getInstance();
    const context = 'LogCommands';

    // Parse time range
    const timeRange = this.parseTimeRange(options);
    if ('error' in timeRange) {
      logger.error(chalk.red(`✗ ${timeRange.error}`), undefined, context);
      return;
    }

    try {
      // Query text logs - focus on workflow and signal-related contexts
      const result = await query.queryTextLogs({
        context: 'Workflow', // Focus on workflow logs which contain decision info
        since: timeRange.since,
        until: timeRange.until,
        limit: 1000, // Get more logs for decision analysis
        offset: 0,
      });

      // Extract and filter decision information
      const allDecisions = extractDecisionInfo(result.logs);
      const decisions = this.filterDecisions(allDecisions, options);

      if (decisions.length === 0) {
        logger.info(
          chalk.yellow('⚠️  No trading decisions found matching the criteria'),
          {},
          context
        );
        return;
      }

      // Display decisions
      this.displayDecisions(decisions, options);

      // Follow mode for decisions
      if (options.follow) {
        const latestTimestamp =
          decisions.length > 0 ? Math.max(...decisions.map(d => d.timestamp)) : Date.now();
        await this.startDecisionsFollowMode(options, latestTimestamp);
      }
    } finally {
      if (!options.follow) {
        this.cleanupResources();
      }
    }
  }
}

import { Command } from 'commander';
import chalk from 'chalk';
import { QueryInterface } from '../../logging/index.js';
import { UnifiedLogger } from '../../logging/index.js';
import { handleAsync } from '../../utils/error-handler.js';

export class LogCommands {
  static register(program: Command): void {
    // Lite mode: hide non-console log commands

    // Show console output
    program
      .command('console')
      .description('View console output logs')
      .option('--lines <n>', 'Show last N lines (default: 50)', parseInt, 50)
      .option('-f, --follow', 'Follow mode (real-time updates)', false)
      .option('--context <context>', 'Filter by logger context (e.g., TradeStart, Server)')
      .option('--level <level>', 'Filter by log level (info|warn|error|debug)')
      .option('--grep <pattern>', 'Search/filter by pattern in message')
      .option('--format <format>', 'Output format (formatted|raw)', 'formatted')
      .action(async options => {
        await handleAsync(async () => {
          await LogCommands.showConsoleOutput(options);
        }, 'LogCommands.console');
      });
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

    // Get original console to bypass interception when displaying logs
    const originalConsole = logger.getOriginalConsole();

    // Parse and validate level
    const level = this.parseLogLevel(options.level);

    try {
      // Query text logs
      const result = await query.queryTextLogs({
        context: options.context,
        level,
        limit: options.lines || 50,
        offset: 0,
      });

      // Filter logs by grep pattern if specified
      const logs = this.filterLogsByGrep(result.logs, options.grep);

      // Display logs
      if (logs.length === 0) {
        originalConsole.log(chalk.yellow('⚠️  No console output found matching the criteria'));
        return;
      }

      // Display initial logs (sorted chronologically)
      this.displayLogs(logs, originalConsole, options.format);

      // Show info message for non-follow mode
      if (!options.follow) {
        originalConsole.log(
          chalk.gray(
            `\n--- Showing last ${logs.length} log entries (use --follow for real-time updates) ---`
          )
        );
      }

      // Follow mode: Poll for new logs
      if (options.follow) {
        await this.startFollowMode({
          query,
          originalConsole,
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
   * Parse and validate log level option
   */
  private static parseLogLevel(level?: string): 'info' | 'warn' | 'error' | 'debug' | undefined {
    if (!level) {
      return undefined;
    }
    const normalized = level.toLowerCase();
    if (['info', 'warn', 'error', 'debug'].includes(normalized)) {
      return normalized as 'info' | 'warn' | 'error' | 'debug';
    }
    return undefined;
  }

  /**
   * Filter logs by grep pattern
   */
  private static filterLogsByGrep<T extends { message: string; context: string }>(
    logs: T[],
    grep?: string
  ): T[] {
    if (!grep) {
      return logs;
    }
    const pattern = new RegExp(grep, 'i');
    return logs.filter(log => pattern.test(log.message) || pattern.test(log.context));
  }

  /**
   * Display logs to console
   */
  private static displayLogs(
    logs: Array<{ message: string; formattedMessage?: string }>,
    originalConsole: { log: typeof console.log },
    format?: string
  ): void {
    // Logs are already sorted by timestamp DESC (newest first)
    // For display, we want oldest first so they appear in chronological order
    const sortedLogs = [...logs].reverse();

    for (const log of sortedLogs) {
      if (format === 'raw') {
        originalConsole.log(log.message);
      } else {
        // Use formatted message (with ANSI codes) for display
        originalConsole.log(log.formattedMessage || log.message);
      }
    }
  }

  /**
   * Start follow mode to poll for new logs
   */
  private static async startFollowMode(options: {
    query: QueryInterface;
    originalConsole: { log: typeof console.log; error: typeof console.error };
    options: {
      context?: string;
      level?: 'info' | 'warn' | 'error' | 'debug';
      grep?: string;
      format?: string;
    };
    initialTimestamp: number;
  }): Promise<void> {
    const { query, originalConsole, options: queryOptions, initialTimestamp } = options;
    let pollInterval: NodeJS.Timeout | undefined;
    let lastTimestamp = initialTimestamp;

    try {
      originalConsole.log(chalk.gray('\n--- Following logs (press Ctrl+C to stop) ---\n'));

      pollInterval = setInterval(async () => {
        try {
          const newResult = await query.queryTextLogs({
            context: queryOptions.context,
            level: queryOptions.level,
            since: lastTimestamp + 1, // Only get logs newer than last seen
            limit: 100,
          });

          const newLogs = this.filterLogsByGrep(newResult.logs, queryOptions.grep);

          // Sort by timestamp ascending (oldest first)
          newLogs.sort((a, b) => a.timestamp - b.timestamp);

          // Display new logs and update timestamp
          for (const log of newLogs) {
            this.displayLogs([log], originalConsole, queryOptions.format);
            lastTimestamp = Math.max(lastTimestamp, log.timestamp);
          }
        } catch (error) {
          originalConsole.error(chalk.red('Error polling logs:'), error);
        }
      }, 1000); // Poll every second

      // Handle Ctrl+C
      const sigintHandler = () => {
        if (pollInterval) {
          clearInterval(pollInterval);
        }
        this.cleanupResources();
        originalConsole.log(chalk.yellow('\n\nStopped following logs.'));
        process.exit(0);
      };
      process.on('SIGINT', sigintHandler);

      // Keep process alive
      await new Promise(() => {
        // Never resolves, keeps process alive until SIGINT or error
      });
    } catch (error) {
      // Handle any errors that occur during follow mode setup or execution
      originalConsole.error(chalk.red('Error in follow mode:'), error);
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
}

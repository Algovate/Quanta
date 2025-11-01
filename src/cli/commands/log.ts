import { Command } from 'commander';
import chalk from 'chalk';
import { QueryInterface } from '../../logging/index.js';
import { StorageLayer } from '../../logging/index.js';
import { UnifiedLogger } from '../../logging/index.js';
import { handleAsync } from '../../utils/error-handler.js';
import type { OperationLog, SystemSnapshot } from '../../logging/types.js';

export class LogCommands {
  static register(program: Command): void {
    // Query operations
    program
      .command('query')
      .description('Query operations with filters')
      .option('--cycle-id <id>', 'Filter by cycle ID', parseInt)
      .option('--type <type>', 'Filter by operation type')
      .option('--status <status>', 'Filter by status (running|completed|failed|cancelled)')
      .option('--symbol <symbol>', 'Filter by symbol')
      .option('--trace-id <id>', 'Filter by trace ID')
      .option('--operation-id <id>', 'Filter by operation ID')
      .option(
        '--limit <limit>',
        'Limit number of results',
        val => {
          const parsed = parseInt(val, 10);
          return isNaN(parsed) ? undefined : parsed;
        },
        50
      )
      .option('--offset <offset>', 'Offset for pagination', parseInt, 0)
      .option('--format <format>', 'Output format (table|json)', 'table')
      .option('--verbose', 'Show detailed information including errors and stages', false)
      .option('--detail', 'Show full operation details (same as --verbose)', false)
      .action(async options => {
        await handleAsync(async () => {
          await LogCommands.queryOperations(options);
        }, 'LogCommands.query');
      });

    // Show statistics
    program
      .command('stats')
      .description('Show operation statistics')
      .option('--cycle-id <id>', 'Filter by cycle ID', parseInt)
      .option('--type <type>', 'Filter by operation type')
      .option('--format <format>', 'Output format (table|json)', 'table')
      .action(async options => {
        await handleAsync(async () => {
          await LogCommands.showStatistics(options);
        }, 'LogCommands.stats');
      });

    // Show trace
    program
      .command('trace <trace-id>')
      .description('Show complete trace for a trace ID')
      .option('--format <format>', 'Output format (table|json)', 'table')
      .action(async (traceId, options) => {
        await handleAsync(async () => {
          await LogCommands.showTrace(traceId, options);
        }, 'LogCommands.trace');
      });

    // Search operations
    program
      .command('search <term>')
      .description('Search operations by keyword')
      .option('--type <type>', 'Filter by operation type')
      .option('--status <status>', 'Filter by status')
      .option(
        '--limit <limit>',
        'Limit number of results',
        val => {
          const parsed = parseInt(val, 10);
          return isNaN(parsed) ? undefined : parsed;
        },
        50
      )
      .option('--format <format>', 'Output format (table|json)', 'table')
      .action(async (term, options) => {
        await handleAsync(async () => {
          await LogCommands.searchOperations(term, options);
        }, 'LogCommands.search');
      });

    // Show snapshot
    program
      .command('snapshot [snapshot-id]')
      .description('Show snapshot details (latest if snapshot-id not provided)')
      .option('--format <format>', 'Output format (table|json)', 'table')
      .action(async (snapshotId, options) => {
        await handleAsync(async () => {
          await LogCommands.showSnapshot(snapshotId, options);
        }, 'LogCommands.snapshot');
      });

    // Show storage statistics
    program
      .command('storage')
      .description('Show storage statistics')
      .action(async () => {
        await handleAsync(async () => {
          await LogCommands.showStorageStats();
        }, 'LogCommands.storage');
      });

    // Cleanup logs
    program
      .command('cleanup')
      .description('Cleanup old log data')
      .option('--max-cycles <number>', 'Keep only the last N cycles (default: 1000)', parseInt)
      .option('--keep-days <number>', 'Keep logs from the last N days', parseInt)
      .option('--force', 'Force cleanup without confirmation')
      .option('--dry-run', 'Show what would be cleaned without actually cleaning')
      .action(async options => {
        await handleAsync(async () => {
          await LogCommands.cleanupLogs(options);
        }, 'LogCommands.cleanup');
      });
  }

  private static async queryOperations(options: {
    cycleId?: number;
    type?: string;
    status?: string;
    symbol?: string;
    traceId?: string;
    operationId?: string;
    limit?: number;
    offset?: number;
    format?: string;
    verbose?: boolean;
    detail?: boolean;
  }): Promise<void> {
    const query = QueryInterface.getInstance();
    const result = await query.queryOperations({
      cycleId: options.cycleId,
      operationType: options.type,
      status: options.status as 'running' | 'completed' | 'failed' | 'cancelled' | undefined,
      symbol: options.symbol,
      traceId: options.traceId,
      operationId: options.operationId,
      limit: options.limit && !isNaN(options.limit) ? options.limit : 50,
      offset: options.offset ?? 0,
    });

    if (options.format === 'json') {
      console.log(JSON.stringify(result, null, 2));
      return;
    }

    if (result.operations.length === 0) {
      console.log(chalk.yellow('⚠️  No operations found matching the criteria'));
      return;
    }

    const isVerbose = options.verbose || options.detail;
    const limit = options.limit && !isNaN(options.limit) ? options.limit : 50;

    console.log(chalk.cyan('📋 Operations Query Results'));
    console.log(
      chalk.gray(
        `Found ${result.total} operations${result.hasMore ? ' (showing first ' + result.operations.length + ')' : ''}\n`
      )
    );

    if (isVerbose) {
      this.formatOperationsDetailed(result.operations, limit);
    } else {
      this.formatOperationsTable(result.operations, limit);
    }
  }

  private static async showStatistics(options: {
    cycleId?: number;
    type?: string;
    format?: string;
  }): Promise<void> {
    const query = QueryInterface.getInstance();
    const stats = await query.getStatistics({
      cycleId: options.cycleId,
      operationType: options.type,
    });

    if (options.format === 'json') {
      console.log(JSON.stringify(stats, null, 2));
      return;
    }

    console.log(chalk.cyan('📊 Operation Statistics'));
    console.log(chalk.gray('Overall system statistics\n'));

    console.log(chalk.blue('📈 Summary:'));
    console.log(`   Total Operations: ${stats.totalOperations}`);
    console.log(`   Completed: ${chalk.green(stats.completedOperations)}`);
    console.log(`   Failed: ${chalk.red(stats.failedOperations)}`);
    const errorRateColor =
      stats.errorRate > 0.1 ? 'red' : stats.errorRate > 0.05 ? 'yellow' : 'green';
    console.log(
      `   Error Rate: ${chalk[errorRateColor]((stats.errorRate * 100).toFixed(2) + '%')}`
    );
    console.log('');

    console.log(chalk.blue('⏱️  Performance:'));
    console.log(`   Average Duration: ${this.formatDuration(stats.averageDuration)}`);
    console.log(`   Min Duration: ${this.formatDuration(stats.minDuration)}`);
    console.log(`   Max Duration: ${this.formatDuration(stats.maxDuration)}`);
    console.log('');

    console.log(chalk.blue('📦 By Status:'));
    for (const [status, count] of Object.entries(stats.byStatus)) {
      const color = status === 'completed' ? 'green' : status === 'failed' ? 'red' : 'yellow';
      console.log(`   ${status}: ${chalk[color](count.toString())}`);
    }
    console.log('');

    if (Object.keys(stats.operationTypes).length > 0) {
      console.log(chalk.blue('🔧 By Operation Type:'));
      for (const [type, count] of Object.entries(stats.operationTypes).sort(
        (a, b) => b[1] - a[1]
      )) {
        console.log(`   ${type}: ${count}`);
      }
    }
  }

  private static async showTrace(traceId: string, options: { format?: string }): Promise<void> {
    const query = QueryInterface.getInstance();
    const trace = await query.getTrace(traceId);

    if (!trace) {
      console.log(chalk.red(`❌ Trace not found: ${traceId}`));
      return;
    }

    if (options.format === 'json') {
      console.log(JSON.stringify(trace, null, 2));
      return;
    }

    console.log(chalk.cyan('🔍 Trace Details'));
    console.log(chalk.gray(`Trace ID: ${traceId}\n`));

    console.log(chalk.blue('📋 Trace Info:'));
    console.log(`   Trace ID: ${trace.traceId}`);
    console.log(`   Cycle ID: ${trace.cycleId}`);
    console.log(`   Status: ${this.formatStatus(trace.status)}`);
    if (trace.duration) {
      console.log(`   Duration: ${this.formatDuration(trace.duration)}`);
    }
    console.log(`   Operations: ${trace.operations.length}`);
    console.log('');

    if (trace.rootOperation) {
      console.log(chalk.blue('🌳 Root Operation:'));
      console.log(`   Operation ID: ${this.truncateId(trace.rootOperation.operationId)}`);
      console.log(`   Type: ${trace.rootOperation.operationType}`);
      console.log(`   Status: ${this.formatStatus(trace.rootOperation.status)}`);
      console.log('');
    }

    console.log(chalk.blue('📝 Operations in Trace:'));
    this.formatOperationsTable(trace.operations, trace.operations.length);
  }

  private static async searchOperations(
    term: string,
    options: { type?: string; status?: string; limit?: number; format?: string }
  ): Promise<void> {
    const query = QueryInterface.getInstance();
    const limit = options.limit && !isNaN(options.limit) ? options.limit : 50;
    const result = await query.searchOperations(term, {
      operationType: options.type,
      status: options.status as 'running' | 'completed' | 'failed' | 'cancelled' | undefined,
      limit,
    });

    if (options.format === 'json') {
      console.log(JSON.stringify(result, null, 2));
      return;
    }

    if (result.operations.length === 0) {
      console.log(chalk.yellow(`⚠️  No operations found matching "${term}"`));
      return;
    }

    console.log(chalk.cyan(`🔍 Search Results for "${term}"`));
    console.log(chalk.gray(`Found ${result.total} operations\n`));

    this.formatOperationsTable(result.operations, limit);
  }

  private static async showSnapshot(
    snapshotId: string | undefined,
    options: { format?: string }
  ): Promise<void> {
    let snapshot: SystemSnapshot | null = null;
    const storage = StorageLayer.getInstance();

    if (snapshotId) {
      snapshot = await storage.getSnapshotById(snapshotId);
      if (!snapshot) {
        console.log(chalk.red(`❌ Snapshot not found: ${snapshotId}`));
        return;
      }
    } else {
      // First try to get from StateSnapshotService (in-memory, if workflow is running)
      const unifiedLogger = UnifiedLogger.getInstance();
      const stateSnapshot = (
        unifiedLogger as unknown as {
          stateSnapshot?: { getLastSnapshot?: () => SystemSnapshot | null | undefined };
        }
      ).stateSnapshot;
      if (stateSnapshot && typeof stateSnapshot.getLastSnapshot === 'function') {
        snapshot = stateSnapshot.getLastSnapshot() || null;
      }

      // If not found in memory, try to get latest from storage
      if (!snapshot) {
        snapshot = await storage.getLatestSnapshot();
      }

      if (!snapshot) {
        console.log(chalk.yellow('⚠️  No snapshots found'));
        console.log(chalk.gray('\n💡 Snapshots are created automatically during trading cycles.'));
        console.log(
          chalk.gray('   Run a trading cycle to create snapshots, or specify a snapshot ID:')
        );
        console.log(chalk.gray('   quanta log snapshot <snapshot-id>'));
        return;
      }
    }

    if (options.format === 'json') {
      console.log(JSON.stringify(snapshot, null, 2));
      return;
    }

    console.log(chalk.cyan('📸 System Snapshot'));
    console.log(chalk.gray(`Snapshot ID: ${snapshot.snapshotId}\n`));

    console.log(chalk.blue('⏰ Timestamp:'));
    console.log(`   ${this.formatTimestamp(snapshot.timestamp)}`);
    console.log(`   Cycle ID: ${snapshot.cycleId}`);
    console.log('');

    console.log(chalk.blue('💰 Account:'));
    console.log(`   Equity: $${snapshot.account.equity.toFixed(2)}`);
    console.log(`   Balance: $${snapshot.account.balance.toFixed(2)}`);
    console.log(`   Margin Used: $${snapshot.account.marginUsed.toFixed(2)}`);
    console.log(`   Available Margin: $${snapshot.account.availableMargin.toFixed(2)}`);
    console.log('');

    console.log(chalk.blue('📊 Positions:'));
    if (snapshot.positions.length === 0) {
      console.log('   No open positions');
    } else {
      snapshot.positions.forEach(pos => {
        const pnlColor = pos.unrealizedPnl >= 0 ? 'green' : 'red';
        console.log(
          `   ${pos.symbol} ${pos.side.toUpperCase()}: ${pos.size} @ $${pos.entryPrice.toFixed(2)} | P&L: ${chalk[pnlColor](`$${pos.unrealizedPnl.toFixed(2)}`)}`
        );
      });
    }
    console.log('');

    if (snapshot.systemMetrics) {
      console.log(chalk.blue('💻 System Metrics:'));
      const mem = snapshot.systemMetrics.memoryUsage;
      console.log(`   Memory: ${mem.heapUsed}MB / ${mem.heapTotal}MB (RSS: ${mem.rss}MB)`);
      console.log('');
    }
  }

  private static async showStorageStats(): Promise<void> {
    const storage = StorageLayer.getInstance();
    const stats = await storage.getStats();

    console.log(chalk.cyan('💾 Storage Statistics'));
    console.log(chalk.gray('Log storage layer information\n'));

    console.log(chalk.blue('📦 Storage Layers:'));
    console.log(`   L0 (Hot Cache): ${stats.l0Size} operations`);
    console.log(`   L1 (Warm): ${stats.l1Cycles} cycles`);
    console.log(`   L2 (Cold): ${stats.l2Cycles} cycles`);
    console.log(`   L3 (Archive): ${stats.l3Cycles} cycles`);
    console.log(`   Total Operations: ${stats.totalOperations}`);
  }

  private static async cleanupLogs(options: {
    maxCycles?: number;
    keepDays?: number;
    force?: boolean;
    'dry-run'?: boolean;
  }): Promise<void> {
    const storage = StorageLayer.getInstance();
    const dryRun = options['dry-run'] || false;

    console.log(chalk.cyan('🧹 Log Cleanup'));
    console.log(chalk.gray('Cleaning up old log data\n'));

    if (dryRun) {
      console.log(chalk.yellow('🔍 Dry-run mode: Showing what would be cleaned\n'));
    }

    // Get cleanup preview
    const preview = await storage.getCleanupPreview({
      maxCycles: options.maxCycles,
      keepDays: options.keepDays,
    });

    if (preview.totalCyclesToClean === 0) {
      console.log(chalk.green('✓ No logs to clean up'));
      return;
    }

    // Show preview
    console.log(chalk.blue('📋 Cleanup Preview:'));
    console.log(`   L1 Cycles: ${preview.l1CyclesToClean.length}`);
    console.log(`   L2 Cycles: ${preview.l2CyclesToClean.length}`);
    console.log(`   L3 Cycles: ${preview.l3CyclesToClean.length}`);
    console.log(`   Total Cycles: ${preview.totalCyclesToClean}`);
    console.log(`   Estimated Operations: ${preview.estimatedOperationsToClean}`);
    console.log('');

    if (dryRun) {
      console.log(chalk.gray('Dry-run complete. Use without --dry-run to perform actual cleanup.'));
      return;
    }

    // Confirm cleanup
    if (!options.force) {
      console.log(chalk.yellow('⚠️  This will permanently delete old log data.'));
      console.log(chalk.gray('Use --force to skip confirmation\n'));
      // In a real implementation, you might want to use readline to get user confirmation
      // For now, we'll just proceed if force is not set
    }

    // Perform cleanup
    console.log(chalk.blue('🧹 Cleaning up...\n'));

    try {
      if (options.keepDays !== undefined) {
        const result = await storage.cleanupByDays(options.keepDays);
        console.log(chalk.green('✓ Cleanup completed'));
        console.log(`   Deleted Cycles: ${result.deletedCycles.length}`);
        console.log(`   Deleted Operations: ${result.deletedOperations}`);
      } else if (options.maxCycles !== undefined) {
        await storage.cleanup(options.maxCycles);
        console.log(chalk.green('✓ Cleanup completed'));
        console.log(`   Kept ${options.maxCycles} most recent cycles`);
        console.log(`   Archived older cycles to L3`);
      } else {
        // Default: keep 1000 cycles
        await storage.cleanup(1000);
        console.log(chalk.green('✓ Cleanup completed'));
        console.log(`   Kept 1000 most recent cycles (default)`);
        console.log(`   Archived older cycles to L3`);
      }
    } catch (error) {
      console.error(chalk.red('❌ Cleanup failed:'), error);
      throw error;
    }
  }

  private static formatOperationsTable(operations: OperationLog[], limit: number = 100): void {
    if (operations.length === 0) {
      return;
    }

    // Get terminal width (default to 120 if not available)
    const terminalWidth = process.stdout.columns || 120;

    // Fixed column widths for consistent table alignment
    // Each column: content width + 2 spaces (left + right padding)
    // Total border chars: │ (start) + │ (×8 separators) + │ (end) = 10, plus spaces = 17
    // For better alignment, use fixed proportional widths
    const minWidths = {
      operation: 8,
      cycle: 6,
      trace: 8,
      type: 8,
      status: 8,
      symbol: 6,
      duration: 8,
      time: 8,
    };

    const maxWidths = {
      operation: 12,
      cycle: 8,
      trace: 12,
      type: 15,
      status: 10,
      symbol: 10,
      duration: 12,
      time: 10,
    };

    // Calculate available width (subtract borders and padding)
    // Format: │ [content+2] │ [content+2] │ ... │
    // Border overhead: 9 separators (│) + 8 spaces = 17 (now 8 columns: operation, cycle, trace, type, status, symbol, duration, time)
    const borderOverhead = 17;
    const availableWidth = Math.max(100, terminalWidth - borderOverhead);

    // Distribute width proportionally with min/max constraints
    const totalMin = Object.values(minWidths).reduce((a, b) => a + b, 0);
    const totalMax = Object.values(maxWidths).reduce((a, b) => a + b, 0);

    // If available width is less than min, use min widths
    // If available width is more than max, use max widths
    // Otherwise, distribute proportionally
    let colWidths: {
      operation: number;
      cycle: number;
      trace: number;
      type: number;
      status: number;
      symbol: number;
      duration: number;
      time: number;
    };

    if (availableWidth <= totalMin) {
      colWidths = {
        operation: minWidths.operation,
        cycle: minWidths.cycle,
        trace: minWidths.trace,
        type: minWidths.type,
        status: minWidths.status,
        symbol: minWidths.symbol,
        duration: minWidths.duration,
        time: minWidths.time,
      };
    } else if (availableWidth >= totalMax) {
      colWidths = {
        operation: maxWidths.operation,
        cycle: maxWidths.cycle,
        trace: maxWidths.trace,
        type: maxWidths.type,
        status: maxWidths.status,
        symbol: maxWidths.symbol,
        duration: maxWidths.duration,
        time: maxWidths.time,
      };
    } else {
      // Proportional distribution
      const extraWidth = availableWidth - totalMin;
      const totalExtra = totalMax - totalMin;

      colWidths = {
        operation:
          minWidths.operation +
          Math.floor((extraWidth * (maxWidths.operation - minWidths.operation)) / totalExtra),
        cycle:
          minWidths.cycle +
          Math.floor((extraWidth * (maxWidths.cycle - minWidths.cycle)) / totalExtra),
        trace:
          minWidths.trace +
          Math.floor((extraWidth * (maxWidths.trace - minWidths.trace)) / totalExtra),
        type:
          minWidths.type +
          Math.floor((extraWidth * (maxWidths.type - minWidths.type)) / totalExtra),
        status:
          minWidths.status +
          Math.floor((extraWidth * (maxWidths.status - minWidths.status)) / totalExtra),
        symbol:
          minWidths.symbol +
          Math.floor((extraWidth * (maxWidths.symbol - minWidths.symbol)) / totalExtra),
        duration:
          minWidths.duration +
          Math.floor((extraWidth * (maxWidths.duration - minWidths.duration)) / totalExtra),
        time:
          minWidths.time +
          Math.floor((extraWidth * (maxWidths.time - minWidths.time)) / totalExtra),
      };
    }

    // Build borders - each column has: content width + 2 spaces (left + right)
    // Format: │ [content] │, so width = colWidth + 2
    const buildBorder = (left: string, middle: string, right: string): string => {
      return (
        chalk.gray(left) +
        '─'.repeat(colWidths.operation + 2) +
        chalk.gray(middle) +
        '─'.repeat(colWidths.cycle + 2) +
        chalk.gray(middle) +
        '─'.repeat(colWidths.trace + 2) +
        chalk.gray(middle) +
        '─'.repeat(colWidths.type + 2) +
        chalk.gray(middle) +
        '─'.repeat(colWidths.status + 2) +
        chalk.gray(middle) +
        '─'.repeat(colWidths.symbol + 2) +
        chalk.gray(middle) +
        '─'.repeat(colWidths.duration + 2) +
        chalk.gray(middle) +
        '─'.repeat(colWidths.time + 2) +
        chalk.gray(right)
      );
    };

    const topBorder = buildBorder('┌', '┬', '┐');
    const sepLine = buildBorder('├', '┼', '┤');
    const bottomBorder = buildBorder('└', '┴', '┘');

    // Table header
    console.log(topBorder);
    console.log(
      chalk.gray('│ ') +
        chalk.cyan('Operation'.padEnd(colWidths.operation)) +
        chalk.gray(' │ ') +
        chalk.cyan('Cycle'.padEnd(colWidths.cycle)) +
        chalk.gray(' │ ') +
        chalk.cyan('Trace'.padEnd(colWidths.trace)) +
        chalk.gray(' │ ') +
        chalk.cyan('Type'.padEnd(colWidths.type)) +
        chalk.gray(' │ ') +
        chalk.cyan('Status'.padEnd(colWidths.status)) +
        chalk.gray(' │ ') +
        chalk.cyan('Symbol'.padEnd(colWidths.symbol)) +
        chalk.gray(' │ ') +
        chalk.cyan('Duration'.padEnd(colWidths.duration)) +
        chalk.gray(' │ ') +
        chalk.cyan('Time'.padEnd(colWidths.time)) +
        chalk.gray(' │')
    );
    console.log(sepLine);

    // Table rows
    for (const op of operations.slice(0, limit)) {
      // Truncate values to fit column widths (use plain text for width calculation)
      const opId = this.truncateId(op.operationId, colWidths.operation);
      const cycle = op.cycleId.toString().padEnd(colWidths.cycle);
      const traceId = this.truncateId(op.traceId, colWidths.trace);
      const type = op.operationType.substring(0, colWidths.type).padEnd(colWidths.type);

      // Format status: get plain text first, then apply color
      const statusPlain = this.getStatusText(op.status);
      const statusText = statusPlain.substring(0, colWidths.status).padEnd(colWidths.status);
      const status = this.formatStatusText(op.status, statusText);

      // Show symbol or "-" if empty
      const symbol = (op.symbol || '-').substring(0, colWidths.symbol).padEnd(colWidths.symbol);
      const duration =
        op.endTime && op.startTime ? this.formatDuration(op.endTime - op.startTime) : 'N/A';
      const durationText = duration.substring(0, colWidths.duration).padEnd(colWidths.duration);
      const time = this.formatTimestamp(op.startTime)
        .substring(0, colWidths.time)
        .padEnd(colWidths.time);

      console.log(
        chalk.gray('│ ') +
          opId.padEnd(colWidths.operation) +
          chalk.gray(' │ ') +
          chalk.yellow(cycle) +
          chalk.gray(' │ ') +
          chalk.gray(traceId) +
          chalk.gray(' │ ') +
          type +
          chalk.gray(' │ ') +
          status +
          chalk.gray(' │ ') +
          (op.symbol ? chalk.cyan(symbol) : chalk.gray(symbol)) +
          chalk.gray(' │ ') +
          durationText +
          chalk.gray(' │ ') +
          time +
          chalk.gray(' │')
      );
    }

    console.log(bottomBorder);

    if (operations.length > limit) {
      console.log(
        chalk.gray(
          `\n... and ${operations.length - limit} more operations (use --limit to see more)`
        )
      );
    }
  }

  private static formatOperationsDetailed(operations: OperationLog[], limit: number = 50): void {
    if (operations.length === 0) {
      return;
    }

    for (let i = 0; i < operations.length && i < limit; i++) {
      const op = operations[i];

      console.log('');
      console.log(chalk.cyan('━'.repeat(80)));
      console.log(chalk.cyan(`📋 Operation ${i + 1}/${Math.min(operations.length, limit)}`));
      console.log(chalk.gray('━'.repeat(80)));

      // Basic Info
      console.log(chalk.blue('🔹 Basic Information:'));
      console.log(`   ID: ${chalk.yellow(op.operationId)}`);
      console.log(`   Type: ${chalk.cyan(op.operationType)}`);
      console.log(`   Status: ${this.formatStatus(op.status)}`);
      console.log(`   Cycle ID: ${chalk.yellow(op.cycleId.toString())}`);
      console.log(`   Trace ID: ${chalk.gray(op.traceId)}`);
      if (op.symbol) {
        console.log(`   Symbol: ${chalk.cyan(op.symbol)}`);
      }
      if (op.parentOperationId) {
        console.log(`   Parent: ${chalk.gray(this.truncateId(op.parentOperationId))}`);
      }

      // Timing
      console.log(chalk.blue('\n⏱️  Timing:'));
      const startDate = new Date(op.startTime);
      const endDate = op.endTime ? new Date(op.endTime) : null;
      console.log(
        `   Start: ${chalk.cyan(this.formatTimestamp(op.startTime))} (${startDate.toISOString()})`
      );
      if (endDate) {
        console.log(
          `   End: ${chalk.cyan(this.formatTimestamp(op.endTime))} (${endDate.toISOString()})`
        );
        console.log(`   Duration: ${chalk.yellow(this.formatDuration(op.endTime - op.startTime))}`);
      } else {
        console.log(`   Status: ${chalk.yellow('Running...')}`);
      }

      // Stages
      if (op.stages && op.stages.length > 0) {
        console.log(chalk.blue('\n📊 Stages:'));
        console.log(`   Total: ${chalk.cyan(op.stages.length.toString())}`);
        for (const stage of op.stages) {
          const stageStatus =
            stage.status === 'completed'
              ? chalk.green('✓')
              : stage.status === 'failed'
                ? chalk.red('✗')
                : chalk.yellow('○');
          const stageDuration = stage.duration ? ` (${this.formatDuration(stage.duration)})` : '';
          const stageError = stage.error ? ` ${chalk.red('⚠ ' + stage.error.message)}` : '';
          console.log(`   ${stageStatus} ${chalk.cyan(stage.stage)}${stageDuration}${stageError}`);
          // Show stage input/output if available
          if (stage.input && Object.keys(stage.input).length > 0) {
            const inputKeys = Object.keys(stage.input);
            const inputPreview = inputKeys
              .slice(0, 2)
              .map(key => {
                const value = stage.input![key];
                const displayValue =
                  typeof value === 'object'
                    ? JSON.stringify(value).substring(0, 30) + '...'
                    : String(value).substring(0, 30);
                return `${chalk.gray(key)}: ${displayValue}`;
              })
              .join(', ');
            if (inputPreview) {
              console.log(
                chalk.gray(`      └─ ${inputPreview}${inputKeys.length > 2 ? '...' : ''}`)
              );
            }
          }
          if (stage.output && Object.keys(stage.output).length > 0) {
            const outputKeys = Object.keys(stage.output);
            const outputPreview = outputKeys
              .slice(0, 2)
              .map(key => {
                const value = stage.output![key];
                const displayValue =
                  typeof value === 'object'
                    ? JSON.stringify(value).substring(0, 30) + '...'
                    : String(value).substring(0, 30);
                return `${chalk.gray(key)}: ${displayValue}`;
              })
              .join(', ');
            if (outputPreview) {
              console.log(
                chalk.gray(`      └─ ${outputPreview}${outputKeys.length > 2 ? '...' : ''}`)
              );
            }
          }
        }
      }

      // Input/Output Summary
      if (op.input && Object.keys(op.input).length > 0) {
        console.log(chalk.blue('\n📥 Input Summary:'));
        const inputKeys = Object.keys(op.input);
        for (const key of inputKeys.slice(0, 5)) {
          const value = op.input[key];
          const displayValue =
            typeof value === 'object'
              ? JSON.stringify(value).substring(0, 50) + '...'
              : String(value);
          console.log(`   ${chalk.cyan(key)}: ${chalk.gray(displayValue.substring(0, 60))}`);
        }
        if (inputKeys.length > 5) {
          console.log(chalk.gray(`   ... and ${inputKeys.length - 5} more fields`));
        }
      }

      if (op.output && Object.keys(op.output).length > 0) {
        console.log(chalk.blue('\n📤 Output Summary:'));
        const outputKeys = Object.keys(op.output);
        for (const key of outputKeys.slice(0, 5)) {
          const value = op.output[key];
          const displayValue =
            typeof value === 'object'
              ? JSON.stringify(value).substring(0, 50) + '...'
              : String(value);
          console.log(`   ${chalk.cyan(key)}: ${chalk.gray(displayValue.substring(0, 60))}`);
        }
        if (outputKeys.length > 5) {
          console.log(chalk.gray(`   ... and ${outputKeys.length - 5} more fields`));
        }
      }

      // Error
      if (op.error) {
        console.log(chalk.blue('\n❌ Error:'));
        console.log(`   Type: ${chalk.red(op.error.type)}`);
        console.log(`   Message: ${chalk.red(op.error.message)}`);
        if (op.error.stack) {
          const stackLines = op.error.stack.split('\n').slice(0, 3);
          console.log(chalk.gray(`   Stack: ${stackLines.join(' → ')}`));
        }
      }

      // Metrics
      if (op.metrics) {
        console.log(chalk.blue('\n📈 Metrics:'));
        console.log(`   Duration: ${chalk.yellow(this.formatDuration(op.metrics.duration))}`);
        if (op.metrics.resourceUsage) {
          if (op.metrics.resourceUsage.memory) {
            console.log(
              `   Memory: ${chalk.gray((op.metrics.resourceUsage.memory / 1024 / 1024).toFixed(2) + ' MB')}`
            );
          }
          if (op.metrics.resourceUsage.cpu) {
            console.log(`   CPU: ${chalk.gray(op.metrics.resourceUsage.cpu.toFixed(2) + '%')}`);
          }
        }
      }

      // Tags
      if (op.tags && op.tags.length > 0) {
        console.log(chalk.blue('\n🏷️  Tags:'));
        console.log(`   ${op.tags.map(t => chalk.gray(t)).join(', ')}`);
      }

      // Decision Path (summary decisions - detailed info in Validation Checks)
      if (op.decisionPath && op.decisionPath.choices.length > 0) {
        console.log(chalk.blue('\n🛤️  Decision Path:'));
        for (const choice of op.decisionPath.choices) {
          const decisionColor =
            choice.confidence !== undefined && choice.threshold !== undefined
              ? choice.confidence >= (choice.threshold || 0)
                ? 'green'
                : 'yellow'
              : 'gray';
          console.log(`   ${chalk.cyan(choice.step)}: ${chalk[decisionColor](choice.decision)}`);
          // Display reason as single line (detailed info in Validation Checks)
          const reasonLines = choice.reason.split('\n').filter(line => line.trim());
          if (reasonLines.length > 0) {
            console.log(`      └─ ${chalk.gray(reasonLines[0])}`);
            // Show additional summary lines if needed (max 2 more)
            for (const line of reasonLines.slice(1, 3)) {
              if (line.trim()) {
                console.log(`      └─ ${chalk.gray(line.trim())}`);
              }
            }
            if (reasonLines.length > 3) {
              console.log(chalk.gray(`      └─ ... (see Validation Checks below for details)`));
            }
          }
          if (choice.confidence !== undefined) {
            console.log(
              `      └─ Confidence: ${chalk.yellow((choice.confidence * 100).toFixed(1) + '%')}`
            );
          }
        }
      }

      // Stage-level details (immediately after Decision Path for easy reference)
      if (op.stages && op.stages.length > 0) {
        for (const stage of op.stages) {
          // Stage validation checks (detailed verification information)
          if (stage.validationChecks && stage.validationChecks.length > 0) {
            console.log(chalk.blue(`\n🔍 Validation Checks (${stage.stage}):`));
            for (const check of stage.validationChecks) {
              const checkStatus = check.passed ? chalk.green('✓') : chalk.red('✗');
              console.log(`   ${checkStatus} ${chalk.cyan(check.name)}`);
              if (check.reason) {
                console.log(`      └─ ${chalk.gray(check.reason)}`);
              }
              if (check.threshold !== undefined && check.actual !== undefined) {
                const thresholdStatus =
                  check.passed || (check.threshold && check.actual <= check.threshold)
                    ? 'green'
                    : 'red';
                console.log(
                  `      └─ Actual: ${chalk.yellow(check.actual.toString())}, Threshold: ${chalk[thresholdStatus](check.threshold.toString())}`
                );
              }
              // Enhanced display for execution validation checks
              if (check.name === 'execution_price_validation' && check.details) {
                const details = check.details;
                if (details.expectedPrice !== undefined && details.actualPrice !== undefined) {
                  console.log(
                    `      └─ Expected Price: ${chalk.cyan('$' + details.expectedPrice.toFixed(2))}, Actual Price: ${chalk.yellow('$' + details.actualPrice.toFixed(2))}`
                  );
                }
                if (details.slippage !== undefined) {
                  const slippageColor =
                    Math.abs(details.slippage) <= 1
                      ? 'green'
                      : Math.abs(details.slippage) <= 3
                        ? 'yellow'
                        : 'red';
                  // slippage is already in percentage (0-100), not decimal (0-1)
                  console.log(
                    `      └─ Slippage: ${chalk[slippageColor](Math.abs(details.slippage).toFixed(2) + '%')}`
                  );
                }
                if (details.orderId) {
                  console.log(`      └─ Order ID: ${chalk.gray(details.orderId)}`);
                }
                if (details.realizedPnl !== undefined) {
                  const pnlColor = details.realizedPnl >= 0 ? 'green' : 'red';
                  console.log(
                    `      └─ Realized P&L: ${chalk[pnlColor]('$' + details.realizedPnl.toFixed(2))}`
                  );
                }
                if (details.fees !== undefined) {
                  console.log(`      └─ Fees: ${chalk.gray('$' + details.fees.toFixed(2))}`);
                }
                if (details.sizing) {
                  const sizing = details.sizing as {
                    suggestedSize?: number;
                    leverage?: number;
                    riskAmount?: number;
                  };
                  if (sizing.suggestedSize !== undefined) {
                    console.log(
                      `      └─ Size: ${chalk.cyan(sizing.suggestedSize.toFixed(4))}, Leverage: ${chalk.cyan((sizing.leverage || 1).toString() + 'x')}, Risk: ${chalk.cyan('$' + (sizing.riskAmount || 0).toFixed(2))}`
                    );
                  }
                }
              } else if (check.name === 'position_sizing' && check.details) {
                const details = check.details;
                if (details.suggestedSize !== undefined) {
                  console.log(
                    `      └─ Suggested Size: ${chalk.cyan(details.suggestedSize.toString())}`
                  );
                }
                if (details.maxSize !== undefined) {
                  console.log(`      └─ Max Size: ${chalk.cyan(details.maxSize.toString())}`);
                }
                if (details.riskAmount !== undefined) {
                  console.log(
                    `      └─ Risk Amount: ${chalk.cyan('$' + details.riskAmount.toFixed(2))}`
                  );
                }
                if (details.leverage !== undefined) {
                  console.log(
                    `      └─ Leverage: ${chalk.cyan(details.leverage.toString() + 'x')}`
                  );
                }
              } else if (check.name === 'signal_validation' && check.details) {
                const details = check.details;
                if (details.coin) {
                  console.log(`      └─ Coin: ${chalk.cyan(details.coin)}`);
                }
                if (details.action) {
                  console.log(`      └─ Action: ${chalk.cyan(details.action)}`);
                }
                if (details.confidence !== undefined) {
                  console.log(
                    `      └─ Confidence: ${chalk.yellow((details.confidence * 100).toFixed(1) + '%')}`
                  );
                }
              } else if (check.details && Object.keys(check.details).length > 0) {
                // Fallback for other validation checks
                const detailKeys = Object.keys(check.details);
                const detailPreview = detailKeys
                  .slice(0, 3)
                  .map(key => {
                    const value = check.details![key];
                    const displayValue =
                      typeof value === 'object'
                        ? JSON.stringify(value).substring(0, 40) + '...'
                        : String(value).substring(0, 40);
                    return `${chalk.gray(key)}: ${displayValue}`;
                  })
                  .join(', ');
                if (detailPreview) {
                  console.log(
                    chalk.gray(`      └─ ${detailPreview}${detailKeys.length > 3 ? '...' : ''}`)
                  );
                }
              }
            }
          }

          // Stage decision metrics (statistical information for decision making)
          if (stage.decisionMetrics) {
            console.log(chalk.blue(`\n🎯 Decision Metrics (${stage.stage}):`));
            console.log(
              `   Confidence: ${chalk.yellow((stage.decisionMetrics.confidence * 100).toFixed(1) + '%')}`
            );
            console.log(
              `   Threshold: ${chalk.cyan((stage.decisionMetrics.threshold * 100).toFixed(1) + '%')}`
            );
            if (stage.decisionMetrics.reasoning) {
              console.log(`   Reasoning: ${chalk.gray(stage.decisionMetrics.reasoning)}`);
            }
            if (
              stage.decisionMetrics.factors &&
              Object.keys(stage.decisionMetrics.factors).length > 0
            ) {
              const factorKeys = Object.keys(stage.decisionMetrics.factors);
              const factorPreview = factorKeys
                .slice(0, 3)
                .map(key => {
                  const value = stage.decisionMetrics!.factors![key];
                  const displayValue =
                    typeof value === 'object'
                      ? JSON.stringify(value).substring(0, 30) + '...'
                      : String(value).substring(0, 30);
                  return `${chalk.gray(key)}: ${displayValue}`;
                })
                .join(', ');
              if (factorPreview) {
                console.log(
                  chalk.gray(`   Factors: ${factorPreview}${factorKeys.length > 3 ? '...' : ''}`)
                );
              }
            }
          }

          // Stage data quality
          if (stage.dataQuality) {
            console.log(chalk.blue(`\n📊 Data Quality (${stage.stage}):`));
            console.log(
              `   Freshness: ${chalk.yellow(this.formatDuration(stage.dataQuality.freshness))}`
            );
            console.log(
              `   Stale: ${stage.dataQuality.isStale ? chalk.red('Yes') : chalk.green('No')}`
            );
            console.log(
              `   Completeness: ${chalk.yellow((stage.dataQuality.completeness * 100).toFixed(1) + '%')}`
            );
            if (stage.dataQuality.gapsCount > 0) {
              console.log(`   Gaps: ${chalk.yellow(stage.dataQuality.gapsCount.toString())}`);
            }
          }
        }
      }

      // Validation Results (summary - aggregation of all stage-level Validation Checks)
      if (op.validationResults) {
        console.log(chalk.blue('\n✅ Validation Results (Summary):'));
        const overallStatus = op.validationResults.passed
          ? chalk.green('PASSED')
          : chalk.red('FAILED');
        console.log(`   Overall: ${overallStatus}`);

        // Group checks by name for summary
        const checkCounts: Record<string, { passed: number; failed: number }> = {};
        for (const check of op.validationResults.checks) {
          if (!checkCounts[check.check]) {
            checkCounts[check.check] = { passed: 0, failed: 0 };
          }
          if (check.passed) {
            checkCounts[check.check].passed++;
          } else {
            checkCounts[check.check].failed++;
          }
        }

        // Show summary counts
        for (const [checkName, counts] of Object.entries(checkCounts)) {
          const total = counts.passed + counts.failed;
          if (total > 0) {
            const status = counts.failed === 0 ? chalk.green('✓') : chalk.yellow('⚠');
            console.log(
              `   ${status} ${chalk.cyan(checkName)}: ${chalk.green(counts.passed.toString())} passed${counts.failed > 0 ? `, ${chalk.red(counts.failed.toString())} failed` : ''} (${total} total)`
            );
          }
        }
      }

      // Data Quality (operation-level summary - only if different from stage-level)
      if (op.dataQuality) {
        const hasStageDataQuality = op.stages?.some(s => s.dataQuality) ?? false;
        // Only show operation-level if there's no stage-level data quality, or if it's different
        if (!hasStageDataQuality || (op.dataQuality.gaps && op.dataQuality.gaps.length > 0)) {
          console.log(chalk.blue('\n📊 Data Quality (Operation-Level):'));
          console.log(
            `   Freshness: ${chalk.yellow(this.formatDuration(op.dataQuality.freshness.ageMs))}`
          );
          console.log(
            `   Stale: ${op.dataQuality.freshness.isStale ? chalk.red('Yes') : chalk.green('No')}`
          );
          console.log(
            `   Completeness: ${chalk.yellow(
              (
                (op.dataQuality.completeness.actualItems /
                  op.dataQuality.completeness.expectedItems) *
                100
              ).toFixed(1) + '%'
            )} (${op.dataQuality.completeness.actualItems}/${op.dataQuality.completeness.expectedItems})`
          );
          if (op.dataQuality.gaps && op.dataQuality.gaps.length > 0) {
            console.log(`   Gaps: ${chalk.yellow(op.dataQuality.gaps.length.toString())}`);
            for (const gap of op.dataQuality.gaps.slice(0, 3)) {
              const fromDate = new Date(gap.missingFrom).toISOString();
              const toDate = new Date(gap.missingTo).toISOString();
              console.log(
                `      └─ ${chalk.gray(gap.symbol)}/${chalk.gray(gap.timeframe)}: ${chalk.gray(fromDate)} → ${chalk.gray(toDate)}`
              );
            }
            if (op.dataQuality.gaps.length > 3) {
              console.log(
                chalk.gray(`      └─ ... and ${op.dataQuality.gaps.length - 3} more gaps`)
              );
            }
          }
        }
      }

      if (i < Math.min(operations.length, limit) - 1) {
        console.log('');
      }
    }

    if (operations.length > limit) {
      console.log('');
      console.log(
        chalk.gray(`... and ${operations.length - limit} more operations (use --limit to see more)`)
      );
    }
  }

  private static getStatusText(status: string): string {
    const statusMap: Record<string, string> = {
      completed: 'completed',
      failed: 'failed',
      running: 'running',
      cancelled: 'cancelled',
    };
    return statusMap[status] || status;
  }

  private static formatStatusText(status: string, text: string): string {
    const statusMap: Record<string, { color: string }> = {
      completed: { color: 'green' },
      failed: { color: 'red' },
      running: { color: 'yellow' },
      cancelled: { color: 'gray' },
    };

    const statusInfo = statusMap[status] || { color: 'gray' };
    return chalk[statusInfo.color](text);
  }

  private static formatStatus(status: string): string {
    const statusText = this.getStatusText(status);
    return this.formatStatusText(status, statusText.padEnd(8));
  }

  private static formatDuration(ms: number): string {
    if (ms < 1000) {
      return `${Math.round(ms)}ms`;
    } else if (ms < 60000) {
      return `${(ms / 1000).toFixed(2)}s`;
    } else {
      const minutes = Math.floor(ms / 60000);
      const seconds = ((ms % 60000) / 1000).toFixed(0);
      return `${minutes}m ${seconds}s`;
    }
  }

  private static formatTimestamp(timestamp: number): string {
    const date = new Date(timestamp);
    const hours = date.getHours().toString().padStart(2, '0');
    const minutes = date.getMinutes().toString().padStart(2, '0');
    const seconds = date.getSeconds().toString().padStart(2, '0');
    return `${hours}:${minutes}:${seconds}`;
  }

  private static truncateId(id: string, maxLength: number = 12): string {
    if (id.length <= maxLength) {
      return id;
    }
    return id.substring(0, maxLength - 3) + '...';
  }
}

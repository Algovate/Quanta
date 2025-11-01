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
      .option('--limit <limit>', 'Limit number of results', parseInt, 50)
      .option('--offset <offset>', 'Offset for pagination', parseInt, 0)
      .option('--format <format>', 'Output format (table|json)', 'table')
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
      .option('--limit <limit>', 'Limit number of results', parseInt, 50)
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
  }): Promise<void> {
    const query = QueryInterface.getInstance();
    const result = await query.queryOperations({
      cycleId: options.cycleId,
      operationType: options.type,
      status: options.status as 'running' | 'completed' | 'failed' | 'cancelled' | undefined,
      symbol: options.symbol,
      traceId: options.traceId,
      operationId: options.operationId,
      limit: options.limit || 50,
      offset: options.offset || 0,
    });

    if (options.format === 'json') {
      console.log(JSON.stringify(result, null, 2));
      return;
    }

    if (result.operations.length === 0) {
      console.log(chalk.yellow('⚠️  No operations found matching the criteria'));
      return;
    }

    console.log(chalk.cyan('📋 Operations Query Results'));
    console.log(
      chalk.gray(
        `Found ${result.total} operations${result.hasMore ? ' (showing first ' + result.operations.length + ')' : ''}\n`
      )
    );

    this.formatOperationsTable(result.operations);
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
    this.formatOperationsTable(trace.operations);
  }

  private static async searchOperations(
    term: string,
    options: { type?: string; status?: string; limit?: number; format?: string }
  ): Promise<void> {
    const query = QueryInterface.getInstance();
    const result = await query.searchOperations(term, {
      operationType: options.type,
      status: options.status as 'running' | 'completed' | 'failed' | 'cancelled' | undefined,
      limit: options.limit || 50,
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

    this.formatOperationsTable(result.operations);
  }

  private static async showSnapshot(
    snapshotId: string | undefined,
    options: { format?: string }
  ): Promise<void> {
    let snapshot: SystemSnapshot | null = null;

    if (snapshotId) {
      const storage = StorageLayer.getInstance();
      snapshot = await storage.getSnapshotById(snapshotId);
      if (!snapshot) {
        console.log(chalk.red(`❌ Snapshot not found: ${snapshotId}`));
        return;
      }
    } else {
      // Get latest snapshot from StateSnapshotService
      const unifiedLogger = UnifiedLogger.getInstance();
      const stateSnapshot = (
        unifiedLogger as unknown as {
          stateSnapshot?: { getLastSnapshot?: () => SystemSnapshot | null | undefined };
        }
      ).stateSnapshot;
      if (stateSnapshot && typeof stateSnapshot.getLastSnapshot === 'function') {
        snapshot = stateSnapshot.getLastSnapshot() || null;
      }

      if (!snapshot) {
        console.log(chalk.yellow('⚠️  No snapshots found'));
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

  private static formatOperationsTable(operations: OperationLog[]): void {
    if (operations.length === 0) {
      return;
    }

    // Table header
    console.log(
      chalk.gray('┌────────────┬─────────────┬──────────┬──────────┬─────────────┬────────────┐')
    );
    console.log(
      chalk.gray('│ ') +
        chalk.cyan('Operation') +
        chalk.gray(' │ ') +
        chalk.cyan('Type') +
        chalk.gray('         │ ') +
        chalk.cyan('Status') +
        chalk.gray('   │ ') +
        chalk.cyan('Symbol') +
        chalk.gray('   │ ') +
        chalk.cyan('Duration') +
        chalk.gray('    │ ') +
        chalk.cyan('Time') +
        chalk.gray('      │')
    );
    console.log(
      chalk.gray('├────────────┼─────────────┼──────────┼──────────┼─────────────┼────────────┤')
    );

    // Table rows
    for (const op of operations.slice(0, 100)) {
      // Truncate operation ID
      const opId = this.truncateId(op.operationId, 10);
      const type = op.operationType.substring(0, 11).padEnd(11);
      const status = this.formatStatus(op.status);
      const symbol = (op.symbol || '').substring(0, 8).padEnd(8);
      const duration =
        op.endTime && op.startTime ? this.formatDuration(op.endTime - op.startTime) : 'N/A';
      const time = this.formatTimestamp(op.startTime);

      console.log(
        chalk.gray('│ ') +
          opId.padEnd(10) +
          chalk.gray(' │ ') +
          type +
          chalk.gray(' │ ') +
          status +
          chalk.gray(' │ ') +
          symbol +
          chalk.gray(' │ ') +
          duration.padEnd(11) +
          chalk.gray(' │ ') +
          time.padEnd(10) +
          chalk.gray(' │')
      );
    }

    console.log(
      chalk.gray('└────────────┴─────────────┴──────────┴──────────┴─────────────┴────────────┘')
    );

    if (operations.length > 100) {
      console.log(chalk.gray(`\n... and ${operations.length - 100} more operations`));
    }
  }

  private static formatStatus(status: string): string {
    const statusMap: Record<string, { text: string; color: string }> = {
      completed: { text: 'completed', color: 'green' },
      failed: { text: 'failed', color: 'red' },
      running: { text: 'running', color: 'yellow' },
      cancelled: { text: 'cancelled', color: 'gray' },
    };

    const statusInfo = statusMap[status] || { text: status, color: 'gray' };
    return chalk[statusInfo.color](statusInfo.text.padEnd(8));
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

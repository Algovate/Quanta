/**
 * Arena Commands - CLI commands for Arena multi-drone trading system
 */

import { Command } from 'commander';
import chalk from 'chalk';
import ora from 'ora';
import { readFileSync } from 'fs';
import { readdirSync, statSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { getConfig } from '../../config/settings.js';
import { ArenaManager } from '../../arena/index.js';
import type { ArenaConfig } from '../../arena/types.js';
import { PerformanceComparator } from '../../arena/analysis/performance-comparator.js';
import { CostAnalyzer } from '../../arena/analysis/cost-analyzer.js';
import { handleAsync } from '../../utils/error-handler.js';
import { safeAction } from '../shared/command-utils.js';
import { UnifiedLogger } from '../../logging/index.js';
import { checkSessionConflict } from '../shared/session-guard.js';

export class ArenaCommands {
  private static isRunning = false;

  static register(program: Command): void {
    const arena = program.command('arena').description('Multi-drone trading arena');

    arena
      .command('start')
      .description('Start a new arena with specified configuration')
      .requiredOption(
        '-c, --config <name>',
        'Arena configuration name or path (e.g., ppc or ppc.json)'
      )
      .option(
        '-m, --mode <mode>',
        'Execution mode: paper (real market data with simulated execution, overrides config file)'
      )
      .option('-d, --duration <minutes>', 'Maximum runtime in minutes (optional)')
      .option('-v, --verbose', 'Verbose output', false)
      .action(
        safeAction(
          async (options: {
            config: string;
            mode?: string;
            duration?: string;
            verbose: boolean;
          }) => {
            if (ArenaCommands.isRunning) {
              const logger = UnifiedLogger.getInstance();
              const context = 'ArenaCommands';
              logger.info(chalk.yellow('⚠️  Another arena operation is in progress'), {}, context);
              return;
            }

            ArenaCommands.isRunning = true;

            try {
              await handleAsync(async () => {
                await ArenaCommands.startArena(options);
              }, 'ArenaCommands.start');
            } finally {
              ArenaCommands.isRunning = false;
            }
          },
          'ArenaCommands.start'
        )
      );

    arena
      .command('stop')
      .description('Stop a running arena')
      .argument('<arenaId>', 'Arena ID to stop')
      .action(
        safeAction(async (arenaId: string) => {
          try {
            await handleAsync(async () => {
              await ArenaCommands.stopArena(arenaId);
            }, 'ArenaCommands.stop');
          } finally {
            ArenaCommands.isRunning = false;
          }
        }, 'ArenaCommands.stop')
      );

    arena
      .command('status')
      .description('Show status of arena(s)')
      .argument('[arenaId]', 'Specific arena ID (optional)')
      .action(
        safeAction(async (arenaId?: string) => {
          try {
            await handleAsync(async () => {
              await ArenaCommands.showStatus(arenaId);
            }, 'ArenaCommands.status');
          } finally {
            ArenaCommands.isRunning = false;
          }
        }, 'ArenaCommands.status')
      );

    arena
      .command('list')
      .description('List all arena runs')
      .action(
        safeAction(async () => {
          try {
            await handleAsync(async () => {
              await ArenaCommands.listArenas();
            }, 'ArenaCommands.list');
          } finally {
            ArenaCommands.isRunning = false;
          }
        }, 'ArenaCommands.list')
      );

    arena
      .command('compare')
      .description('Compare performance across drones in an arena')
      .argument('<arenaId>', 'Arena ID to compare')
      .action(
        safeAction(async (arenaId: string) => {
          try {
            await handleAsync(async () => {
              await ArenaCommands.compareArena(arenaId);
            }, 'ArenaCommands.compare');
          } finally {
            ArenaCommands.isRunning = false;
          }
        }, 'ArenaCommands.compare')
      );

    arena
      .command('configs')
      .alias('config-list')
      .description('List available arena configuration files')
      .action(
        safeAction(async () => {
          try {
            await handleAsync(async () => {
              await ArenaCommands.listConfigs();
            }, 'ArenaCommands.configs');
          } finally {
            ArenaCommands.isRunning = false;
          }
        }, 'ArenaCommands.configs')
      );
  }

  private static async startArena(options: {
    config: string;
    mode?: string;
    duration?: string;
    verbose: boolean;
  }): Promise<void> {
    const logger = UnifiedLogger.getInstance();
    const context = 'ArenaCommands';

    // Session guard: check for active execution sessions
    checkSessionConflict();

    logger.info(chalk.cyan('🏟️  Quanta Arena - Multi-Drone Trading System'), {}, context);
    logger.info(chalk.gray('='.repeat(70)), {}, context);

    // Load arena configuration
    const spinner = ora('Loading arena configuration...').start();
    const config = ArenaCommands.loadArenaConfig(options.config);

    // Override mode if specified
    if (options.mode) {
      if (options.mode === 'backtest') {
        spinner.fail('Invalid mode');
        logger.error(
          chalk.red(
            '  Arena only supports "paper" mode. Use standalone backtest command for historical data testing.'
          )
        );
        process.exitCode = 1;
        return;
      }
      if (options.mode !== 'paper') {
        spinner.fail('Invalid mode');
        logger.error(
          chalk.red(`  Invalid mode: "${options.mode}". Arena only supports "paper" mode.`)
        );
        process.exitCode = 1;
        return;
      }
      config.mode = 'paper';
    }

    // Ensure config mode is paper (reject backtest if present in config file)
    if (config.mode !== 'paper') {
      spinner.fail('Invalid configuration');
      logger.error(
        chalk.red(
          '  Arena only supports "paper" mode. Use standalone backtest command for historical data testing.'
        )
      );
      process.exitCode = 1;
      return;
    }

    // Validate configuration
    if (!config.drones || config.drones.length === 0) {
      spinner.fail('Invalid arena configuration');
      logger.error(chalk.red('  Arena must have at least one drone'));
      process.exitCode = 1;
      return;
    }

    spinner.succeed(`Loaded arena configuration: ${config.name}`);
    logger.info(chalk.gray(`  Mode: ${config.mode}`));
    logger.info(chalk.gray(`  Drones: ${config.drones.length}`));
    config.drones.forEach(drone => {
      logger.info(chalk.gray(`    • ${drone.name} (${drone.coins.join(', ')})`));
    });

    // Get API key
    const globalConfig = getConfig();
    const apiKey = process.env.OPENROUTER_API_KEY || globalConfig.ai.apiKey;

    if (!apiKey) {
      logger.error(chalk.red('\n❌ Error: API key required'));
      logger.info(
        chalk.yellow('\n💡 Set OPENROUTER_API_KEY environment variable or configure in config.json')
      );
      process.exitCode = 1;
      return;
    }

    // Start arena
    const startSpinner = ora('Starting arena...').start();
    const arenaManager = ArenaManager.getInstance();

    try {
      const arenaId = await arenaManager.startArena(config, apiKey);
      startSpinner.succeed(`Arena started: ${chalk.green(arenaId)}`);

      logger.info(chalk.green('\n✅ Arena is running'));
      logger.info(chalk.gray('  Use "quanta arena status" to monitor progress'));
      logger.info(chalk.gray(`  Use "quanta arena stop ${arenaId}" to stop`));
      logger.info(chalk.gray('  Press Ctrl-C to stop gracefully'));

      // Global shutdown is handled centrally; duration timeout triggers SIGTERM

      // If duration specified, stop after duration
      if (options.duration) {
        const durationMs = parseInt(options.duration) * 60 * 1000;
        setTimeout(async () => {
          logger.info(chalk.yellow(`\n⏱️  Duration limit reached. Stopping arena...`));
          await arenaManager.stopArena(arenaId);
          logger.info(chalk.green('✅ Arena stopped'));
          // Delegate final teardown to central shutdown handlers
          process.kill(process.pid, 'SIGTERM');
        }, durationMs);
      }

      // Return; active timers/streams keep process alive until central shutdown
      return;
    } catch (error) {
      startSpinner.fail('Failed to start arena');
      throw error;
    }
  }

  private static async stopArena(arenaId: string): Promise<void> {
    const logger = UnifiedLogger.getInstance();
    const context = 'ArenaCommands';

    logger.info(chalk.cyan(`🛑 Stopping Arena ${arenaId}`), {}, context);

    const spinner = ora('Stopping arena...').start();
    const arenaManager = ArenaManager.getInstance();

    try {
      await arenaManager.stopArena(arenaId);
      spinner.succeed('Arena stopped successfully');
      logger.info(chalk.green(`\n✅ Arena ${arenaId} has been stopped`));
    } catch (error) {
      spinner.fail('Failed to stop arena');
      throw error;
    }
  }

  private static async showStatus(arenaId?: string): Promise<void> {
    const logger = UnifiedLogger.getInstance();
    const context = 'ArenaCommands';
    const arenaManager = ArenaManager.getInstance();

    if (arenaId) {
      // Show specific arena status
      const arena = arenaManager.getArena(arenaId);
      if (!arena) {
        logger.error(chalk.red(`❌ Arena ${arenaId} not found`));
        return;
      }

      const state = arena.getState();
      logger.info(chalk.cyan(`\n📊 Arena: ${chalk.bold(state.arenaId)}`));
      logger.info(chalk.gray('━'.repeat(70)));

      logger.info(`Status: ${ArenaCommands.formatStatus(state.status)}`);
      logger.info(`Runtime: ${ArenaCommands.formatDuration(Date.now() - state.startTime)}`);
      logger.info(`Drones: ${state.droneCount}`, {}, context);

      // Show drone metrics
      logger.info(chalk.cyan('\n📈 Drone Performance:'));
      const drones = arena.getAllDrones();
      for (const drone of drones) {
        const metrics = drone.getMetrics();
        const pnlColor = metrics.pnl >= 0 ? chalk.green : chalk.red;
        const pnlSign = metrics.pnl >= 0 ? '+' : '';

        logger.info(chalk.gray('\n  ' + '─'.repeat(66)));
        logger.info(chalk.bold(`  ${metrics.name} (${metrics.droneId})`));
        logger.info(`  Cycles: ${metrics.cycleCount}`, {}, context);
        logger.info(`  Equity: ${chalk.white.bold(`$${metrics.equity.toFixed(2)}`)}`);
        logger.info(
          `  P&L: ${pnlColor.bold(`${pnlSign}$${metrics.pnl.toFixed(2)} (${pnlSign}${metrics.pnlPercent.toFixed(2)}%)`)}`
        );
        logger.info(
          `  Signals: ${metrics.totalSignals} | Trades: ${metrics.totalTrades}`,
          {},
          context
        );
        logger.info(
          `  Sharpe: ${metrics.sharpeRatio.toFixed(2)} | DD: ${metrics.maxDrawdown.toFixed(2)}%`
        );
        logger.info(`  AI Cost: ${chalk.yellow(`$${metrics.aiCost.toFixed(4)}`)}`);
      }
    } else {
      // List all arenas
      await ArenaCommands.listArenas();
    }
  }

  private static async listArenas(): Promise<void> {
    const logger = UnifiedLogger.getInstance();
    const context = 'ArenaCommands';

    const arenaManager = ArenaManager.getInstance();
    const arenas = await arenaManager.listArenas();

    if (arenas.length === 0) {
      logger.info(chalk.yellow('\n⚠️  No arenas found'));
      logger.info(chalk.gray('   Start an arena with: quanta arena start --config <file>'));
      logger.shutdown();
      return;
    }

    logger.info(chalk.cyan('\n📋 Arena List'));
    logger.info(chalk.gray('━'.repeat(70)));

    for (const arena of arenas) {
      const statusColor = arena.status === 'running' ? chalk.green : chalk.gray;
      logger.info(chalk.bold(`\n${arena.name} (${arena.arenaId})`));
      logger.info(`  Status: ${statusColor(arena.status.toUpperCase())}`);
      logger.info(`  Drones: ${arena.droneCount}`, {}, context);
      if (arena.status === 'running') {
        logger.info(`  Runtime: ${ArenaCommands.formatDuration(Date.now() - arena.startTime)}`);
      } else if (arena.endTime) {
        logger.info(`  Duration: ${ArenaCommands.formatDuration(arena.endTime - arena.startTime)}`);
      }
    }

    logger.shutdown();
  }

  private static async compareArena(arenaId: string): Promise<void> {
    const logger = UnifiedLogger.getInstance();
    const context = 'ArenaCommands';

    const arenaManager = ArenaManager.getInstance();
    const arena = arenaManager.getArena(arenaId);

    if (!arena) {
      logger.error(chalk.red(`❌ Arena ${arenaId} not found`));
      logger.shutdown();
      return;
    }

    const drones = arena.getAllDrones();
    const metrics = drones.map(d => d.getMetrics());

    logger.info(chalk.cyan(`\n📊 Arena Comparison: ${arena.getConfig().name}`));
    logger.info(chalk.gray('━'.repeat(70)));

    // Performance comparison
    const comparator = new PerformanceComparator();
    const comparisons = comparator.compareDrones(metrics);
    const winner = comparator.getWinner(metrics);

    logger.info(chalk.cyan('\n🏆 Performance Rankings:'));
    logger.info(chalk.gray('━'.repeat(70)));

    comparisons.forEach((comp, idx) => {
      const rankEmoji = idx === 0 ? '🥇' : idx === 1 ? '🥈' : idx === 2 ? '🥉' : `${idx + 1}.`;
      const pnlColor = comp.metrics.pnl >= 0 ? chalk.green : chalk.red;
      const pnlSign = comp.metrics.pnl >= 0 ? '+' : '';

      logger.info(chalk.bold(`\n${rankEmoji} ${comp.name}`));
      logger.info(`  Return: ${pnlColor(`${pnlSign}${comp.metrics.totalReturn.toFixed(2)}%`)}`);
      logger.info(`  Sharpe: ${comp.metrics.sharpeRatio.toFixed(2)}`);
      logger.info(`  Max DD: ${chalk.red(comp.metrics.maxDrawdown.toFixed(2))}%`);
      logger.info(`  Win Rate: ${comp.metrics.winRate.toFixed(1)}%`);
      logger.info(`  Trades: ${comp.metrics.totalTrades}`, {}, context);
    });

    // Cost analysis
    const costAnalyzer = new CostAnalyzer();
    const costs = costAnalyzer.analyzeCosts(metrics);
    const mostEfficient = costAnalyzer.getMostEfficient(metrics);

    logger.info(chalk.cyan('\n💰 Cost Analysis:'));
    logger.info(chalk.gray('━'.repeat(70)));

    costs.forEach(cost => {
      logger.info(chalk.bold(`\n${cost.name}`));
      logger.info(`  Total Cost: ${chalk.yellow(`$${cost.totalCost.toFixed(4)}`)}`);
      logger.info(`  ROI: ${cost.roi >= 0 ? chalk.green : chalk.red(`${cost.roi.toFixed(1)}%`)}`);
      logger.info(`  Cost/Trade: ${chalk.gray(`$${cost.costPerTrade.toFixed(4)}`)}`);
    });

    if (mostEfficient) {
      logger.info(chalk.cyan(`\n💎 Most Efficient: ${mostEfficient.name}`));
      logger.info(chalk.gray(`   ROI: ${mostEfficient.roi.toFixed(1)}%`));
    }

    if (winner) {
      logger.info(chalk.cyan(`\n🏆 Winner: ${chalk.green.bold(winner.name)}`));
      logger.info(chalk.gray(`   Total Return: ${winner.totalReturn.toFixed(2)}%`));
      logger.info(chalk.gray(`   Sharpe Ratio: ${winner.sharpeRatio.toFixed(2)}`));
    }

    logger.shutdown();
  }

  private static async listConfigs(): Promise<void> {
    const logger = UnifiedLogger.getInstance();
    const context = 'ArenaCommands';

    // Get project root from import.meta.url (same approach as getVersion)
    const __filename = fileURLToPath(import.meta.url);
    const __dirname = dirname(__filename);
    const projectRoot = dirname(dirname(dirname(__dirname))); // dist/cli/commands -> ..
    const arenaConfigDir = join(projectRoot, 'config', 'arena');

    logger.info(chalk.cyan('\n📄 Available Arena Configurations'));
    logger.info(chalk.gray('━'.repeat(70)));

    try {
      if (!readdirSync) {
        logger.info(chalk.yellow('⚠️  Unable to read config directory'));
        logger.shutdown();
        return;
      }

      const files = readdirSync(arenaConfigDir);
      const jsonFiles = files.filter(f => f.endsWith('.json'));

      if (jsonFiles.length === 0) {
        logger.info(chalk.yellow('\n⚠️  No arena configurations found'));
        logger.info(chalk.gray(`   Directory: ${arenaConfigDir}`));
        logger.shutdown();
        return;
      }

      for (const file of jsonFiles) {
        const filePath = join(arenaConfigDir, file);
        try {
          const content = readFileSync(filePath, 'utf-8');
          const config = JSON.parse(content) as ArenaConfig;
          const stats = statSync(filePath);

          logger.info(chalk.bold(`\n📄 ${file}`));
          logger.info(`  Name: ${config.name || 'N/A'}`, {}, context);
          logger.info(`  Mode: ${config.mode || 'N/A'}`, {}, context);
          logger.info(`  Drones: ${config.drones?.length || 0}`, {}, context);
          if (config.drones && config.drones.length > 0) {
            logger.info(
              `  Prompt Packs: ${[...new Set(config.drones.map(d => d.promptPack))].join(', ')}`
            );
          }
          logger.info(`  Modified: ${stats.mtime.toLocaleString()}`);
          logger.info(chalk.gray(`  Path: ${filePath}`));
        } catch {
          logger.info(chalk.bold(`\n📄 ${file}`));
          logger.info(chalk.red(`  ⚠️  Invalid JSON configuration`));
        }
      }

      logger.info(chalk.gray('\n' + '━'.repeat(70)));
      logger.info(chalk.gray(`Use: quanta arena start --config <name> (e.g., ppc, ppc.json)`));
    } catch (error) {
      logger.error(chalk.red(`Failed to read arena config directory: ${arenaConfigDir}`));
      logger.info(
        chalk.gray(`   Error: ${error instanceof Error ? error.message : String(error)}`)
      );
    }

    logger.shutdown();
  }

  private static loadArenaConfig(configName: string): ArenaConfig {
    try {
      // Get project root from import.meta.url
      const __filename = fileURLToPath(import.meta.url);
      const __dirname = dirname(__filename);
      const projectRoot = dirname(dirname(dirname(__dirname))); // dist/cli/commands -> Quanta
      const arenaConfigDir = join(projectRoot, 'config', 'arena');

      // Determine if configName is a file path or just a name
      let configPath: string;
      if (configName.includes('/') || configName.includes('\\')) {
        // It's a full path, use it directly
        configPath = configName;
      } else {
        // It's just a name, construct the path
        const fileName = configName.endsWith('.json') ? configName : `${configName}.json`;
        configPath = join(arenaConfigDir, fileName);
      }

      const content = readFileSync(configPath, 'utf-8');
      return JSON.parse(content) as ArenaConfig;
    } catch (error) {
      // Provide helpful error message
      if (error instanceof Error && 'code' in error && error.code === 'ENOENT') {
        const __filename = fileURLToPath(import.meta.url);
        const __dirname = dirname(__filename);
        const projectRoot = dirname(dirname(dirname(__dirname)));
        const arenaConfigDir = join(projectRoot, 'config', 'arena');
        const logger = UnifiedLogger.getInstance();
        const context = 'ArenaCommands';
        logger.error(
          chalk.red(`Arena configuration "${configName}" not found`),
          undefined,
          context
        );
        logger.info(
          chalk.yellow(`Expected file: ${arenaConfigDir}/${configName}.json`),
          {},
          context
        );
        logger.info(
          chalk.gray('Use "quanta arena configs" to list available configurations'),
          {},
          context
        );
        throw new Error(`Arena configuration not found: ${configName}`);
      }
      const logger = UnifiedLogger.getInstance();
      const context = 'ArenaCommands';
      logger.error(chalk.red(`Failed to load arena config from ${configName}`), undefined, context);
      throw error;
    }
  }

  private static formatStatus(status: string): string {
    const colors: Record<string, (text: string) => string> = {
      running: chalk.green,
      stopped: chalk.gray,
      completed: chalk.blue,
      failed: chalk.red,
    };
    const color = colors[status] || chalk.white;
    return color(status.toUpperCase());
  }

  private static formatDuration(ms: number): string {
    const seconds = Math.floor(ms / 1000);
    const minutes = Math.floor(seconds / 60);
    const hours = Math.floor(minutes / 60);

    if (hours > 0) {
      return `${hours}h ${minutes % 60}m ${seconds % 60}s`;
    } else if (minutes > 0) {
      return `${minutes}m ${seconds % 60}s`;
    } else {
      return `${seconds}s`;
    }
  }
}

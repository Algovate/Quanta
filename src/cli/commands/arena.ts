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
        async (options: { config: string; mode?: string; duration?: string; verbose: boolean }) => {
          if (ArenaCommands.isRunning) {
            console.log(chalk.yellow('⚠️  Another arena operation is in progress'));
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
        }
      );

    arena
      .command('stop')
      .description('Stop a running arena')
      .argument('<arenaId>', 'Arena ID to stop')
      .action(async (arenaId: string) => {
        try {
          await handleAsync(async () => {
            await ArenaCommands.stopArena(arenaId);
          }, 'ArenaCommands.stop');
        } finally {
          ArenaCommands.isRunning = false;
        }
      });

    arena
      .command('status')
      .description('Show status of arena(s)')
      .argument('[arenaId]', 'Specific arena ID (optional)')
      .action(async (arenaId?: string) => {
        try {
          await handleAsync(async () => {
            await ArenaCommands.showStatus(arenaId);
          }, 'ArenaCommands.status');
        } finally {
          ArenaCommands.isRunning = false;
        }
      });

    arena
      .command('list')
      .description('List all arena runs')
      .action(async () => {
        try {
          await handleAsync(async () => {
            await ArenaCommands.listArenas();
          }, 'ArenaCommands.list');
        } finally {
          ArenaCommands.isRunning = false;
        }
      });

    arena
      .command('compare')
      .description('Compare performance across drones in an arena')
      .argument('<arenaId>', 'Arena ID to compare')
      .action(async (arenaId: string) => {
        try {
          await handleAsync(async () => {
            await ArenaCommands.compareArena(arenaId);
          }, 'ArenaCommands.compare');
        } finally {
          ArenaCommands.isRunning = false;
        }
      });

    arena
      .command('configs')
      .alias('config-list')
      .description('List available arena configuration files')
      .action(async () => {
        try {
          await handleAsync(async () => {
            await ArenaCommands.listConfigs();
          }, 'ArenaCommands.configs');
        } finally {
          ArenaCommands.isRunning = false;
        }
      });
  }

  private static async startArena(options: {
    config: string;
    mode?: string;
    duration?: string;
    verbose: boolean;
  }): Promise<void> {
    const logger = UnifiedLogger.getInstance();
    const originalConsole = logger.getOriginalConsole();

    // Session guard: check for active execution sessions
    await checkSessionConflict();

    originalConsole.log(chalk.cyan('🏟️  Quanta Arena - Multi-Drone Trading System'));
    originalConsole.log(chalk.gray('='.repeat(70)));

    // Load arena configuration
    const spinner = ora('Loading arena configuration...').start();
    const config = ArenaCommands.loadArenaConfig(options.config, originalConsole);

    // Override mode if specified
    if (options.mode) {
      if (options.mode === 'backtest') {
        spinner.fail('Invalid mode');
        console.error(
          chalk.red(
            '  Arena only supports "paper" mode. Use standalone backtest command for historical data testing.'
          )
        );
        process.exit(1);
      }
      if (options.mode !== 'paper') {
        spinner.fail('Invalid mode');
        console.error(
          chalk.red(`  Invalid mode: "${options.mode}". Arena only supports "paper" mode.`)
        );
        process.exit(1);
      }
      config.mode = 'paper';
    }

    // Ensure config mode is paper (reject backtest if present in config file)
    if (config.mode !== 'paper') {
      spinner.fail('Invalid configuration');
      console.error(
        chalk.red(
          '  Arena only supports "paper" mode. Use standalone backtest command for historical data testing.'
        )
      );
      process.exit(1);
    }

    // Validate configuration
    if (!config.drones || config.drones.length === 0) {
      spinner.fail('Invalid arena configuration');
      console.error(chalk.red('  Arena must have at least one drone'));
      process.exit(1);
    }

    spinner.succeed(`Loaded arena configuration: ${config.name}`);
    originalConsole.log(chalk.gray(`  Mode: ${config.mode}`));
    originalConsole.log(chalk.gray(`  Drones: ${config.drones.length}`));
    config.drones.forEach(drone => {
      originalConsole.log(chalk.gray(`    • ${drone.name} (${drone.coins.join(', ')})`));
    });

    // Get API key
    const globalConfig = getConfig();
    const apiKey = process.env.OPENROUTER_API_KEY || globalConfig.ai.apiKey;

    if (!apiKey) {
      originalConsole.error(chalk.red('\n❌ Error: API key required'));
      originalConsole.log(
        chalk.yellow('\n💡 Set OPENROUTER_API_KEY environment variable or configure in config.json')
      );
      process.exit(1);
    }

    // Start arena
    const startSpinner = ora('Starting arena...').start();
    const arenaManager = ArenaManager.getInstance();

    try {
      const arenaId = await arenaManager.startArena(config, apiKey);
      startSpinner.succeed(`Arena started: ${chalk.green(arenaId)}`);

      originalConsole.log(chalk.green('\n✅ Arena is running'));
      originalConsole.log(chalk.gray('  Use "quanta arena status" to monitor progress'));
      originalConsole.log(chalk.gray(`  Use "quanta arena stop ${arenaId}" to stop`));

      // If duration specified, stop after duration
      if (options.duration) {
        const durationMs = parseInt(options.duration) * 60 * 1000;
        setTimeout(async () => {
          originalConsole.log(chalk.yellow(`\n⏱️  Duration limit reached. Stopping arena...`));
          await arenaManager.stopArena(arenaId);
          originalConsole.log(chalk.green('✅ Arena stopped'));
        }, durationMs);
      }
    } catch (error) {
      startSpinner.fail('Failed to start arena');
      throw error;
    }
  }

  private static async stopArena(arenaId: string): Promise<void> {
    console.log(chalk.cyan(`🛑 Stopping Arena ${arenaId}`));

    const spinner = ora('Stopping arena...').start();
    const arenaManager = ArenaManager.getInstance();

    try {
      await arenaManager.stopArena(arenaId);
      spinner.succeed('Arena stopped successfully');
      console.log(chalk.green(`\n✅ Arena ${arenaId} has been stopped`));
    } catch (error) {
      spinner.fail('Failed to stop arena');
      throw error;
    }
  }

  private static async showStatus(arenaId?: string): Promise<void> {
    const arenaManager = ArenaManager.getInstance();

    if (arenaId) {
      // Show specific arena status
      const arena = arenaManager.getArena(arenaId);
      if (!arena) {
        console.error(chalk.red(`❌ Arena ${arenaId} not found`));
        return;
      }

      const state = arena.getState();
      console.log(chalk.cyan(`\n📊 Arena: ${chalk.bold(state.arenaId)}`));
      console.log(chalk.gray('━'.repeat(70)));

      console.log(`Status: ${ArenaCommands.formatStatus(state.status)}`);
      console.log(`Runtime: ${ArenaCommands.formatDuration(Date.now() - state.startTime)}`);
      console.log(`Drones: ${state.droneCount}`);

      // Show drone metrics
      console.log(chalk.cyan('\n📈 Drone Performance:'));
      const drones = arena.getAllDrones();
      for (const drone of drones) {
        const metrics = drone.getMetrics();
        const pnlColor = metrics.pnl >= 0 ? chalk.green : chalk.red;
        const pnlSign = metrics.pnl >= 0 ? '+' : '';

        console.log(chalk.gray('\n  ' + '─'.repeat(66)));
        console.log(chalk.bold(`  ${metrics.name} (${metrics.droneId})`));
        console.log(`  Cycles: ${metrics.cycleCount}`);
        console.log(`  Equity: ${chalk.white.bold(`$${metrics.equity.toFixed(2)}`)}`);
        console.log(
          `  P&L: ${pnlColor.bold(`${pnlSign}$${metrics.pnl.toFixed(2)} (${pnlSign}${metrics.pnlPercent.toFixed(2)}%)`)}`
        );
        console.log(`  Signals: ${metrics.totalSignals} | Trades: ${metrics.totalTrades}`);
        console.log(
          `  Sharpe: ${metrics.sharpeRatio.toFixed(2)} | DD: ${metrics.maxDrawdown.toFixed(2)}%`
        );
        console.log(`  AI Cost: ${chalk.yellow(`$${metrics.aiCost.toFixed(4)}`)}`);
      }
    } else {
      // List all arenas
      await ArenaCommands.listArenas();
    }
  }

  private static async listArenas(): Promise<void> {
    const logger = UnifiedLogger.getInstance();
    const originalConsole = logger.getOriginalConsole();

    const arenaManager = ArenaManager.getInstance();
    const arenas = await arenaManager.listArenas();

    if (arenas.length === 0) {
      originalConsole.log(chalk.yellow('\n⚠️  No arenas found'));
      originalConsole.log(chalk.gray('   Start an arena with: quanta arena start --config <file>'));
      logger.shutdown();
      return;
    }

    originalConsole.log(chalk.cyan('\n📋 Arena List'));
    originalConsole.log(chalk.gray('━'.repeat(70)));

    for (const arena of arenas) {
      const statusColor = arena.status === 'running' ? chalk.green : chalk.gray;
      originalConsole.log(chalk.bold(`\n${arena.name} (${arena.arenaId})`));
      originalConsole.log(`  Status: ${statusColor(arena.status.toUpperCase())}`);
      originalConsole.log(`  Drones: ${arena.droneCount}`);
      if (arena.status === 'running') {
        originalConsole.log(
          `  Runtime: ${ArenaCommands.formatDuration(Date.now() - arena.startTime)}`
        );
      } else if (arena.endTime) {
        originalConsole.log(
          `  Duration: ${ArenaCommands.formatDuration(arena.endTime - arena.startTime)}`
        );
      }
    }

    logger.shutdown();
  }

  private static async compareArena(arenaId: string): Promise<void> {
    const logger = UnifiedLogger.getInstance();
    const originalConsole = logger.getOriginalConsole();

    const arenaManager = ArenaManager.getInstance();
    const arena = arenaManager.getArena(arenaId);

    if (!arena) {
      originalConsole.error(chalk.red(`❌ Arena ${arenaId} not found`));
      logger.shutdown();
      return;
    }

    const drones = arena.getAllDrones();
    const metrics = drones.map(d => d.getMetrics());

    originalConsole.log(chalk.cyan(`\n📊 Arena Comparison: ${arena.getConfig().name}`));
    originalConsole.log(chalk.gray('━'.repeat(70)));

    // Performance comparison
    const comparator = new PerformanceComparator();
    const comparisons = comparator.compareDrones(metrics);
    const winner = comparator.getWinner(metrics);

    originalConsole.log(chalk.cyan('\n🏆 Performance Rankings:'));
    originalConsole.log(chalk.gray('━'.repeat(70)));

    comparisons.forEach((comp, idx) => {
      const rankEmoji = idx === 0 ? '🥇' : idx === 1 ? '🥈' : idx === 2 ? '🥉' : `${idx + 1}.`;
      const pnlColor = comp.metrics.pnl >= 0 ? chalk.green : chalk.red;
      const pnlSign = comp.metrics.pnl >= 0 ? '+' : '';

      originalConsole.log(chalk.bold(`\n${rankEmoji} ${comp.name}`));
      originalConsole.log(
        `  Return: ${pnlColor(`${pnlSign}${comp.metrics.totalReturn.toFixed(2)}%`)}`
      );
      originalConsole.log(`  Sharpe: ${comp.metrics.sharpeRatio.toFixed(2)}`);
      originalConsole.log(`  Max DD: ${chalk.red(comp.metrics.maxDrawdown.toFixed(2))}%`);
      originalConsole.log(`  Win Rate: ${comp.metrics.winRate.toFixed(1)}%`);
      originalConsole.log(`  Trades: ${comp.metrics.totalTrades}`);
    });

    // Cost analysis
    const costAnalyzer = new CostAnalyzer();
    const costs = costAnalyzer.analyzeCosts(metrics);
    const mostEfficient = costAnalyzer.getMostEfficient(metrics);

    originalConsole.log(chalk.cyan('\n💰 Cost Analysis:'));
    originalConsole.log(chalk.gray('━'.repeat(70)));

    costs.forEach(cost => {
      originalConsole.log(chalk.bold(`\n${cost.name}`));
      originalConsole.log(`  Total Cost: ${chalk.yellow(`$${cost.totalCost.toFixed(4)}`)}`);
      originalConsole.log(
        `  ROI: ${cost.roi >= 0 ? chalk.green : chalk.red(`${cost.roi.toFixed(1)}%`)}`
      );
      originalConsole.log(`  Cost/Trade: ${chalk.gray(`$${cost.costPerTrade.toFixed(4)}`)}`);
    });

    if (mostEfficient) {
      originalConsole.log(chalk.cyan(`\n💎 Most Efficient: ${mostEfficient.name}`));
      originalConsole.log(chalk.gray(`   ROI: ${mostEfficient.roi.toFixed(1)}%`));
    }

    if (winner) {
      originalConsole.log(chalk.cyan(`\n🏆 Winner: ${chalk.green.bold(winner.name)}`));
      originalConsole.log(chalk.gray(`   Total Return: ${winner.totalReturn.toFixed(2)}%`));
      originalConsole.log(chalk.gray(`   Sharpe Ratio: ${winner.sharpeRatio.toFixed(2)}`));
    }

    logger.shutdown();
  }

  private static async listConfigs(): Promise<void> {
    const logger = UnifiedLogger.getInstance();
    const originalConsole = logger.getOriginalConsole();

    // Get project root from import.meta.url (same approach as getVersion)
    const __filename = fileURLToPath(import.meta.url);
    const __dirname = dirname(__filename);
    const projectRoot = dirname(dirname(dirname(__dirname))); // dist/cli/commands -> ..
    const arenaConfigDir = join(projectRoot, 'config', 'arena');

    originalConsole.log(chalk.cyan('\n📄 Available Arena Configurations'));
    originalConsole.log(chalk.gray('━'.repeat(70)));

    try {
      if (!readdirSync) {
        originalConsole.log(chalk.yellow('⚠️  Unable to read config directory'));
        logger.shutdown();
        return;
      }

      const files = readdirSync(arenaConfigDir);
      const jsonFiles = files.filter(f => f.endsWith('.json'));

      if (jsonFiles.length === 0) {
        originalConsole.log(chalk.yellow('\n⚠️  No arena configurations found'));
        originalConsole.log(chalk.gray(`   Directory: ${arenaConfigDir}`));
        logger.shutdown();
        return;
      }

      for (const file of jsonFiles) {
        const filePath = join(arenaConfigDir, file);
        try {
          const content = readFileSync(filePath, 'utf-8');
          const config = JSON.parse(content) as ArenaConfig;
          const stats = statSync(filePath);

          originalConsole.log(chalk.bold(`\n📄 ${file}`));
          originalConsole.log(`  Name: ${config.name || 'N/A'}`);
          originalConsole.log(`  Mode: ${config.mode || 'N/A'}`);
          originalConsole.log(`  Drones: ${config.drones?.length || 0}`);
          if (config.drones && config.drones.length > 0) {
            originalConsole.log(
              `  Prompt Packs: ${[...new Set(config.drones.map(d => d.promptPack))].join(', ')}`
            );
          }
          originalConsole.log(`  Modified: ${stats.mtime.toLocaleString()}`);
          originalConsole.log(chalk.gray(`  Path: ${filePath}`));
        } catch {
          originalConsole.log(chalk.bold(`\n📄 ${file}`));
          originalConsole.log(chalk.red(`  ⚠️  Invalid JSON configuration`));
        }
      }

      originalConsole.log(chalk.gray('\n' + '━'.repeat(70)));
      originalConsole.log(
        chalk.gray(`Use: quanta arena start --config <name> (e.g., ppc, ppc.json)`)
      );
    } catch (error) {
      originalConsole.error(chalk.red(`Failed to read arena config directory: ${arenaConfigDir}`));
      originalConsole.log(
        chalk.gray(`   Error: ${error instanceof Error ? error.message : String(error)}`)
      );
    }

    logger.shutdown();
  }

  private static loadArenaConfig(
    configName: string,
    originalConsole?: {
      log: typeof console.log;
      warn: typeof console.warn;
      error: typeof console.error;
    }
  ): ArenaConfig {
    const console = originalConsole || global.console;
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
        console.error(chalk.red(`Arena configuration "${configName}" not found`));
        console.log(chalk.yellow(`Expected file: ${arenaConfigDir}/${configName}.json`));
        console.log(chalk.gray('Use "quanta arena configs" to list available configurations'));
        throw new Error(`Arena configuration not found: ${configName}`);
      }
      console.error(chalk.red(`Failed to load arena config from ${configName}`));
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

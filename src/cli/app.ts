import { Command } from 'commander';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import {
  TradeCommands,
  TestCommands,
  ConfigCommands,
  HelpCommand,
  SimulateCommands,
  LogCommands,
  PromptCommands,
  ArenaCommands,
} from './commands/index.js';
import { UnifiedLogger } from '../logging/index.js';
import { setupGracefulShutdown } from './shared/shutdown-handler.js';

// Get version from package.json
function getVersion(): string {
  try {
    const __filename = fileURLToPath(import.meta.url);
    const __dirname = dirname(__filename);
    const packagePath = join(__dirname, '../../package.json');
    const packageJson = JSON.parse(readFileSync(packagePath, 'utf-8'));
    return packageJson.version || '0.0.0';
  } catch {
    return '0.0.0';
  }
}

export class CLIApplication {
  private program: Command;

  constructor() {
    this.program = new Command();
    this.setupProgram();
    // Initialize logger and global shutdown coordination once
    const logger = UnifiedLogger.getInstance();
    logger.initialize();
    setupGracefulShutdown({ logger, loggerContext: 'CLIApplication' });
    this.registerCommands();
  }

  private setupProgram(): void {
    this.program
      .name('quanta')
      .description('Quanta CLI - AI-powered quantitative trading system')
      .version(getVersion());
  }

  private registerCommands(): void {
    // Trading commands
    const trading = this.program.command('trade').description('Trading operations');
    TradeCommands.register(trading);

    // Testing commands
    const testing = this.program.command('test').description('Testing and validation');
    TestCommands.register(testing);

    // Configuration commands
    const config = this.program.command('config').description('Configuration management');
    ConfigCommands.register(config);

    // Simulation commands
    const simulate = this.program.command('simulate').description('Simulation and demonstration');
    SimulateCommands.register(simulate);

    // Note: Server commands removed - API server will be in separate @quanta/server package

    // Log commands
    const log = this.program.command('log').description('Log query and analysis');
    LogCommands.register(log);

    // Prompt commands
    const prompts = this.program.command('prompts').description('Prompt group management');
    PromptCommands.register(prompts);

    // Arena commands
    ArenaCommands.register(this.program);

    // Help command
    HelpCommand.register(this.program);

    // Top-level status (aggregated)
    this.program
      .command('status')
      .description('Show aggregated system status (trade/arena)')
      .action(async () => {
        const logger = UnifiedLogger.getInstance();
        // Note: Server status check removed - server is now optional/separate
        // Recommend sub-status commands for details
        logger.info('ℹ️  For details: quanta log view --follow | quanta arena status', {}, 'CLI');
        logger.info(
          'ℹ️  For API server status: Use @quanta/server package if installed',
          {},
          'CLI'
        );
      });
  }

  public run(): void {
    this.program.parse();
  }
}

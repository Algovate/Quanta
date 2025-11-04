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
  ServerCommands,
  LogCommands,
  PromptCommands,
  ArenaCommands,
} from './commands/index.js';

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

    // Server commands
    ServerCommands.register(this.program);

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
  }

  public run(): void {
    this.program.parse();
  }
}

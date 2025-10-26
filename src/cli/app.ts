import { Command } from 'commander';
import { TradingCommands } from './commands/trading';
import { TestingCommands } from './commands/testing';
import { ConfigCommands } from './commands/config';
import { HelpCommand } from './commands/help';

export class CLIApplication {
  private program: Command;

  constructor() {
    this.program = new Command();
    this.setupProgram();
    this.registerCommands();
  }

  private setupProgram(): void {
    this.program
      .name('beta-arena')
      .description('BetaArena CLI - AI-powered quantitative trading system')
      .version('0.1.0');
  }

  private registerCommands(): void {
    // Trading commands
    const trading = this.program.command('trading').description('Trading operations');
    TradingCommands.register(trading);

    // Testing commands
    const testing = this.program.command('test').description('Testing and validation');
    TestingCommands.register(testing);

    // Configuration commands
    const config = this.program.command('config').description('Configuration management');
    ConfigCommands.register(config);

    // Help command
    HelpCommand.register(this.program);
  }

  public run(): void {
    this.program.parse();
  }
}

// Main entry point
if (require.main === module) {
  const app = new CLIApplication();
  app.run();
}

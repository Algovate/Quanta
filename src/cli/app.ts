import { Command } from 'commander';
import { TradeCommands } from './commands/trade';
import { TestCommands } from './commands/test';
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
    const trading = this.program.command('trade').description('Trading operations');
    TradeCommands.register(trading);

    // Testing commands
    const testing = this.program.command('test').description('Testing and validation');
    TestCommands.register(testing);

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

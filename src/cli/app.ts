import { Command } from 'commander';
import { TradeCommands } from './commands/trade.js';
import { TestCommands } from './commands/test.js';
import { ConfigCommands } from './commands/config.js';
import { HelpCommand } from './commands/help.js';
import { SimulateCommands } from './commands/simulate.js';
import { ServerCommands } from './commands/server.js';

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

    // Simulation commands
    const simulate = this.program.command('simulate').description('Simulation and demonstration');
    SimulateCommands.register(simulate);

    // Server commands
    ServerCommands.register(this.program);

    // Help command
    HelpCommand.register(this.program);
  }

  public run(): void {
    this.program.parse();
  }
}

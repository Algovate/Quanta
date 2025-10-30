import { Command } from 'commander';
import chalk from 'chalk';
import ora from 'ora';
import { APIServer } from '../../web/server.js';
import { handleAsync } from '../../utils/error-handler.js';

export class ServerCommands {
  static register(program: Command): void {
    const serverCommand = program.command('server').description('Web server for trading UI');

    serverCommand
      .command('start')
      .description('Start the API server for web UI')
      .option('-p, --port <port>', 'Port to listen on', '3001')
      .action(async options => {
        await handleAsync(async () => {
          await ServerCommands.start(options);
        }, 'ServerCommands.start');
      });

    serverCommand
      .command('stop')
      .description('Stop the running API server')
      .action(async () => {
        await handleAsync(async () => {
          ServerCommands.stop();
        }, 'ServerCommands.stop');
      });

    serverCommand
      .command('status')
      .description('Check API server status')
      .action(async () => {
        await handleAsync(async () => {
          await ServerCommands.showStatus();
        }, 'ServerCommands.status');
      });
  }

  private static async start(options: { port: string }): Promise<void> {
    const port = parseInt(options.port, 10);

    if (isNaN(port)) {
      throw new Error(`Invalid port: ${options.port}`);
    }

    console.log(chalk.cyan('🚀 Quanta API Server'));
    console.log(chalk.gray('Starting web interface server...\n'));

    const spinner = ora('Initializing server...').start();

    try {
      const server = new APIServer(port);

      spinner.succeed(`Server started successfully on port ${port}`);

      console.log(chalk.green('\n✅ Server is running!\n'));
      console.log(chalk.blue('📊 Server Information:'));
      console.log(`   API:      http://localhost:${port}`);
      console.log(`   Health:   http://localhost:${port}/health`);
      console.log(`   WebSocket: ws://localhost:${port}`);
      console.log('');
      console.log(chalk.yellow('💡 Next steps:'));
      console.log(chalk.gray('   1. Start the web UI: cd web && npm run dev'));
      console.log(chalk.gray('   2. Or access the API directly at http://localhost:' + port));
      console.log('');
      console.log(chalk.gray('Press Ctrl+C to stop the server\n'));

      // Keep the process alive
      process.on('SIGINT', () => {
        console.log(chalk.yellow('\n⏹  Shutting down server...'));
        server.stop();
        process.exit(0);
      });

      process.on('SIGTERM', () => {
        console.log(chalk.yellow('\n⏹  Shutting down server...'));
        server.stop();
        process.exit(0);
      });
    } catch {
      spinner.fail('Failed to start server');
      throw new Error('Failed to start server');
    }
  }

  private static stop(): void {
    console.log(chalk.cyan('🛑 Stopping API Server'));
    console.log(chalk.yellow('⚠️  Server stop not yet implemented'));
    console.log(chalk.gray('   Use Ctrl+C to stop the running server'));
  }

  private static async showStatus(): Promise<void> {
    console.log(chalk.cyan('📊 API Server Status'));

    try {
      const response = await fetch('http://localhost:3001/health');
      const data: any = await response.json();

      if (response.ok) {
        console.log(chalk.green('✅ Server is running'));
        console.log(chalk.gray(`   Uptime: ${Date.now() - data.timestamp}ms`));
        console.log(chalk.gray('   API: http://localhost:3001'));
      }
    } catch {
      console.log(chalk.red('❌ Server is not running'));
      console.log(chalk.yellow('   Start the server with: quanta server start'));
    }
  }
}

import { Command } from 'commander';
import chalk from 'chalk';
import ora from 'ora';
import { APIServer } from '../../web/server.js';
import { handleAsync } from '../../utils/error-handler.js';
import { UnifiedLogger } from '../../logging/index.js';

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

    // Initialize UnifiedLogger for detailed logging
    const unifiedLogger = UnifiedLogger.getInstance();
    unifiedLogger.initialize();

    // Get original console to bypass interception for minimal output
    const originalConsole = unifiedLogger.getOriginalConsole();

    // Console: Minimal essential info only (use originalConsole to avoid interception)
    originalConsole.log(chalk.cyan('🚀 Quanta API Server'));
    originalConsole.log(chalk.green(`✅ Running on http://localhost:${port}\n`));
    originalConsole.log(chalk.gray('Use "quanta log console" to view detailed output.\n'));

    // UnifiedLogger: Full detailed output
    unifiedLogger.info(chalk.cyan('🚀 Quanta API Server'), {}, 'Server');
    unifiedLogger.info(chalk.gray('Starting web interface server...\n'), {}, 'Server');

    const spinner = ora('Initializing server...').start();
    unifiedLogger.info('Initializing server...', {}, 'Server');

    try {
      const server = new APIServer(port);

      spinner.succeed(`Server started successfully on port ${port}`);
      unifiedLogger.info(`Server started successfully on port ${port}`, {}, 'Server');

      // UnifiedLogger: Log all server information
      unifiedLogger.info(chalk.green('\n✅ Server is running!\n'), {}, 'Server');
      unifiedLogger.info(chalk.blue('📊 Server Information:'), {}, 'Server');
      unifiedLogger.info(`   API:      http://localhost:${port}`, {}, 'Server');
      unifiedLogger.info(`   Health:   http://localhost:${port}/health`, {}, 'Server');
      unifiedLogger.info(`   WebSocket: ws://localhost:${port}`, {}, 'Server');
      unifiedLogger.info('', {}, 'Server');
      unifiedLogger.info(chalk.yellow('💡 Next steps:'), {}, 'Server');
      unifiedLogger.info(chalk.gray('   1. Start the web UI: cd web && npm run dev'), {}, 'Server');
      unifiedLogger.info(
        chalk.gray(`   2. Or access the API directly at http://localhost:${port}`),
        {},
        'Server'
      );
      unifiedLogger.info('', {}, 'Server');
      unifiedLogger.info(chalk.gray('Press Ctrl+C to stop the server\n'), {}, 'Server');

      // Keep the process alive
      process.on('SIGINT', () => {
        unifiedLogger.info(chalk.yellow('\n⏹  Shutting down server...'), {}, 'Server');
        originalConsole.log(chalk.yellow('\n⏹  Shutting down server...'));
        server.stop();
        process.exit(0);
      });

      process.on('SIGTERM', () => {
        unifiedLogger.info(chalk.yellow('\n⏹  Shutting down server...'), {}, 'Server');
        console.log(chalk.yellow('\n⏹  Shutting down server...'));
        server.stop();
        process.exit(0);
      });
    } catch (error) {
      spinner.fail('Failed to start server');
      if (error instanceof Error) {
        unifiedLogger.error('Failed to start server', error, 'Server');
      }
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

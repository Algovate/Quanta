/**
 * Shutdown Handler - Graceful shutdown utilities for CLI commands
 */

import chalk from 'chalk';
import type { UnifiedLogger } from '../../logging/index.js';
import type { ExecutionSession } from '../../core/types/execution-session.js';
import { ExecutionSessionManager } from '../../core/execution-session-manager.js';

export interface ShutdownContext {
  logger: UnifiedLogger;
  loggerContext: string;
  session?: {
    session: ExecutionSession;
    acquired: boolean;
  };
  onShutdown?: () => Promise<void> | void;
  onError?: (error: Error) => Promise<void> | void;
}

/**
 * Setup graceful shutdown handlers
 */
export function setupGracefulShutdown(context: ShutdownContext): void {
  const { logger, loggerContext, session, onShutdown, onError } = context;
  const originalConsole = logger.getOriginalConsole();

  let isShuttingDown = false;

  const shutdownHandler = async (signal: string) => {
    if (isShuttingDown) {
      // Force exit if already shutting down
      process.exit(1);
      return;
    }
    isShuttingDown = true;

    originalConsole.log(chalk.yellow(`\n⏹  Shutting down (${signal})...`));
    logger.info(chalk.yellow(`Shutting down (${signal})...`), { signal }, loggerContext);

    try {
      // Execute custom shutdown logic
      if (onShutdown) {
        await onShutdown();
      }

      // Release execution session if acquired
      if (session?.acquired && session.session) {
        const sessionManager = ExecutionSessionManager.getInstance();
        sessionManager.release(session.session.id);
        const duration = Date.now() - session.session.startTime;
        originalConsole.log(
          chalk.gray(
            `   Session: ${session.session.mode} (${session.session.env}) - Runtime: ${Math.floor(duration / 1000)}s`
          )
        );
        logger.info(
          'Execution session released',
          {
            id: session.session.id,
            mode: session.session.mode,
            env: session.session.env,
            duration,
            durationFormatted: `${Math.floor(duration / 1000)}s`,
          },
          loggerContext
        );
      }

      logger.shutdown();
      originalConsole.log(chalk.green('✅ Stopped gracefully'));
      process.exit(0);
    } catch (error) {
      // Still release session even on error
      if (session?.acquired && session.session) {
        try {
          ExecutionSessionManager.getInstance().release(session.session.id);
        } catch {
          // Ignore release errors
        }
      }

      originalConsole.error(chalk.red('❌ Error during shutdown'));
      if (error instanceof Error) {
        logger.error('Error during shutdown', error, loggerContext);
      }

      // Execute custom error handler if provided
      if (onError && error instanceof Error) {
        try {
          await onError(error);
        } catch {
          // Ignore error handler errors
        }
      }

      logger.shutdown();
      process.exit(1);
    }
  };

  process.on('SIGINT', () => {
    shutdownHandler('SIGINT').catch(error => {
      originalConsole.error(chalk.red('❌ Fatal error during shutdown'));
      if (error instanceof Error) {
        logger.error('Fatal error during shutdown', error, loggerContext);
      }
      logger.shutdown();
      process.exit(1);
    });
  });

  process.on('SIGTERM', () => {
    shutdownHandler('SIGTERM').catch(error => {
      originalConsole.error(chalk.red('❌ Fatal error during shutdown'));
      if (error instanceof Error) {
        logger.error('Fatal error during shutdown', error, loggerContext);
      }
      logger.shutdown();
      process.exit(1);
    });
  });
}


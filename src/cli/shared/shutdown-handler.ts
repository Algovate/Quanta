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

// Global registry of on-shutdown callbacks
const registeredShutdownTasks: Array<() => Promise<void> | void> = [];

/**
 * Register a task to be executed during graceful shutdown
 */
export function registerShutdownTask(task: () => Promise<void> | void): void {
  registeredShutdownTasks.push(task);
}

/**
 * Setup graceful shutdown handlers
 */
export function setupGracefulShutdown(context: ShutdownContext): void {
  const { logger, loggerContext, session, onShutdown, onError } = context;

  let isShuttingDown = false;

  const shutdownHandler = async (signal: string, err?: unknown) => {
    if (isShuttingDown) {
      // Force exit if already shutting down
      process.exit(1);
      return;
    }
    isShuttingDown = true;

    logger.info(chalk.yellow(`\n⏹  Shutting down (${signal})...`), { signal }, loggerContext);

    try {
      // Report error if provided
      if (err instanceof Error) {
        logger.error('Shutdown reason error', err, loggerContext);
        if (onError) {
          await Promise.resolve(onError(err));
        }
      }

      // Execute custom shutdown logic
      if (onShutdown) {
        await onShutdown();
      }

      // Execute globally registered shutdown tasks
      for (const task of registeredShutdownTasks) {
        try {
          await Promise.resolve(task());
        } catch {
          // Ignore individual task failures
        }
      }

      // Release execution session if acquired
      if (session?.acquired && session.session) {
        const sessionManager = ExecutionSessionManager.getInstance();
        sessionManager.release(session.session.id);
        const duration = Date.now() - session.session.startTime;
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

      // Flush/close logger streams
      if (typeof (logger as unknown as { flush?: () => Promise<void> }).flush === 'function') {
        await (logger as unknown as { flush: () => Promise<void> }).flush();
      } else {
        logger.shutdown();
      }
      logger.info('✅ Stopped gracefully', {}, loggerContext);
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

      logger.error('❌ Error during shutdown', undefined, loggerContext);
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

      if (typeof (logger as unknown as { flush?: () => Promise<void> }).flush === 'function') {
        await (logger as unknown as { flush: () => Promise<void> }).flush();
      } else {
        logger.shutdown();
      }
      process.exit(1);
    }
  };

  process.on('SIGINT', () => {
    shutdownHandler('SIGINT').catch(error => {
      logger.error('❌ Fatal error during shutdown', undefined, loggerContext);
      if (error instanceof Error) {
        logger.error('Fatal error during shutdown', error, loggerContext);
      }
      if (typeof (logger as unknown as { flush?: () => Promise<void> }).flush === 'function') {
        void (logger as unknown as { flush: () => Promise<void> }).flush();
      } else {
        logger.shutdown();
      }
      process.exit(1);
    });
  });

  process.on('SIGTERM', () => {
    shutdownHandler('SIGTERM').catch(error => {
      logger.error('❌ Fatal error during shutdown', undefined, loggerContext);
      if (error instanceof Error) {
        logger.error('Fatal error during shutdown', error, loggerContext);
      }
      if (typeof (logger as unknown as { flush?: () => Promise<void> }).flush === 'function') {
        void (logger as unknown as { flush: () => Promise<void> }).flush();
      } else {
        logger.shutdown();
      }
      process.exit(1);
    });
  });

  // Global error handlers
  process.on('unhandledRejection', reason => {
    void shutdownHandler('unhandledRejection', reason).catch(error => {
      logger.error('❌ Fatal error during shutdown (unhandledRejection)', undefined, loggerContext);
      if (error instanceof Error) {
        logger.error('Fatal error during shutdown (unhandledRejection)', error, loggerContext);
      }
      if (typeof (logger as unknown as { flush?: () => Promise<void> }).flush === 'function') {
        void (logger as unknown as { flush: () => Promise<void> }).flush();
      } else {
        logger.shutdown();
      }
      process.exit(1);
    });
  });

  process.on('uncaughtException', error => {
    void shutdownHandler('uncaughtException', error).catch(err => {
      logger.error('❌ Fatal error during shutdown (uncaughtException)', undefined, loggerContext);
      if (err instanceof Error) {
        logger.error('Fatal error during shutdown (uncaughtException)', err, loggerContext);
      }
      if (typeof (logger as unknown as { flush?: () => Promise<void> }).flush === 'function') {
        void (logger as unknown as { flush: () => Promise<void> }).flush();
      } else {
        logger.shutdown();
      }
      process.exit(1);
    });
  });
}

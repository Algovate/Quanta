/**
 * Session Manager - Execution session management utilities for CLI commands
 */

import chalk from 'chalk';
import { ExecutionSessionManager } from '../../core/execution-session-manager.js';
import { UnifiedLogger } from '../../logging/index.js';
import type { ExecutionSession } from '../../core/types/execution-session.js';

export interface SessionAcquisitionResult {
  session: ExecutionSession;
  acquired: boolean;
}

/**
 * Acquire an execution session for workflow execution
 */
export function acquireWorkflowSession(
  env: 'simulation' | 'paper' | 'live',
  logger: UnifiedLogger,
  loggerContext: string
): SessionAcquisitionResult {
  const sessionManager = ExecutionSessionManager.getInstance();
  const originalConsole = logger.getOriginalConsole();
  let sessionAcquired = false;
  let executionSession: ExecutionSession | undefined;

  try {
    executionSession = sessionManager.createWorkflowSession(env);
    sessionManager.acquire(executionSession);
    sessionAcquired = true;

    // Log session info (debug to avoid duplicate visible lines; console line below is user-facing)
    logger.debug(
      'Execution session acquired',
      {
        mode: executionSession.mode,
        env: executionSession.env,
        id: executionSession.id,
        startTime: executionSession.startTime,
      },
      loggerContext
    );

    // Show session info to user (include session id)
    originalConsole.log(
      chalk.blue(
        `📋 Execution Session: ${executionSession.mode} (${executionSession.env}) — ID: ${executionSession.id}`
      )
    );

    return { session: executionSession, acquired: sessionAcquired };
  } catch (error) {
    if (error instanceof Error && error.message.includes('Another execution session')) {
      originalConsole.error(chalk.red(`❌ ${error.message}`));
      throw error;
    }
    // Log warning but continue if session creation fails
    logger.warn(
      'Failed to create execution session',
      error instanceof Error ? error : new Error(String(error)),
      loggerContext
    );
    // Return a dummy session if creation failed (non-critical)
    return {
      session: {
        id: 'unknown',
        running: false,
        mode: 'strategy',
        env: env as 'simulation' | 'paper' | 'live',
        startTime: Date.now(),
      },
      acquired: false,
    };
  }
}

/**
 * Release an execution session
 */
export function releaseSession(
  session: ExecutionSession,
  logger: UnifiedLogger,
  loggerContext: string
): void {
  const sessionManager = ExecutionSessionManager.getInstance();
  const originalConsole = logger.getOriginalConsole();

  try {
    sessionManager.release(session.id);
    const duration = Date.now() - session.startTime;
    originalConsole.log(
      chalk.gray(
        `   Session: ${session.mode} (${session.env}) - Runtime: ${Math.floor(duration / 1000)}s`
      )
    );
    logger.info(
      'Execution session released',
      {
        id: session.id,
        mode: session.mode,
        env: session.env,
        duration,
        durationFormatted: `${Math.floor(duration / 1000)}s`,
      },
      loggerContext
    );
  } catch (error) {
    // Log but don't throw - session release failure is non-critical
    logger.warn(
      'Failed to release execution session',
      error instanceof Error ? error : new Error(String(error)),
      loggerContext
    );
  }
}

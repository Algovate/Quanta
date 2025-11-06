/**
 * Session Manager - Execution session management utilities for CLI commands
 */

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
  let sessionAcquired = false;
  let executionSession: ExecutionSession | undefined;

  try {
    executionSession = sessionManager.createWorkflowSession(env);
    sessionManager.acquire(executionSession);
    sessionAcquired = true;

    // Log session info
    logger.info(
      `📋 Execution Session: ${executionSession.mode} (${executionSession.env}) — ID: ${executionSession.id}`,
      {
        mode: executionSession.mode,
        env: executionSession.env,
        id: executionSession.id,
        startTime: executionSession.startTime,
      },
      loggerContext
    );

    return { session: executionSession, acquired: sessionAcquired };
  } catch (error) {
    if (error instanceof Error && error.message.includes('Another execution session')) {
      logger.error(`❌ ${error.message}`, error, loggerContext);
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

  try {
    sessionManager.release(session.id);
    const duration = Date.now() - session.startTime;
    logger.info(
      `   Session: ${session.mode} (${session.env}) - Runtime: ${Math.floor(duration / 1000)}s`,
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

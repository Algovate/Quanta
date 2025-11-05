/**
 * Session Guard - Prevents concurrent execution sessions
 */

import chalk from 'chalk';
import { ExecutionSessionManager } from '../../core/execution-session-manager.js';

/**
 * Check if another execution session is active
 * @throws {Error} If another session is active
 */
export function checkSessionConflict(): void {
  const sessionManager = ExecutionSessionManager.getInstance();
  const activeSession = sessionManager.getActive();

  if (activeSession) {
    const mode = activeSession.mode ?? 'unknown';
    const id = activeSession.id ?? 'n/a';
    throw new Error(
      chalk.red(
        `Another execution session is active (mode: ${mode}, id: ${id}). Stop it before starting a new one.`
      )
    );
  }
}

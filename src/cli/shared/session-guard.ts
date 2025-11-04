/**
 * Session Guard - Prevents concurrent execution sessions
 */

import chalk from 'chalk';

export interface SessionInfo {
  active: boolean;
  session?: {
    mode?: string;
    id?: string;
  } | null;
}

/**
 * Check if another execution session is active
 * @throws {Error} If another session is active
 */
export async function checkSessionConflict(): Promise<void> {
  try {
    const resp = await fetch('http://localhost:3001/api/system/session');
    if (resp.ok) {
      const data = (await resp.json()) as SessionInfo;
      if (data.active && data.session) {
        const mode = data.session.mode ?? 'unknown';
        const id = data.session.id ?? 'n/a';
        throw new Error(
          chalk.red(
            `Another execution session is active (mode: ${mode}, id: ${id}). Stop it before starting a new one.`
          )
        );
      }
    }
  } catch (error) {
    // Re-throw if it's our session conflict error
    if (error instanceof Error && error.message.includes('Another execution session')) {
      throw error;
    }
    // Server not running or endpoint unavailable - best-effort guard only
    // Silently continue if server is not available
  }
}

import type { ExecutionSession, ExecutionEnv } from './types/execution-session.js';
import { createExecutionSession, getExecutionEnv } from './utils/execution-session-utils.js';
import { getConfig } from '../config/settings.js';

export class ExecutionSessionManager {
  private static instance: ExecutionSessionManager;
  private active: ExecutionSession | null = null;

  private constructor() {}

  static getInstance(): ExecutionSessionManager {
    if (!ExecutionSessionManager.instance) {
      ExecutionSessionManager.instance = new ExecutionSessionManager();
    }
    return ExecutionSessionManager.instance;
  }

  getActive(): ExecutionSession | null {
    return this.active;
  }

  /**
   * Create and acquire an arena execution session
   */
  createArenaSession(arenaId: string, env?: ExecutionEnv): ExecutionSession {
    const config = getConfig();
    const sessionEnv = env ?? getExecutionEnv(config);
    return createExecutionSession(arenaId, 'arena', sessionEnv, true);
  }

  /**
   * Create and acquire a workflow (strategy) execution session
   */
  createWorkflowSession(env?: ExecutionEnv): ExecutionSession {
    const config = getConfig();
    const sessionEnv = env ?? getExecutionEnv(config);
    return createExecutionSession('workflow', 'strategy', sessionEnv, true);
  }

  acquire(session: ExecutionSession): void {
    if (this.active) {
      const current = this.active;
      throw new Error(
        `Another execution session is active (mode: ${current.mode}, id: ${current.id}). Stop it before starting a new one.`
      );
    }
    this.active = { ...session, running: true };
  }

  release(id?: string): void {
    if (!this.active) return;
    if (!id || this.active.id === id) {
      this.active = null;
    }
  }

  updateRunning(id: string, running: boolean): void {
    if (this.active && this.active.id === id) {
      this.active.running = running;
    }
  }
}

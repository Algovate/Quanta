import type { ExecutionSession, ExecutionEnv } from './types/execution-session.js';
import { createExecutionSession, getExecutionEnv } from './utils/execution-session-utils.js';
import { getConfig } from '../config/settings.js';
import { UnifiedLogger } from '../logging/index.js';

export class ExecutionSessionManager {
  private static instance: ExecutionSessionManager;
  private active: ExecutionSession | null = null;
  private logger = UnifiedLogger.getInstance();
  private readonly context = 'ExecutionSessionManager';

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
    return createExecutionSession('workflow', 'single', sessionEnv, true);
  }

  acquire(session: ExecutionSession): void {
    if (this.active) {
      const current = this.active;
      this.logger.warn(
        'Execution session conflict detected',
        {
          currentMode: current.mode,
          currentId: current.id,
          currentEnv: current.env,
          attemptedMode: session.mode,
          attemptedId: session.id,
          attemptedEnv: session.env,
        },
        this.context
      );
      throw new Error(
        `Another execution session is active (mode: ${current.mode}, id: ${current.id}). Stop it before starting a new one.`
      );
    }
    this.active = { ...session, running: true };
    // Log at debug level here to avoid duplicate "acquired" lines; CLI prints a user-facing line
    this.logger.debug(
      'Execution session acquired',
      {
        mode: session.mode,
        env: session.env,
        id: session.id,
        startTime: session.startTime,
      },
      this.context
    );
  }

  release(id?: string): void {
    if (!this.active) return;
    if (!id || this.active.id === id) {
      const released = this.active;
      const duration = Date.now() - released.startTime;
      this.logger.info(
        'Execution session released',
        {
          id: released.id,
          mode: released.mode,
          env: released.env,
          duration,
          durationFormatted: `${Math.floor(duration / 1000)}s`,
        },
        this.context
      );
      this.active = null;
    }
  }

  updateRunning(id: string, running: boolean): void {
    if (this.active && this.active.id === id) {
      this.active.running = running;
    }
  }
}

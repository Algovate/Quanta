/**
 * Arena Manager - Singleton managing all arena instances
 *
 * Manages multiple arena orchestrators, providing a single entry point
 * for arena operations from CLI or API.
 */

import type { ArenaConfig } from './types.js';
import { ArenaOrchestrator } from './arena-orchestrator.js';
import { ArenaStorage } from './arena-storage.js';
import { UnifiedLogger } from '../logging/index.js';
import { ExecutionSessionManager } from '../web/execution-session-manager.js';

export class ArenaManager {
  private static instance: ArenaManager;
  private arenas: Map<string, ArenaOrchestrator> = new Map();
  private storage: ArenaStorage;
  private logger = UnifiedLogger.getInstance();
  private readonly context = 'ArenaManager';

  private constructor() {
    this.storage = new ArenaStorage();
    this.logger.info('ArenaManager initialized', {}, this.context);
  }

  static getInstance(): ArenaManager {
    if (!ArenaManager.instance) {
      ArenaManager.instance = new ArenaManager();
    }
    return ArenaManager.instance;
  }

  /**
   * Start a new arena with the given configuration
   */
  async startArena(config: ArenaConfig, apiKey: string): Promise<string> {
    // Generate arena ID if not provided
    const arenaId = config.arenaId || `arena-${Date.now()}-${this.randomId()}`;

    // Update config with generated ID
    const finalConfig = { ...config, arenaId };

    this.logger.info(
      `Starting arena ${arenaId}`,
      {
        arenaId,
        name: config.name,
        droneCount: config.drones.length,
      },
      this.context
    );

    const sessionManager = ExecutionSessionManager.getInstance();
    let sessionAcquired = false;

    try {
      // Acquire exclusive execution session (mode: 'arena')
      const session = sessionManager.createArenaSession(arenaId);
      sessionManager.acquire(session);
      sessionAcquired = true;

      const orchestrator = new ArenaOrchestrator(arenaId, finalConfig, apiKey);
      this.arenas.set(arenaId, orchestrator);

      await orchestrator.start();

      this.logger.info(
        `Arena ${arenaId} started successfully`,
        {
          arenaId,
        },
        this.context
      );

      return arenaId;
    } catch (error) {
      // Clean up on failure
      this.arenas.delete(arenaId);

      // Release session if we acquired it
      if (sessionAcquired) {
        try {
          sessionManager.release(arenaId);
        } catch (releaseError) {
          this.logger.warn(
            `Failed to release session for arena ${arenaId}`,
            releaseError instanceof Error ? releaseError : new Error(String(releaseError)),
            this.context
          );
        }
      }

      this.logger.error(
        `Failed to start arena ${arenaId}`,
        error instanceof Error ? error : new Error(String(error)),
        this.context
      );
      throw error;
    }
  }

  /**
   * Stop an arena by ID
   */
  async stopArena(arenaId: string): Promise<void> {
    const arena = this.arenas.get(arenaId);
    if (!arena) {
      throw new Error(`Arena ${arenaId} not found`);
    }

    this.logger.info(`Stopping arena ${arenaId}`, {}, this.context);

    try {
      await arena.stop();
      this.arenas.delete(arenaId);
      // Release exclusive session
      ExecutionSessionManager.getInstance().release(arenaId);

      this.logger.info(`Arena ${arenaId} stopped successfully`, {}, this.context);
    } catch (error) {
      this.logger.error(
        `Error stopping arena ${arenaId}`,
        error instanceof Error ? error : new Error(String(error)),
        this.context
      );
      throw error;
    }
  }

  /**
   * Get an arena by ID
   */
  getArena(arenaId: string): ArenaOrchestrator | undefined {
    return this.arenas.get(arenaId);
  }

  /**
   * List all arenas (both running and persisted)
   */
  async listArenas(): Promise<
    Array<{
      arenaId: string;
      name: string;
      status: string;
      droneCount: number;
      startTime: number;
      endTime?: number;
    }>
  > {
    // Get all running arenas from memory
    const runningArenas = Array.from(this.arenas.entries()).map(([id, arena]) => {
      const state = arena.getState();
      const config = arena.getConfig();

      return {
        arenaId: id,
        name: config.name,
        status: state.status,
        droneCount: config.drones.length,
        startTime: state.startTime,
        endTime: state.endTime,
      };
    });

    // Get all completed arenas from storage
    const persistedArenas = (await this.storage.listArenaRuns()).map(arena => ({
      arenaId: arena.arena_id,
      name: arena.name,
      status: arena.status,
      droneCount: 0, // We'd need to join drone_results to get count
      startTime: arena.start_time,
      endTime: arena.end_time || undefined,
    }));

    // Combine and dedupe (running arenas take precedence)
    const runningIds = new Set(runningArenas.map(a => a.arenaId));
    const completedOnly = persistedArenas.filter(a => !runningIds.has(a.arenaId));

    return [...runningArenas, ...completedOnly].sort((a, b) => b.startTime - a.startTime);
  }

  /**
   * Get number of running arenas
   */
  getRunningCount(): number {
    return Array.from(this.arenas.values()).filter(arena => arena.getState().status === 'running')
      .length;
  }

  /**
   * Generate a random ID
   */
  private randomId(): string {
    return Math.random().toString(36).substring(2, 9);
  }
}

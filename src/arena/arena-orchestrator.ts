/**
 * Arena Orchestrator - Manages single arena lifecycle
 *
 * Orchestrates execution of multiple drones in an arena:
 * - Creates and manages drone instances
 * - Coordinates parallel execution
 * - Aggregates metrics and events
 * - Handles persistence
 */

import { EventEmitter } from 'events';
import type { ArenaConfig, ArenaState, DroneMetrics } from './types.js';
import { DroneInstance } from './drone-instance.js';
import { AICallQueue } from './ai-call-queue.js';
import { ArenaStorage } from './arena-storage.js';
import { EventBus } from '../core/event-bus.js';
import { UnifiedLogger } from '../logging/index.js';

export class ArenaOrchestrator extends EventEmitter {
  private drones: Map<string, DroneInstance> = new Map();
  private state: ArenaState;
  private aiCallQueue: AICallQueue;
  private storage: ArenaStorage;
  private logger = UnifiedLogger.getInstance();
  private readonly context: string;
  private events: Array<{
    id: string;
    timestamp: number;
    type: 'signal' | 'trade' | 'lifecycle';
    droneId?: string;
    droneName?: string;
    symbol?: string;
    side?: 'buy' | 'sell';
    action?: string;
    message: string;
    details?: Record<string, any>;
  }> = [];
  private readonly maxEvents = 1000; // Keep last 1000 events

  constructor(
    public arenaId: string,
    private config: ArenaConfig,
    private apiKey: string
  ) {
    super();

    const maxConcurrent = config.settings?.maxConcurrentAICalls ?? 2;
    this.aiCallQueue = new AICallQueue(maxConcurrent);
    this.storage = new ArenaStorage();
    this.context = `ArenaOrchestrator:${arenaId}`;

    // Initialize state
    this.state = {
      arenaId,
      status: 'stopped',
      startTime: 0,
      endTime: undefined,
      droneCount: config.drones.length,
      droneMetrics: new Map(),
    };

    this.logger.info(
      `ArenaOrchestrator initialized`,
      {
        arenaId,
        droneCount: config.drones.length,
      },
      this.context
    );
  }

  /**
   * Start the arena - initialize all drones and begin parallel execution
   */
  async start(): Promise<void> {
    if (this.state.status === 'running') {
      throw new Error(`Arena ${this.arenaId} is already running`);
    }

    this.state.status = 'running';
    this.state.startTime = Date.now();

    this.logger.info(
      `Starting arena ${this.arenaId}`,
      {
        arenaId: this.arenaId,
        droneCount: this.config.drones.length,
      },
      this.context
    );

    try {
      // Create drone instances
      for (const droneConfig of this.config.drones) {
        const drone = new DroneInstance(
          this.arenaId,
          droneConfig,
          this.aiCallQueue,
          this.apiKey,
          this.config
        );

        // Forward drone metrics updates
        drone.on('metrics:updated', (metrics: DroneMetrics) => {
          this.state.droneMetrics.set(metrics.droneId, metrics);
          this.emit('arena:update', this.getState());
        });

        // Listen to drone signals
        drone.on('signal:generated', (data: any) => {
          this.addEvent({
            id: `signal-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`,
            timestamp: Date.now(),
            type: 'signal',
            droneId: droneConfig.id,
            droneName: droneConfig.name,
            symbol: data.symbol || data.coin,
            action: data.action || 'HOLD',
            message: data.action
              ? `${droneConfig.name}: ${data.action} signal for ${data.symbol || data.coin}`
              : `${droneConfig.name}: Signal generated`,
            details: data,
          });
        });

        // Listen to EventBus for cycle events
        EventBus.on(`drone:${droneConfig.id}:cycle:signals` as any, (payload: any) => {
          if (payload.signals && Array.isArray(payload.signals)) {
            payload.signals.forEach((sig: any) => {
              this.addEvent({
                id: `signal-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`,
                timestamp: Date.now(),
                type: 'signal',
                droneId: droneConfig.id,
                droneName: droneConfig.name,
                symbol: `${sig.coin}/USDT`,
                action: sig.action || 'HOLD',
                message: `${droneConfig.name}: ${sig.action || 'HOLD'} signal for ${sig.coin}`,
                details: sig,
              });
            });
          }
        });

        EventBus.on(`drone:${droneConfig.id}:cycle:execution` as any, (payload: any) => {
          if (payload.executedSignals && payload.executedSignals > 0) {
            this.addEvent({
              id: `trade-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`,
              timestamp: Date.now(),
              type: 'trade',
              droneId: droneConfig.id,
              droneName: droneConfig.name,
              message: `${droneConfig.name}: Executed ${payload.executedSignals} trade${payload.executedSignals > 1 ? 's' : ''}`,
              details: payload,
            });
          }
        });

        this.drones.set(droneConfig.id, drone);
      }

      // Start all drones in parallel
      const startPromises = Array.from(this.drones.values()).map(d => d.start());
      await Promise.all(startPromises);

      // Add lifecycle event
      this.addEvent({
        id: `lifecycle-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`,
        timestamp: Date.now(),
        type: 'lifecycle',
        message: `Arena "${this.config.name}" started with ${this.drones.size} drone${this.drones.size > 1 ? 's' : ''}`,
      });

      // Emit arena started event
      EventBus.emit('arena:started' as any, {
        arenaId: this.arenaId,
        droneCount: this.drones.size,
        startTime: this.state.startTime,
      });

      this.logger.info(
        `Arena ${this.arenaId} started successfully`,
        {
          arenaId: this.arenaId,
          droneCount: this.drones.size,
        },
        this.context
      );
    } catch (error) {
      this.state.status = 'failed';
      this.state.error = error instanceof Error ? error.message : String(error);

      this.addEvent({
        id: `lifecycle-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`,
        timestamp: Date.now(),
        type: 'lifecycle',
        message: `Arena failed to start: ${error instanceof Error ? error.message : String(error)}`,
        details: { error: error instanceof Error ? error.message : String(error) },
      });

      this.logger.error(
        `Failed to start arena ${this.arenaId}`,
        error instanceof Error ? error : new Error(String(error)),
        this.context
      );

      throw error;
    }
  }

  /**
   * Stop the arena - gracefully stop all drones
   */
  async stop(): Promise<void> {
    if (this.state.status !== 'running') {
      this.logger.warn(`Arena ${this.arenaId} is not running`, {}, this.context);
      return;
    }

    this.logger.info(`Stopping arena ${this.arenaId}`, {}, this.context);

    try {
      // Stop all drones in parallel
      const stopPromises = Array.from(this.drones.values()).map(d => d.stop());
      await Promise.all(stopPromises);

      this.state.status = 'stopped';
      this.state.endTime = Date.now();

      // Add lifecycle event
      this.addEvent({
        id: `lifecycle-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`,
        timestamp: Date.now(),
        type: 'lifecycle',
        message: `Arena "${this.config.name}" stopped`,
      });

      // Persist to database
      await this.storage.saveArenaRun(this.state, this.config);

      // Emit arena stopped event
      EventBus.emit('arena:stopped' as any, {
        arenaId: this.arenaId,
        duration: this.state.endTime - this.state.startTime,
      });

      this.logger.info(
        `Arena ${this.arenaId} stopped successfully`,
        {
          arenaId: this.arenaId,
          duration: this.state.endTime - this.state.startTime,
        },
        this.context
      );
    } catch (error) {
      this.logger.error(
        `Error stopping arena ${this.arenaId}`,
        error instanceof Error ? error : new Error(String(error)),
        this.context
      );
      throw error;
    }
  }

  /**
   * Add an event to the buffer
   */
  private addEvent(event: {
    id: string;
    timestamp: number;
    type: 'signal' | 'trade' | 'lifecycle';
    droneId?: string;
    droneName?: string;
    symbol?: string;
    side?: 'buy' | 'sell';
    action?: string;
    message: string;
    details?: Record<string, any>;
  }): void {
    this.events.push(event);
    // Keep only recent events
    if (this.events.length > this.maxEvents) {
      this.events.shift();
    }
  }

  /**
   * Get recent events for this arena
   */
  getEvents(limit: number = 100): Array<{
    id: string;
    timestamp: number;
    type: 'signal' | 'trade' | 'lifecycle';
    droneId?: string;
    droneName?: string;
    symbol?: string;
    side?: 'buy' | 'sell';
    action?: string;
    message: string;
    details?: Record<string, any>;
  }> {
    return this.events.slice(-limit);
  }

  /**
   * Get current arena state
   */
  getState(): ArenaState {
    return { ...this.state };
  }

  /**
   * Get a specific drone by ID
   */
  getDrone(droneId: string): DroneInstance | undefined {
    return this.drones.get(droneId);
  }

  /**
   * Get all drones
   */
  getAllDrones(): DroneInstance[] {
    return Array.from(this.drones.values());
  }

  /**
   * Get drone metrics
   */
  getDroneMetrics(droneId: string): DroneMetrics | undefined {
    return this.state.droneMetrics.get(droneId);
  }

  /**
   * Get arena configuration
   */
  getConfig(): ArenaConfig {
    return { ...this.config };
  }
}

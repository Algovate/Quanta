/**
 * Centralized State Management Service
 * Single source of truth for all trading system state
 */

import { EventEmitter } from 'events';
import { UnifiedLogger } from '../../logging/index.js';
import { StateRepository } from './state-repository.js';
import type { StateObserver } from './state-observers.js';

export interface TradingSystemState {
  isRunning: boolean;
  cycleCount: number;
  startTime: number;
  lastUpdate: number;
  totalSignals: number;
  totalTrades: number;
  rejectedSignals: number;
  rejectedSignalsCycle: number;
  initialBalance: number;
  totalPnl: number;
  unrealizedPnl: number;
  winRate: number;
  lastCountdownTime?: number;
  previousEquity?: number;
  cyclePnl?: number;
  previousBalance?: number;
  peakEquity?: number;
  maxDrawdown?: number;
  drawdownState?: 'normal' | 'reduced' | 'paused';
  actionTotals?: {
    LONG: number;
    SHORT: number;
    CLOSE: number;
    HOLD: number;
  };
}

export interface StateUpdate {
  path: string[];
  value: any;
  timestamp: number;
}

/**
 * Centralized state management service
 * Provides single source of truth for all trading system state
 */
export class StateService extends EventEmitter {
  private static instance: StateService;
  private state: TradingSystemState;
  private repository: StateRepository;
  private logger: UnifiedLogger;
  private observers: Set<StateObserver> = new Set();
  private readonly context = 'StateService';

  private constructor() {
    super();
    this.logger = UnifiedLogger.getInstance();
    this.repository = new StateRepository();
    this.state = this.getInitialState();
  }

  static getInstance(): StateService {
    if (!StateService.instance) {
      StateService.instance = new StateService();
    }
    return StateService.instance;
  }

  /**
   * Get initial state
   */
  private getInitialState(): TradingSystemState {
    return {
      isRunning: false,
      cycleCount: 0,
      startTime: Date.now(),
      lastUpdate: Date.now(),
      totalSignals: 0,
      totalTrades: 0,
      rejectedSignals: 0,
      rejectedSignalsCycle: 0,
      initialBalance: 0,
      totalPnl: 0,
      unrealizedPnl: 0,
      winRate: 0,
      actionTotals: {
        LONG: 0,
        SHORT: 0,
        CLOSE: 0,
        HOLD: 0,
      },
    };
  }

  /**
   * Get current state (immutable copy)
   */
  getState(): Readonly<TradingSystemState> {
    return { ...this.state };
  }

  /**
   * Update state atomically
   */
  updateState(updates: Partial<TradingSystemState>): void {
    const newState = { ...this.state, ...updates, lastUpdate: Date.now() };
    const oldState = { ...this.state };

    this.state = newState;

    // Emit state change event
    this.emit('state:changed', {
      oldState,
      newState,
      updates,
      timestamp: Date.now(),
    });

    // Notify observers
    this.notifyObservers(oldState, newState, updates);

    // Persist state
    this.repository.save(this.state).catch(error => {
      this.logger.error(
        'Failed to persist state',
        error instanceof Error ? error : new Error(String(error)),
        this.context
      );
    });

    this.logger.debug('State updated', { updates, timestamp: newState.lastUpdate }, this.context);
  }

  /**
   * Update specific state path (nested updates)
   */
  updateStatePath(path: string[], value: any): void {
    const updates = this.buildUpdatesFromPath(path, value);
    this.updateState(updates);
  }

  /**
   * Build partial state object from path
   */
  private buildUpdatesFromPath(path: string[], value: any): Partial<TradingSystemState> {
    const updates: any = {};
    let current = updates;

    for (let i = 0; i < path.length - 1; i++) {
      current[path[i]] = {};
      current = current[path[i]];
    }

    current[path[path.length - 1]] = value;
    return updates;
  }

  /**
   * Subscribe to state changes
   */
  subscribe(observer: StateObserver): () => void {
    this.observers.add(observer);

    // Return unsubscribe function
    return () => {
      this.observers.delete(observer);
    };
  }

  /**
   * Notify all observers of state change
   */
  private notifyObservers(
    oldState: TradingSystemState,
    newState: TradingSystemState,
    updates: Partial<TradingSystemState>
  ): void {
    for (const observer of this.observers) {
      try {
        observer.onStateChange(oldState, newState, updates);
      } catch (error) {
        this.logger.error(
          'Error in state observer',
          error instanceof Error ? error : new Error(String(error)),
          this.context
        );
      }
    }
  }

  /**
   * Load state from repository
   */
  async loadState(): Promise<void> {
    try {
      const persisted = await this.repository.load();
      if (persisted) {
        this.state = { ...this.getInitialState(), ...persisted };
        this.emit('state:loaded', this.state);
      }
    } catch (error) {
      this.logger.warn(
        'Failed to load persisted state, using initial state',
        { error: error instanceof Error ? error.message : String(error) },
        this.context
      );
    }
  }

  /**
   * Reset state to initial
   */
  resetState(): void {
    this.state = this.getInitialState();
    this.updateState({});
    this.emit('state:reset', this.state);
  }

  /**
   * Get state snapshot for persistence
   */
  getSnapshot(): TradingSystemState {
    return { ...this.state };
  }

  /**
   * Initialize and load persisted state
   */
  async initialize(): Promise<void> {
    await this.loadState();
  }
}

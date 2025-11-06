/**
 * State Observers
 * Interfaces and utilities for observing state changes
 */

import type { TradingSystemState } from './state-service.js';

/**
 * Observer interface for state changes
 */
export interface StateObserver {
  /**
   * Called when state changes
   */
  onStateChange(
    oldState: TradingSystemState,
    newState: TradingSystemState,
    updates: Partial<TradingSystemState>
  ): void;
}

/**
 * Base observer implementation with optional filtering
 */
export abstract class BaseStateObserver implements StateObserver {
  private filters?: Array<keyof TradingSystemState>;

  constructor(filters?: Array<keyof TradingSystemState>) {
    this.filters = filters;
  }

  onStateChange(
    oldState: TradingSystemState,
    newState: TradingSystemState,
    updates: Partial<TradingSystemState>
  ): void {
    // If filters are specified, only notify if relevant fields changed
    if (this.filters) {
      const hasRelevantChanges = this.filters.some(key => key in updates);
      if (!hasRelevantChanges) {
        return;
      }
    }

    this.handleStateChange(oldState, newState, updates);
  }

  /**
   * Override this method to handle state changes
   */
  protected abstract handleStateChange(
    oldState: TradingSystemState,
    newState: TradingSystemState,
    updates: Partial<TradingSystemState>
  ): void;
}

/**
 * Observer that logs state changes
 */
export class LoggingStateObserver extends BaseStateObserver {
  protected handleStateChange(
    _oldState: TradingSystemState,
    _newState: TradingSystemState,
    updates: Partial<TradingSystemState>
  ): void {
    // Log significant state changes
    const significant = [
      'isRunning',
      'cycleCount',
      'totalPnl',
      'totalTrades',
      'drawdownState',
    ] as const;

    const significantChanges = significant.filter(key => key in updates);

    if (significantChanges.length > 0) {
      console.log('[StateService] State changed:', significantChanges.join(', '));
    }
  }
}

/**
 * Observer that emits events for WebSocket clients
 */
export class WebSocketStateObserver extends BaseStateObserver {
  private emitFn: (event: string, data: any) => void;

  constructor(emitFn: (event: string, data: any) => void) {
    super();
    this.emitFn = emitFn;
  }

  protected handleStateChange(
    _oldState: TradingSystemState,
    newState: TradingSystemState,
    _updates: Partial<TradingSystemState>
  ): void {
    this.emitFn('system:state', newState);
  }
}

/**
 * Typed Event Bus for Trading System Events
 * Provides type-safe event emission and subscription across the application
 */

import { UnifiedLogger } from '../logging/index.js';

const logger = UnifiedLogger.getInstance();

/**
 * Signal information passed in events
 */
interface SignalInfo {
  coin: string;
  action: string;
  confidence: number;
}

/**
 * Event payload definitions for all trading system events
 */
type EventPayloads = {
  /** Emitted when a bar closes for a symbol/timeframe */
  'bar:closed': {
    symbol: string;
    timeframe: string;
    openTime: number;
    closeTime: number;
  };

  /** Emitted when a data gap is detected */
  'gap:detected': {
    symbol: string;
    timeframe: string;
    missingFrom: number;
    missingTo: number;
  };

  /** Emitted when a trading cycle starts */
  'cycle:start': {
    cycleCount: number;
    timestamp: number;
    startTime: number;
  };

  /** Emitted when AI signals are generated */
  'cycle:signals': {
    cycleCount: number;
    timestamp: number;
    signalCount: number;
    signals: SignalInfo[];
  };

  /** Emitted when signal execution phase completes */
  'cycle:execution': {
    cycleCount: number;
    timestamp: number;
    executedSignals: number;
    totalTrades: number;
  };

  /** Emitted when a trading cycle completes successfully */
  'cycle:complete': {
    cycleCount: number;
    timestamp: number;
    duration: number;
    totalSignals: number; // cumulative
    totalTrades: number; // cumulative
    totalPnl: number; // cumulative
    // New: per-cycle deltas for UI timelines
    signalCount: number; // signals generated in this cycle
    tradeCount: number; // trades executed in this cycle
    cyclePnl: number; // P&L change during this cycle
    // Per-cycle action distribution (canonical backend types)
    actionCounts: {
      LONG: number;
      SHORT: number;
      CLOSE: number;
      HOLD: number;
    };
  };

  /** Emitted when an error occurs during a cycle */
  'cycle:error': {
    cycleCount: number;
    error: string;
    timestamp: number;
  };

  /** Emitted for buffering signals in the UI */
  'signal:buffer': {
    id: string;
    timestamp: number;
    symbol: string;
    action: string;
    confidence: number;
    reasoning?: string;
    price?: number;
    strategy?: string;
    status?: string;
  };
};

type EventKey = keyof EventPayloads;
type Listener<K extends EventKey> = (payload: EventPayloads[K]) => void;

/**
 * Type-safe event bus implementation
 * Singleton pattern ensures single event bus instance across the application
 */
class TypedEventBus {
  private static instance: TypedEventBus;
  private listeners: Partial<Record<EventKey, Set<Listener<EventKey>>>> = {};

  private constructor() {
    // Private constructor for singleton pattern
  }

  /**
   * Get the singleton instance of the event bus
   */
  static getInstance(): TypedEventBus {
    if (!TypedEventBus.instance) {
      TypedEventBus.instance = new TypedEventBus();
    }
    return TypedEventBus.instance;
  }

  /**
   * Subscribe to an event
   * @param event - Event name to subscribe to
   * @param listener - Callback function to execute when event is emitted
   */
  on<K extends EventKey>(event: K, listener: Listener<K>): void {
    if (!this.listeners[event]) {
      this.listeners[event] = new Set();
    }
    (this.listeners[event] as Set<Listener<K>>).add(listener);
  }

  /**
   * Unsubscribe from an event
   * @param event - Event name to unsubscribe from
   * @param listener - Callback function to remove
   */
  off<K extends EventKey>(event: K, listener: Listener<K>): void {
    const listenerSet = this.listeners[event] as Set<Listener<K>> | undefined;
    if (listenerSet) {
      listenerSet.delete(listener);
    }
  }

  /**
   * Emit an event with typed payload
   * @param event - Event name to emit
   * @param payload - Event payload matching the event type
   */
  emit<K extends EventKey>(event: K, payload: EventPayloads[K]): void {
    const listenerSet = this.listeners[event] as Set<Listener<K>> | undefined;
    if (!listenerSet || listenerSet.size === 0) {
      return;
    }

    for (const listener of listenerSet) {
      try {
        listener(payload);
      } catch (error) {
        logger.error(
          `Error in event listener for '${event}'`,
          error instanceof Error ? error : new Error(String(error)),
          'EventBus'
        );
      }
    }
  }

  /**
   * Remove all listeners for a specific event or all events
   * @param event - Optional event name. If not provided, removes all listeners
   */
  removeAllListeners(event?: EventKey): void {
    if (event) {
      delete this.listeners[event];
    } else {
      this.listeners = {};
    }
  }

  /**
   * Get the count of listeners for a specific event
   * @param event - Event name to check
   * @returns Number of registered listeners
   */
  listenerCount(event: EventKey): number {
    return this.listeners[event]?.size ?? 0;
  }
}

export const EventBus = TypedEventBus.getInstance();
export { TypedEventBus };
export type { EventPayloads, EventKey, SignalInfo };

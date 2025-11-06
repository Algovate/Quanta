/**
 * Unified Event Emitter
 * Type-safe event emission and subscription
 */

import { EventEmitter } from 'events';
import type { UnifiedEvent, EventCategory } from './event-types.js';

export type EventHandler<T extends UnifiedEvent = UnifiedEvent> = (
  event: T
) => void | Promise<void>;

export interface EventSubscription {
  unsubscribe: () => void;
}

/**
 * Unified Event Emitter
 * Provides type-safe event emission and subscription
 */
export class UnifiedEventEmitter extends EventEmitter {
  /**
   * Subscribe to events of a specific category
   */
  subscribe<T extends UnifiedEvent>(
    category: EventCategory,
    handler: EventHandler<T>
  ): EventSubscription {
    const listener = (event: UnifiedEvent) => {
      if (event.category === category) {
        handler(event as T);
      }
    };

    this.on('*', listener);

    return {
      unsubscribe: () => {
        this.off('*', listener);
      },
    };
  }

  /**
   * Subscribe to specific event type
   */
  subscribeToType<T extends UnifiedEvent>(
    category: EventCategory,
    type: T['type'],
    handler: EventHandler<T>
  ): EventSubscription {
    const listener = (event: UnifiedEvent) => {
      if (event.category === category && event.type === type) {
        handler(event as T);
      }
    };

    this.on('*', listener);

    return {
      unsubscribe: () => {
        this.off('*', listener);
      },
    };
  }

  /**
   * Emit a unified event
   */
  emitEvent(event: UnifiedEvent): void {
    // Emit to specific category
    this.emit(event.category, event);

    // Emit to specific type
    this.emit(`${event.category}:${event.type}`, event);

    // Emit to wildcard listeners
    this.emit('*', event);
  }

  /**
   * Create event builder for fluent event creation
   */
  createEvent<T extends UnifiedEvent>(
    category: EventCategory,
    type: T['type'],
    source: string,
    data?: any, // Use any for data to avoid type indexing issues
    metadata?: Record<string, any>
  ): T {
    return {
      category,
      type: type as any,
      timestamp: Date.now(),
      source,
      data: data as any,
      metadata,
    } as T;
  }

  /**
   * Emit system event
   */
  emitSystemEvent(type: SystemEvent['type'], source: string, metadata?: Record<string, any>): void {
    const event = this.createEvent('system', type, source, undefined, metadata);
    this.emitEvent(event);
  }

  /**
   * Emit trading event
   */
  emitTradingEvent(
    type: TradingEvent['type'],
    source: string,
    data: TradingEvent['data'],
    metadata?: Record<string, any>
  ): void {
    const event = this.createEvent('trading', type, source, data, metadata);
    this.emitEvent(event);
  }

  /**
   * Emit risk event
   */
  emitRiskEvent(
    type: RiskEvent['type'],
    source: string,
    data: RiskEvent['data'],
    metadata?: Record<string, any>
  ): void {
    const event = this.createEvent('risk', type, source, data, metadata);
    this.emitEvent(event);
  }

  /**
   * Emit execution event
   */
  emitExecutionEvent(
    type: ExecutionEvent['type'],
    source: string,
    data: ExecutionEvent['data'],
    metadata?: Record<string, any>
  ): void {
    const event = this.createEvent('execution', type, source, data, metadata);
    this.emitEvent(event);
  }

  /**
   * Emit market event
   */
  emitMarketEvent(
    type: MarketEvent['type'],
    source: string,
    data: MarketEvent['data'],
    metadata?: Record<string, any>
  ): void {
    const event = this.createEvent('market', type, source, data, metadata);
    this.emitEvent(event);
  }

  /**
   * Emit analytics event
   */
  emitAnalyticsEvent(
    type: AnalyticsEvent['type'],
    source: string,
    data: AnalyticsEvent['data'],
    metadata?: Record<string, any>
  ): void {
    const event = this.createEvent('analytics', type, source, data, metadata);
    this.emitEvent(event);
  }

  /**
   * Emit portfolio event
   */
  emitPortfolioEvent(
    type: PortfolioEvent['type'],
    source: string,
    data: PortfolioEvent['data'],
    metadata?: Record<string, any>
  ): void {
    const event = this.createEvent('portfolio', type, source, data, metadata);
    this.emitEvent(event);
  }
}

// Import types for use in implementation
import type {
  SystemEvent,
  TradingEvent,
  RiskEvent,
  ExecutionEvent,
  MarketEvent,
  AnalyticsEvent,
  PortfolioEvent,
} from './event-types.js';

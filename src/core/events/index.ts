/**
 * Unified Event-Driven Architecture
 *
 * Provides type-safe event emission and subscription
 */

export type {
  UnifiedEvent,
  EventCategory,
  SystemEvent,
  TradingEvent,
  RiskEvent,
  ExecutionEvent,
  MarketEvent,
  AnalyticsEvent,
  PortfolioEvent,
} from './event-types.js';

export { UnifiedEventEmitter, type EventHandler, type EventSubscription } from './event-emitter.js';

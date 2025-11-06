/**
 * Centralized State Management
 *
 * Provides single source of truth for all trading system state
 */

export { StateService, type TradingSystemState, type StateUpdate } from './state-service.js';
export { StateRepository } from './state-repository.js';
export {
  type StateObserver,
  BaseStateObserver,
  LoggingStateObserver,
  WebSocketStateObserver,
} from './state-observers.js';

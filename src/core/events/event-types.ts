/**
 * Unified Event Types
 * Centralized event type definitions
 */

export type EventCategory =
  | 'system'
  | 'trading'
  | 'risk'
  | 'execution'
  | 'market'
  | 'analytics'
  | 'portfolio';

export interface BaseEvent {
  category: EventCategory;
  type: string;
  timestamp: number;
  source: string;
  metadata?: Record<string, any>;
}

/**
 * System Events
 */
export interface SystemEvent extends BaseEvent {
  category: 'system';
  type: 'started' | 'stopped' | 'paused' | 'resumed' | 'error' | 'state_changed';
}

/**
 * Trading Events
 */
export interface TradingEvent extends BaseEvent {
  category: 'trading';
  type:
    | 'signal_generated'
    | 'signal_validated'
    | 'signal_rejected'
    | 'cycle_started'
    | 'cycle_completed';
  data: {
    signal?: {
      coin: string;
      action: string;
      confidence: number;
    };
    cycleCount?: number;
  };
}

/**
 * Risk Events
 */
export interface RiskEvent extends BaseEvent {
  category: 'risk';
  type:
    | 'position_sized'
    | 'risk_check_passed'
    | 'risk_check_failed'
    | 'drawdown_detected'
    | 'regime_changed';
  data: {
    symbol?: string;
    riskAmount?: number;
    drawdown?: number;
    regime?: string;
  };
}

/**
 * Execution Events
 */
export interface ExecutionEvent extends BaseEvent {
  category: 'execution';
  type:
    | 'order_placed'
    | 'order_filled'
    | 'order_failed'
    | 'position_opened'
    | 'position_closed'
    | 'position_updated';
  data: {
    orderId?: string;
    symbol?: string;
    side?: string;
    amount?: number;
    price?: number;
  };
}

/**
 * Market Events
 */
export interface MarketEvent extends BaseEvent {
  category: 'market';
  type: 'price_update' | 'volume_spike' | 'volatility_change' | 'regime_transition';
  data: {
    symbol?: string;
    price?: number;
    volume?: number;
    volatility?: number;
  };
}

/**
 * Analytics Events
 */
export interface AnalyticsEvent extends BaseEvent {
  category: 'analytics';
  type: 'performance_updated' | 'metric_calculated' | 'report_generated';
  data: {
    metric?: string;
    value?: number;
    report?: string;
  };
}

/**
 * Portfolio Events
 */
export interface PortfolioEvent extends BaseEvent {
  category: 'portfolio';
  type: 'positions_updated' | 'correlation_changed' | 'diversification_updated' | 'risk_updated';
  data: {
    positionCount?: number;
    correlationScore?: number;
    diversificationScore?: number;
    totalRisk?: number;
  };
}

export type UnifiedEvent =
  | SystemEvent
  | TradingEvent
  | RiskEvent
  | ExecutionEvent
  | MarketEvent
  | AnalyticsEvent
  | PortfolioEvent;

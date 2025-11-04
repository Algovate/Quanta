/**
 * Web API DTOs - Typed response shapes for API endpoints
 */

/**
 * Health check response
 */
export interface HealthResponse {
  status: 'ok' | 'degraded';
  timestamp: number;
}

/**
 * System status response
 */
export interface SystemStatusResponse {
  state: {
    isRunning: boolean;
    cycleCount?: number;
    startTime?: number;
    lastUpdate?: number;
  };
  account: {
    balance: number;
    equity: number;
    availableMargin: number;
    usedMargin: number;
    marginRatio: number;
    timestamp: number;
  } | null;
  positions: Array<{
    symbol: string;
    side: 'long' | 'short';
    size: number;
    entryPrice: number;
    markPrice: number;
    unrealizedPnl: number;
    marginUsed: number;
    notional: number;
    leverage: number;
    timestamp: number;
    customStopLoss?: number;
    customTakeProfit?: number;
  }>;
}

/**
 * Execution session response
 */
export interface SessionResponse {
  active: boolean;
  session: {
    mode?: string;
    id?: string;
    startTime?: number;
  } | null;
}

/**
 * API error response
 */
export interface ApiErrorResponse {
  code: string;
  message: string;
  details?: unknown;
  timestamp: number;
}

/**
 * Success response
 */
export interface SuccessResponse {
  success: boolean;
  message: string;
  data?: unknown;
}

/**
 * Timeout constants for execution operations
 * Centralized values to improve maintainability and consistency
 */

export const TIMEOUTS = {
  /** Timeout for ticker price fetches (5 seconds) */
  TICKER_FETCH_MS: 5000,
  /** Timeout for API calls in general (10 seconds) */
  API_CALL_MS: 10000,
  /** Timeout for exchange snapshot operations (15 seconds) */
  SNAPSHOT_MS: 15000,
} as const;

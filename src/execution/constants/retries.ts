/**
 * Retry constants for execution operations
 * Centralized values to improve maintainability and consistency
 */

export const RETRIES = {
  /** Maximum retry attempts for position monitoring */
  POSITION_MONITORING_MAX: 3,
  /** Maximum retry attempts for API calls */
  API_MAX: 3,
  /** Maximum retry attempts for order execution */
  ORDER_EXECUTION_MAX: 3,
} as const;

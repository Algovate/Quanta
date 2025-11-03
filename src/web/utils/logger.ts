/**
 * Standardized logger utility for backend services
 *
 * Provides consistent logger initialization and access patterns across
 * all backend modules (routes, services, managers, etc.)
 */

import { UnifiedLogger } from '../../logging/index.js';

/**
 * Logger context for different backend components
 */
export type BackendLoggerContext =
  | 'Server'
  | 'TradingService'
  | 'TradingManager'
  | 'SystemRoutes'
  | 'TradeRoutes'
  | 'DataRoutes'
  | 'MarketRoutes'
  | 'BacktestRoutes'
  | 'ErrorHandler'
  | 'HealthCheck';

/**
 * Logger instance and context pair
 */
export interface LoggerPair {
  logger: UnifiedLogger;
  context: BackendLoggerContext;
}

let loggerInstance: UnifiedLogger | null = null;

/**
 * Get or create the shared UnifiedLogger instance
 * Ensures logger is initialized only once
 */
function getLogger(): UnifiedLogger {
  if (!loggerInstance) {
    loggerInstance = UnifiedLogger.getInstance();
    loggerInstance.initialize();
  }
  return loggerInstance;
}

/**
 * Create a standardized logger pair for a backend component
 *
 * @param context - The context name for logging (e.g., 'Server', 'TradeRoutes')
 * @returns Logger instance and context string
 *
 * @example
 * ```typescript
 * const { logger, context } = createLogger('TradeRoutes');
 * logger.info('Route handler called', {}, context);
 * ```
 */
export function createLogger(context: BackendLoggerContext): LoggerPair {
  return {
    logger: getLogger(),
    context,
  };
}

/**
 * Get the shared logger instance (for cases where you don't need context)
 *
 * @returns UnifiedLogger instance (already initialized)
 *
 * @example
 * ```typescript
 * const logger = getSharedLogger();
 * logger.info('Message', {}, 'MyContext');
 * ```
 */
export function getSharedLogger(): UnifiedLogger {
  return getLogger();
}

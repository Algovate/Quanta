/**
 * Exchange utility functions for API routes
 */

import type { TradingManager } from '../trading-manager.js';
import type { Exchange } from '../../exchange/types.js';
import { getConfig } from '../../config/settings.js';
import { createDataSourceManager } from '../../core/data-source-manager.js';

/**
 * Resolves exchange instance from workflow or creates a new one from config
 * @param tradingManager - The trading manager instance
 * @returns An exchange instance
 */
export async function resolveExchange(tradingManager: TradingManager): Promise<Exchange> {
  const workflow = tradingManager.getWorkflow();
  if (workflow) {
    return workflow.getExchange();
  }

  // Fallback: create exchange from config
  const config = getConfig();
  const dsm = createDataSourceManager(config);
  return dsm.getExchange();
}

/**
 * Checks if an exchange does not support CCXT-based features (simulator/paper/backtest)
 * @param exchangeName - The exchange name
 * @returns True if the exchange is a simulator, paper, or backtest exchange
 */
export function isNonCCXTExchange(exchangeName: string): boolean {
  return (
    exchangeName === 'simulator' || exchangeName.startsWith('paper(') || exchangeName === 'backtest'
  );
}

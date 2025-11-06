/**
 * Execution Service Interface
 * Business logic for order execution
 */

import type { TradingSignal } from '../../types/index.js';
import type { Account, Position, Order } from '../../exchange/types.js';
import type { TechnicalIndicators } from '../../types/index.js';

export interface ExecutionResult {
  success: boolean;
  order?: Order;
  error?: string;
  realizedPnl?: number;
  fees?: number;
}

export interface ExecutionService {
  /**
   * Execute a trading signal
   */
  executeSignal(
    signal: TradingSignal,
    account: Account,
    positions: Position[],
    currentPrice: number,
    indicators?: TechnicalIndicators
  ): Promise<ExecutionResult>;

  /**
   * Calculate expected slippage
   */
  calculateExpectedSlippage(
    symbol: string,
    orderSize: number,
    currentPrice: number,
    side: 'buy' | 'sell'
  ): number;
}

/**
 * Execution Service Implementation
 * Wraps existing execution logic
 */

import type { ExecutionService, ExecutionResult } from './interfaces/execution-service.js';
import type { TradingSignal } from '../types/index.js';
import type { Account, Position } from '../exchange/types.js';
import type { TechnicalIndicators } from '../types/index.js';
import type { OrderExecutor } from '../execution/orders.js';
import type { SlippageManager } from '../execution/slippage-manager.js';

export class ExecutionServiceImpl implements ExecutionService {
  constructor(
    private orderExecutor: OrderExecutor,
    private slippageManager: SlippageManager
  ) {}

  async executeSignal(
    signal: TradingSignal,
    account: Account,
    positions: Position[],
    currentPrice: number,
    indicators?: TechnicalIndicators
  ): Promise<ExecutionResult> {
    // Delegate to order executor
    const result = await this.orderExecutor.executeSignal(
      signal,
      account,
      positions,
      currentPrice,
      indicators
    );

    return {
      success: result.success,
      order: result.order,
      error: result.error,
      realizedPnl: result.realizedPnl,
      fees: result.fees,
    };
  }

  calculateExpectedSlippage(
    symbol: string,
    orderSize: number,
    currentPrice: number,
    side: 'buy' | 'sell'
  ): number {
    // Delegate to slippage manager
    const metrics = this.slippageManager.calculateExpectedSlippage(
      symbol,
      orderSize,
      currentPrice,
      side
    );
    return metrics.expectedSlippage;
  }
}

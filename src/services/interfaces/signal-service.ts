/**
 * Signal Service Interface
 * Business logic for signal generation
 */

import type { TradingSignal, MarketData } from '../../types/index.js';
import type { Account, Position } from '../../exchange/types.js';

export interface SignalService {
  /**
   * Generate trading signals based on market data
   */
  generateSignals(
    marketData: MarketData[],
    account: Account,
    positions: Position[]
  ): Promise<TradingSignal[]>;

  /**
   * Validate signal quality
   */
  validateSignal(signal: TradingSignal, account: Account, positions: Position[]): boolean;

  /**
   * Calculate signal quality score
   */
  calculateQualityScore(signal: TradingSignal, marketData: MarketData[]): number;
}

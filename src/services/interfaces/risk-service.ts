/**
 * Risk Service Interface
 * Business logic for risk management
 */

import type { TradingSignal, PositionSizing } from '../../types/index.js';
import type { Account, Position } from '../../exchange/types.js';
import type { TechnicalIndicators } from '../../types/index.js';

export interface RiskService {
  /**
   * Calculate position sizing
   */
  calculatePositionSizing(
    signal: TradingSignal,
    account: Account,
    positions: Position[],
    currentPrice: number,
    atr14?: number,
    indicators?: TechnicalIndicators
  ): PositionSizing | null;

  /**
   * Validate risk constraints
   */
  validateRisk(signal: TradingSignal, account: Account, positions: Position[]): boolean;

  /**
   * Calculate portfolio risk metrics
   */
  calculatePortfolioRisk(
    account: Account,
    positions: Position[]
  ): {
    totalRisk: number;
    maxDrawdown: number;
    correlationScore: number;
    diversificationScore: number;
  };
}

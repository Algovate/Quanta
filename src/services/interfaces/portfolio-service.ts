/**
 * Portfolio Service Interface
 * Business logic for portfolio management
 */

import type { Account, Position } from '../../exchange/types.js';

export interface PortfolioMetrics {
  totalExposure: number;
  totalMarginUsed: number;
  leverage: number;
  diversificationScore: number;
  correlationScore: number;
  riskConcentration: number;
}

export interface PortfolioService {
  /**
   * Calculate portfolio metrics
   */
  calculateMetrics(account: Account, positions: Position[]): PortfolioMetrics;

  /**
   * Check if portfolio can accept new position
   */
  canAcceptNewPosition(
    account: Account,
    positions: Position[],
    newPositionSize: number,
    newPositionValue: number
  ): boolean;

  /**
   * Calculate optimal position allocation
   */
  calculateOptimalAllocation(
    account: Account,
    positions: Position[],
    opportunities: Array<{ symbol: string; expectedReturn: number; risk: number }>
  ): Map<string, number>;
}

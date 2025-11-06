/**
 * Risk Service Implementation
 * Wraps existing risk management logic
 */

import type { RiskService } from './interfaces/risk-service.js';
import type { TradingSignal, PositionSizing } from '../types/index.js';
import type { Account, Position } from '../exchange/types.js';
import type { TechnicalIndicators } from '../types/index.js';
import type { RiskManager } from '../execution/risk.js';
import { aggregatePositionMetrics } from '../execution/position-utils.js';

export class RiskServiceImpl implements RiskService {
  constructor(private riskManager: RiskManager) {}

  calculatePositionSizing(
    signal: TradingSignal,
    account: Account,
    positions: Position[],
    currentPrice: number,
    atr14?: number,
    indicators?: TechnicalIndicators
  ): PositionSizing | null {
    // Delegate to risk manager
    return this.riskManager.calculatePositionSizing(
      signal,
      account,
      positions,
      currentPrice,
      atr14,
      indicators
    );
  }

  validateRisk(signal: TradingSignal, account: Account, positions: Position[]): boolean {
    // Delegate to risk manager
    const result = this.riskManager.validateSignal(signal, account, positions);
    return result.valid;
  }

  calculatePortfolioRisk(
    account: Account,
    positions: Position[]
  ): {
    totalRisk: number;
    maxDrawdown: number;
    correlationScore: number;
    diversificationScore: number;
  } {
    // Calculate portfolio-level risk metrics
    const aggregates = aggregatePositionMetrics(positions);
    const totalRisk = aggregates.totalMarginUsed / account.equity;

    // Calculate correlation and diversification scores
    const uniqueSymbols = new Set(positions.map(p => p.symbol)).size;
    const totalPositions = positions.length;
    const diversificationScore = totalPositions > 1 ? uniqueSymbols / totalPositions : 1;

    // Simple correlation score (all same side = higher correlation)
    const sides = positions.map(p => p.side);
    const allSameSide = sides.length > 0 && sides.every(side => side === sides[0]);
    const correlationScore = allSameSide ? 0.8 : 0.3;

    return {
      totalRisk,
      maxDrawdown: 0, // Will be calculated from historical data
      correlationScore,
      diversificationScore,
    };
  }
}

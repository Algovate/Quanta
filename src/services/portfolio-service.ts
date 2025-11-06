/**
 * Portfolio Service Implementation
 * Business logic for portfolio management
 */

import type { PortfolioService, PortfolioMetrics } from './interfaces/portfolio-service.js';
import type { Account, Position } from '../exchange/types.js';
import { aggregatePositionMetrics } from '../execution/position-utils.js';
import { MPTOptimizer, type AssetOpportunity } from '../portfolio/mpt-optimizer.js';

export class PortfolioServiceImpl implements PortfolioService {
  private mptOptimizer: MPTOptimizer;

  constructor() {
    this.mptOptimizer = new MPTOptimizer();
  }

  calculateMetrics(account: Account, positions: Position[]): PortfolioMetrics {
    const aggregates = aggregatePositionMetrics(positions);

    // Calculate diversification score
    const uniqueSymbols = new Set(positions.map(p => p.symbol)).size;
    const totalPositions = positions.length;
    const diversificationScore = totalPositions > 1 ? uniqueSymbols / totalPositions : 1;

    // Calculate correlation score
    const sides = positions.map(p => p.side);
    const allSameSide = sides.length > 0 && sides.every(side => side === sides[0]);
    let correlationScore = allSameSide ? 0.8 : 0.3;

    // Adjust based on position count
    correlationScore = correlationScore * (3 / Math.max(positions.length, 1));
    correlationScore = Math.min(1, correlationScore);

    // Calculate leverage
    const leverage = account.equity > 0 ? aggregates.totalUnleveredExposure / account.equity : 0;

    // Calculate risk concentration
    const riskConcentration = account.equity > 0 ? aggregates.totalMarginUsed / account.equity : 0;

    return {
      totalExposure: aggregates.totalUnleveredExposure,
      totalMarginUsed: aggregates.totalMarginUsed,
      leverage,
      diversificationScore,
      correlationScore,
      riskConcentration,
    };
  }

  canAcceptNewPosition(
    account: Account,
    positions: Position[],
    _newPositionSize: number,
    newPositionValue: number
  ): boolean {
    const metrics = this.calculateMetrics(account, positions);

    // Check if adding new position would exceed risk limits
    const newMarginUsed = newPositionValue;
    const totalMarginUsed = metrics.totalMarginUsed + newMarginUsed;
    const marginRatio = account.equity > 0 ? totalMarginUsed / account.equity : 0;

    // Simple check: don't exceed 30% margin usage
    return marginRatio <= 0.3;
  }

  calculateOptimalAllocation(
    account: Account,
    positions: Position[],
    opportunities: Array<{ symbol: string; expectedReturn: number; risk: number }>
  ): Map<string, number> {
    // Convert opportunities to MPT format
    const assetOpportunities: AssetOpportunity[] = opportunities.map(opp => ({
      symbol: opp.symbol,
      expectedReturn: opp.expectedReturn,
      volatility: opp.risk,
    }));

    // Optimize using Modern Portfolio Theory
    const optimizedPortfolio = this.mptOptimizer.optimizePortfolio(assetOpportunities, {
      minWeight: 0.05, // Minimum 5% per asset
      maxWeight: 0.3, // Maximum 30% per asset
      maxPositions: positions.length + 3, // Allow some new positions
    });

    if (optimizedPortfolio) {
      // Allocate capital based on MPT-optimized weights
      return this.mptOptimizer.allocateCapital(account, optimizedPortfolio);
    }

    // Fallback: equal weight allocation
    const allocation = new Map<string, number>();
    const availableCapital = account.availableMargin * 0.6; // 60% of available margin
    const perOpportunity = availableCapital / opportunities.length;

    for (const opp of opportunities) {
      allocation.set(opp.symbol, perOpportunity);
    }

    return allocation;
  }
}

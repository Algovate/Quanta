/**
 * Modern Portfolio Theory (MPT) Optimizer
 * Portfolio optimization using Markowitz mean-variance optimization
 */

import type { Account } from '../exchange/types.js';

export interface AssetOpportunity {
  symbol: string;
  expectedReturn: number; // Expected return (annualized)
  volatility: number; // Volatility (standard deviation)
  covariance?: Map<string, number>; // Covariance with other assets
}

export interface OptimizedPortfolio {
  weights: Map<string, number>; // Asset weights (0-1)
  expectedReturn: number;
  volatility: number;
  sharpeRatio: number;
  efficientFrontier: Array<{
    return: number;
    volatility: number;
    weights: Map<string, number>;
  }>;
}

export interface EfficientFrontierPoint {
  return: number;
  volatility: number;
  weights: Map<string, number>;
}

/**
 * Modern Portfolio Theory Optimizer
 * Implements Markowitz mean-variance optimization
 */
export class MPTOptimizer {
  private riskFreeRate: number = 0.02; // 2% annual risk-free rate

  constructor(riskFreeRate: number = 0.02) {
    this.riskFreeRate = riskFreeRate;
  }

  /**
   * Optimize portfolio using mean-variance optimization
   */
  optimizePortfolio(
    opportunities: AssetOpportunity[],
    constraints?: {
      minWeight?: number;
      maxWeight?: number;
      maxPositions?: number;
      targetReturn?: number;
    }
  ): OptimizedPortfolio | null {
    if (opportunities.length === 0) {
      return null;
    }

    // Build covariance matrix
    const covarianceMatrix = this.buildCovarianceMatrix(opportunities);

    // Calculate expected returns vector
    const expectedReturns = opportunities.map(opp => opp.expectedReturn);

    // Calculate efficient frontier
    const efficientFrontier = this.calculateEfficientFrontier(
      opportunities,
      covarianceMatrix,
      constraints
    );

    if (efficientFrontier.length === 0) {
      return null;
    }

    // Find optimal portfolio (maximum Sharpe ratio)
    const optimalPoint = this.findOptimalPortfolio(
      efficientFrontier,
      expectedReturns,
      covarianceMatrix
    );

    const weights = optimalPoint.weights;
    const expectedReturn = optimalPoint.return;
    const volatility = optimalPoint.volatility;
    const sharpeRatio = this.calculateSharpeRatio(expectedReturn, volatility);

    return {
      weights,
      expectedReturn,
      volatility,
      sharpeRatio,
      efficientFrontier,
    };
  }

  /**
   * Build covariance matrix from asset opportunities
   */
  private buildCovarianceMatrix(opportunities: AssetOpportunity[]): number[][] {
    const n = opportunities.length;
    const matrix: number[][] = Array(n)
      .fill(0)
      .map(() => Array(n).fill(0));

    for (let i = 0; i < n; i++) {
      for (let j = 0; j < n; j++) {
        if (i === j) {
          // Diagonal: variance = volatility^2
          matrix[i][j] = opportunities[i].volatility ** 2;
        } else {
          // Off-diagonal: covariance
          if (opportunities[i].covariance?.has(opportunities[j].symbol)) {
            matrix[i][j] = opportunities[i].covariance!.get(opportunities[j].symbol)!;
          } else {
            // Estimate covariance from correlation (simplified)
            // Assume correlation of 0.5 for crypto assets
            const correlation = 0.5;
            matrix[i][j] = correlation * opportunities[i].volatility * opportunities[j].volatility;
          }
        }
      }
    }

    return matrix;
  }

  /**
   * Calculate efficient frontier
   */
  private calculateEfficientFrontier(
    opportunities: AssetOpportunity[],
    covarianceMatrix: number[][],
    constraints?: {
      minWeight?: number;
      maxWeight?: number;
      maxPositions?: number;
      targetReturn?: number;
    }
  ): EfficientFrontierPoint[] {
    const frontier: EfficientFrontierPoint[] = [];
    const minReturn = Math.min(...opportunities.map(opp => opp.expectedReturn));
    const maxReturn = Math.max(...opportunities.map(opp => opp.expectedReturn));
    const steps = 50; // Number of points on frontier

    for (let i = 0; i <= steps; i++) {
      const targetReturn = minReturn + (maxReturn - minReturn) * (i / steps);

      // Optimize for this target return
      const weights = this.optimizeForTargetReturn(
        opportunities,
        covarianceMatrix,
        targetReturn,
        constraints
      );

      if (weights) {
        const portfolioReturn = this.calculatePortfolioReturn(opportunities, weights);
        const portfolioVolatility = this.calculatePortfolioVolatility(
          opportunities,
          weights,
          covarianceMatrix
        );

        frontier.push({
          return: portfolioReturn,
          volatility: portfolioVolatility,
          weights,
        });
      }
    }

    return frontier;
  }

  /**
   * Optimize portfolio weights for target return
   * Simplified: equal weight allocation with constraints
   */
  private optimizeForTargetReturn(
    opportunities: AssetOpportunity[],
    _covarianceMatrix: number[][],
    _targetReturn: number,
    constraints?: {
      minWeight?: number;
      maxWeight?: number;
      maxPositions?: number;
    }
  ): Map<string, number> | null {
    // Simplified optimization: equal weight with constraints
    // In production, would use quadratic programming solver

    const weights = new Map<string, number>();
    const minWeight = constraints?.minWeight || 0;
    const maxWeight = constraints?.maxWeight || 1.0;
    const maxPositions = constraints?.maxPositions || opportunities.length;

    // Sort opportunities by expected return (descending)
    const sorted = [...opportunities].sort((a, b) => b.expectedReturn - a.expectedReturn);

    // Select top opportunities
    const selected = sorted.slice(0, maxPositions);

    // Equal weight allocation
    const weightPerAsset = 1.0 / selected.length;

    // Apply constraints
    let totalWeight = 0;
    for (const opp of selected) {
      const weight = Math.max(minWeight, Math.min(maxWeight, weightPerAsset));
      weights.set(opp.symbol, weight);
      totalWeight += weight;
    }

    // Normalize weights
    if (totalWeight > 0) {
      for (const [symbol, weight] of weights.entries()) {
        weights.set(symbol, weight / totalWeight);
      }
    }

    return weights;
  }

  /**
   * Calculate portfolio expected return
   */
  private calculatePortfolioReturn(
    opportunities: AssetOpportunity[],
    weights: Map<string, number>
  ): number {
    let portfolioReturn = 0;

    for (const opp of opportunities) {
      const weight = weights.get(opp.symbol) || 0;
      portfolioReturn += weight * opp.expectedReturn;
    }

    return portfolioReturn;
  }

  /**
   * Calculate portfolio volatility
   */
  private calculatePortfolioVolatility(
    opportunities: AssetOpportunity[],
    weights: Map<string, number>,
    covarianceMatrix: number[][]
  ): number {
    let portfolioVariance = 0;
    const n = opportunities.length;

    for (let i = 0; i < n; i++) {
      const weightI = weights.get(opportunities[i].symbol) || 0;

      for (let j = 0; j < n; j++) {
        const weightJ = weights.get(opportunities[j].symbol) || 0;
        portfolioVariance += weightI * weightJ * covarianceMatrix[i][j];
      }
    }

    return Math.sqrt(portfolioVariance);
  }

  /**
   * Find optimal portfolio (maximum Sharpe ratio)
   */
  private findOptimalPortfolio(
    efficientFrontier: EfficientFrontierPoint[],
    _expectedReturns: number[],
    _covarianceMatrix: number[][]
  ): EfficientFrontierPoint {
    // Find point with maximum Sharpe ratio
    let maxSharpe = -Infinity;
    let optimalPoint = efficientFrontier[0];

    for (const point of efficientFrontier) {
      const sharpe = this.calculateSharpeRatio(point.return, point.volatility);
      if (sharpe > maxSharpe) {
        maxSharpe = sharpe;
        optimalPoint = point;
      }
    }

    return optimalPoint;
  }

  /**
   * Calculate Sharpe ratio
   */
  private calculateSharpeRatio(expectedReturn: number, volatility: number): number {
    if (volatility === 0) {
      return 0;
    }
    return (expectedReturn - this.riskFreeRate) / volatility;
  }

  /**
   * Allocate capital based on MPT-optimized weights
   */
  allocateCapital(account: Account, optimizedPortfolio: OptimizedPortfolio): Map<string, number> {
    const allocation = new Map<string, number>();
    const availableCapital = account.availableMargin * 0.6; // 60% of available margin

    for (const [symbol, weight] of optimizedPortfolio.weights.entries()) {
      const capitalAllocation = availableCapital * weight;
      allocation.set(symbol, capitalAllocation);
    }

    return allocation;
  }
}

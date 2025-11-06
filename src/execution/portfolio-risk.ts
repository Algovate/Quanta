/**
 * Portfolio-Level Risk Management
 * Advanced risk metrics and portfolio optimization
 */

import type { Account, Position } from '../exchange/types.js';
import { aggregatePositionMetrics } from './position-utils.js';
import { PortfolioCorrelationAnalyzer } from './portfolio-correlation.js';

export interface PortfolioRiskMetrics {
  totalRisk: number; // Total portfolio risk as % of equity
  maxDrawdown: number; // Maximum drawdown percentage
  var95: number; // Value at Risk at 95% confidence
  cvar95: number; // Conditional VaR (Expected Shortfall) at 95% confidence
  correlationScore: number; // Portfolio correlation (0-1, higher is worse)
  diversificationScore: number; // Portfolio diversification (0-1, higher is better)
  effectiveExposure: number; // Correlation-adjusted exposure
  riskConcentration: number; // Risk concentration in largest positions
  stressTestResults: {
    scenario: string;
    expectedLoss: number;
    confidence: number;
  }[];
}

/**
 * Portfolio Risk Manager
 * Calculates portfolio-level risk metrics
 */
export class PortfolioRiskManager {
  private correlationAnalyzer: PortfolioCorrelationAnalyzer;

  constructor() {
    this.correlationAnalyzer = new PortfolioCorrelationAnalyzer();
  }

  /**
   * Calculate comprehensive portfolio risk metrics
   */
  calculatePortfolioRisk(
    account: Account,
    positions: Position[],
    historicalReturns?: Map<string, number[]>
  ): PortfolioRiskMetrics {
    if (positions.length === 0) {
      return {
        totalRisk: 0,
        maxDrawdown: 0,
        var95: 0,
        cvar95: 0,
        correlationScore: 0,
        diversificationScore: 1.0,
        effectiveExposure: 0,
        riskConcentration: 0,
        stressTestResults: [],
      };
    }

    const aggregates = aggregatePositionMetrics(positions);
    const totalRisk = account.equity > 0 ? aggregates.totalMarginUsed / account.equity : 0;

    // Calculate correlation metrics
    const correlation = this.correlationAnalyzer.calculateCorrelation(positions);
    const effectiveExposure = this.correlationAnalyzer.calculateEffectiveExposure(positions);

    // Calculate risk concentration (largest position risk / total risk)
    const positionRisks = positions.map(p => p.size * p.markPrice);
    const maxPositionRisk = positionRisks.length > 0 ? Math.max(...positionRisks) : 0;
    const totalExposure = aggregates.totalUnleveredExposure;
    const riskConcentration = totalExposure > 0 ? maxPositionRisk / totalExposure : 0;

    // Calculate VaR (Value at Risk) - simplified
    const var95 = this.calculateVaR(positions, historicalReturns, 0.95);
    const cvar95 = this.calculateCVaR(positions, historicalReturns, 0.95);

    // Calculate max drawdown (simplified - would use historical data in production)
    const maxDrawdown = this.estimateMaxDrawdown(positions, account);

    // Stress test scenarios
    const stressTestResults = this.runStressTests(account, positions);

    return {
      totalRisk,
      maxDrawdown,
      var95,
      cvar95,
      correlationScore: correlation.averageCorrelation,
      diversificationScore: correlation.diversificationScore,
      effectiveExposure,
      riskConcentration,
      stressTestResults,
    };
  }

  /**
   * Calculate Value at Risk (VaR) at specified confidence level
   */
  private calculateVaR(
    positions: Position[],
    historicalReturns?: Map<string, number[]>,
    _confidence: number = 0.95
  ): number {
    if (!historicalReturns || historicalReturns.size === 0) {
      // Simplified VaR: estimate based on volatility
      const totalExposure = positions.reduce((sum, p) => sum + p.size * p.markPrice, 0);
      // Assume 5% daily volatility
      const dailyVolatility = 0.05;
      const zScore = 1.645; // 95% confidence (1.645 standard deviations)
      return totalExposure * dailyVolatility * zScore;
    }

    // Calculate portfolio returns from historical data
    const portfolioReturns: number[] = [];

    // Simplified: combine returns (would need proper portfolio calculation in production)
    for (const [symbol, returns] of historicalReturns.entries()) {
      const position = positions.find(p => p.symbol === symbol);
      if (position) {
        const weight =
          (position.size * position.markPrice) /
          positions.reduce((sum, p) => sum + p.size * p.markPrice, 0);

        // Weighted returns
        for (let i = 0; i < returns.length; i++) {
          if (!portfolioReturns[i]) {
            portfolioReturns[i] = 0;
          }
          portfolioReturns[i] += returns[i] * weight;
        }
      }
    }

    if (portfolioReturns.length === 0) {
      return 0;
    }

    // Calculate VaR from returns distribution
    const sortedReturns = [...portfolioReturns].sort((a, b) => a - b);
    const varIndex = Math.floor((1 - _confidence) * sortedReturns.length);
    const varValue = sortedReturns[varIndex];

    // Convert to absolute value
    const totalExposure = positions.reduce((sum, p) => sum + p.size * p.markPrice, 0);

    return Math.abs(varValue) * totalExposure;
  }

  /**
   * Calculate Conditional VaR (Expected Shortfall/CVaR)
   */
  private calculateCVaR(
    positions: Position[],
    historicalReturns?: Map<string, number[]>,
    confidence: number = 0.95
  ): number {
    const var95 = this.calculateVaR(positions, historicalReturns, confidence);

    if (!historicalReturns || historicalReturns.size === 0) {
      // Simplified: CVaR is typically 1.2-1.5x VaR
      return var95 * 1.3;
    }

    // Calculate average of losses beyond VaR threshold
    const portfolioReturns: number[] = [];

    for (const [symbol, returns] of historicalReturns.entries()) {
      const position = positions.find(p => p.symbol === symbol);
      if (position) {
        const weight =
          (position.size * position.markPrice) /
          positions.reduce((sum, p) => sum + p.size * p.markPrice, 0);

        for (let i = 0; i < returns.length; i++) {
          if (!portfolioReturns[i]) {
            portfolioReturns[i] = 0;
          }
          portfolioReturns[i] += returns[i] * weight;
        }
      }
    }

    if (portfolioReturns.length === 0) {
      return var95 * 1.3;
    }

    const sortedReturns = [...portfolioReturns].sort((a, b) => a - b);
    const varIndex = Math.floor((1 - confidence) * sortedReturns.length);
    const tailReturns = sortedReturns.slice(0, varIndex);

    if (tailReturns.length === 0) {
      return var95;
    }

    const avgTailLoss = tailReturns.reduce((sum, r) => sum + r, 0) / tailReturns.length;
    const totalExposure = positions.reduce((sum, p) => sum + p.size * p.markPrice, 0);

    return Math.abs(avgTailLoss) * totalExposure;
  }

  /**
   * Estimate maximum drawdown
   */
  private estimateMaxDrawdown(positions: Position[], account: Account): number {
    // Simplified: estimate based on current unrealized PnL
    const totalUnrealizedPnl = positions.reduce((sum, p) => sum + p.unrealizedPnl, 0);

    const peakEquity = account.equity - totalUnrealizedPnl; // Assume peak was when all positions were at entry
    const currentEquity = account.equity;

    if (peakEquity > 0) {
      return ((peakEquity - currentEquity) / peakEquity) * 100;
    }

    return 0;
  }

  /**
   * Run stress tests on portfolio
   */
  private runStressTests(
    _account: Account,
    positions: Position[]
  ): Array<{ scenario: string; expectedLoss: number; confidence: number }> {
    const scenarios = [
      { name: 'Market Crash (-20%)', priceChange: -0.2 },
      { name: 'Market Correction (-10%)', priceChange: -0.1 },
      { name: 'Volatility Spike (+50% volatility)', priceChange: -0.05, volatilityMultiplier: 1.5 },
      { name: 'Correlation Breakdown', priceChange: -0.15, correlationMultiplier: 1.5 },
    ];

    const results = scenarios.map(scenario => {
      // Simplified stress test: calculate expected loss
      const totalExposure = positions.reduce((sum, p) => sum + p.size * p.markPrice, 0);

      // Calculate loss based on scenario
      let expectedLoss = totalExposure * Math.abs(scenario.priceChange);

      // Adjust for volatility if specified
      if (scenario.volatilityMultiplier) {
        expectedLoss *= scenario.volatilityMultiplier;
      }

      // Adjust for correlation if specified
      if (scenario.correlationMultiplier) {
        const correlation = this.correlationAnalyzer.calculateCorrelation(positions);
        expectedLoss *= 1 + correlation.averageCorrelation * (scenario.correlationMultiplier - 1);
      }

      return {
        scenario: scenario.name,
        expectedLoss,
        confidence: 0.8, // High confidence in stress scenarios
      };
    });

    return results;
  }

  /**
   * Calculate dynamic position limits based on portfolio performance
   */
  calculateDynamicPositionLimits(
    account: Account,
    positions: Position[],
    baseMaxPositions: number
  ): number {
    const risk = this.calculatePortfolioRisk(account, positions);

    // Reduce position limit if portfolio risk is high
    if (risk.totalRisk > 0.25) {
      return Math.max(1, Math.floor(baseMaxPositions * 0.7)); // Reduce by 30%
    } else if (risk.totalRisk > 0.2) {
      return Math.max(2, Math.floor(baseMaxPositions * 0.85)); // Reduce by 15%
    }

    // Increase position limit if portfolio is well-diversified and low risk
    if (risk.totalRisk < 0.1 && risk.diversificationScore > 0.7) {
      return Math.min(baseMaxPositions + 1, baseMaxPositions * 1.2); // Increase up to 20%
    }

    return baseMaxPositions;
  }

  /**
   * Allocate risk budget across positions based on opportunity
   */
  allocateRiskBudget(
    _account: Account,
    _positions: Position[],
    opportunities: Array<{ symbol: string; expectedReturn: number; risk: number }>
  ): Map<string, number> {
    // Simple allocation: equal risk budget
    // TODO: Implement Modern Portfolio Theory for optimal allocation

    const riskBudget = _account.equity * 0.3; // 30% of equity as risk budget
    const perOpportunity = riskBudget / opportunities.length;

    const allocation = new Map<string, number>();
    for (const opp of opportunities) {
      allocation.set(opp.symbol, perOpportunity);
    }

    return allocation;
  }
}

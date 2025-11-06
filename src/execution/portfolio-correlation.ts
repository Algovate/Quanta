/**
 * Portfolio Correlation Matrix
 * Tracks and analyzes correlation between positions
 */

import type { Position } from '../exchange/types.js';
import { UnifiedLogger } from '../logging/index.js';

export interface CorrelationPair {
  symbol1: string;
  symbol2: string;
  correlation: number; // -1 to 1
}

export interface PortfolioCorrelation {
  correlationMatrix: Map<string, Map<string, number>>;
  averageCorrelation: number;
  maxCorrelation: number;
  correlationPairs: CorrelationPair[];
  diversificationScore: number; // 0-1, higher is better
}

/**
 * Portfolio Correlation Analyzer
 * Calculates correlation metrics between positions
 */
export class PortfolioCorrelationAnalyzer {
  private logger: UnifiedLogger;
  private readonly context = 'PortfolioCorrelation';

  constructor() {
    this.logger = UnifiedLogger.getInstance();
  }

  /**
   * Calculate portfolio correlation metrics
   */
  calculateCorrelation(positions: Position[]): PortfolioCorrelation {
    if (positions.length === 0) {
      return {
        correlationMatrix: new Map(),
        averageCorrelation: 0,
        maxCorrelation: 0,
        correlationPairs: [],
        diversificationScore: 1.0,
      };
    }

    if (positions.length === 1) {
      return {
        correlationMatrix: new Map(),
        averageCorrelation: 0,
        maxCorrelation: 0,
        correlationPairs: [],
        diversificationScore: 1.0,
      };
    }

    // Build correlation matrix
    const correlationMatrix = new Map<string, Map<string, number>>();
    const correlationPairs: CorrelationPair[] = [];

    // Calculate pairwise correlations
    for (let i = 0; i < positions.length; i++) {
      const pos1 = positions[i];
      const symbol1 = pos1.symbol;

      if (!correlationMatrix.has(symbol1)) {
        correlationMatrix.set(symbol1, new Map());
      }

      // Self-correlation is always 1.0
      const symbol1Map = correlationMatrix.get(symbol1);
      if (symbol1Map) {
        symbol1Map.set(symbol1, 1.0);
      }

      for (let j = i + 1; j < positions.length; j++) {
        const pos2 = positions[j];
        const symbol2 = pos2.symbol;

        if (!correlationMatrix.has(symbol2)) {
          correlationMatrix.set(symbol2, new Map());
        }

        // Calculate correlation based on:
        // 1. Same side (long/long or short/short) = positive correlation
        // 2. Different side = negative correlation
        // 3. Same symbol = perfect correlation (shouldn't happen, but handle it)
        let correlation = 0.0;

        if (symbol1 === symbol2) {
          correlation = 1.0; // Same symbol
        } else {
          // Same side = positive correlation, different side = negative correlation
          const sameSide = pos1.side === pos2.side;
          correlation = sameSide ? 0.7 : -0.3; // Estimate based on side alignment

          // Adjust based on position sizes (larger positions have more impact)
          const size1 = pos1.size * pos1.markPrice;
          const size2 = pos2.size * pos2.markPrice;
          const totalSize = size1 + size2;
          if (totalSize > 0) {
            const weight1 = size1 / totalSize;
            const weight2 = size2 / totalSize;
            // Weighted correlation (simplified)
            correlation = correlation * (weight1 + weight2);
          }
        }

        const symbol1Map = correlationMatrix.get(symbol1);
        const symbol2Map = correlationMatrix.get(symbol2);
        if (symbol1Map && symbol2Map) {
          symbol1Map.set(symbol2, correlation);
          symbol2Map.set(symbol1, correlation);
        }

        correlationPairs.push({
          symbol1,
          symbol2,
          correlation,
        });
      }
    }

    // Calculate average and max correlation
    const allCorrelations = correlationPairs.map(p => Math.abs(p.correlation));
    const averageCorrelation =
      allCorrelations.length > 0
        ? allCorrelations.reduce((sum, c) => sum + c, 0) / allCorrelations.length
        : 0;

    const maxCorrelation = allCorrelations.length > 0 ? Math.max(...allCorrelations) : 0;

    // Calculate diversification score
    // Lower average correlation and more positions = better diversification
    const uniqueSymbols = new Set(positions.map(p => p.symbol)).size;
    const positionCount = positions.length;
    const symbolDiversity = uniqueSymbols / positionCount;
    const correlationDiversity = 1.0 - averageCorrelation;
    const diversificationScore = symbolDiversity * 0.5 + correlationDiversity * 0.5;

    return {
      correlationMatrix,
      averageCorrelation,
      maxCorrelation,
      correlationPairs,
      diversificationScore: Math.max(0, Math.min(1, diversificationScore)),
    };
  }

  /**
   * Check if adding a new position would create excessive correlation
   */
  canAddPosition(
    existingPositions: Position[],
    newSymbol: string,
    newSide: 'long' | 'short',
    maxCorrelation: number = 0.8
  ): boolean {
    if (existingPositions.length === 0) {
      return true;
    }

    // Check correlation with existing positions
    const correlations: number[] = [];

    for (const pos of existingPositions) {
      let correlation = 0.0;

      if (pos.symbol === newSymbol) {
        correlation = 1.0; // Same symbol = perfect correlation
      } else {
        const sameSide = pos.side === newSide;
        correlation = sameSide ? 0.7 : -0.3;
      }

      correlations.push(Math.abs(correlation));
    }

    // Check if any correlation exceeds threshold
    const maxExistingCorrelation = correlations.length > 0 ? Math.max(...correlations) : 0;

    if (maxExistingCorrelation > maxCorrelation) {
      this.logger.debug(
        'Position rejected due to high correlation',
        {
          newSymbol,
          newSide,
          maxCorrelation: maxExistingCorrelation.toFixed(2),
          threshold: maxCorrelation,
        },
        this.context
      );
      return false;
    }

    return true;
  }

  /**
   * Calculate effective portfolio exposure considering correlations
   */
  calculateEffectiveExposure(positions: Position[]): number {
    if (positions.length === 0) {
      return 0;
    }

    const correlation = this.calculateCorrelation(positions);

    // Effective exposure = sum of positions adjusted by correlation
    // Highly correlated positions contribute less to diversification
    const totalExposure = positions.reduce((sum, pos) => sum + pos.size * pos.markPrice, 0);

    // Adjust by average correlation (higher correlation = less diversification benefit)
    const effectiveExposure = totalExposure * (1.0 - correlation.averageCorrelation * 0.5);

    return effectiveExposure;
  }
}

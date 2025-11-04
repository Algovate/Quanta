/**
 * Correlation Analyzer - Analyze signal and performance correlation between drones
 */

import type { DroneMetrics } from '../types.js';

export interface CorrelationPair {
  droneA: string;
  droneB: string;
  correlation: number; // -1 to 1
  signalOverlap?: number; // Percentage of signals that overlap in time
}

export class CorrelationAnalyzer {
  /**
   * Calculate performance correlation between drones
   * Uses Pearson correlation coefficient on equity snapshots
   */
  calculateEquityCorrelation(
    snapshotA: Array<{ timestamp: number; equity: number }>,
    snapshotB: Array<{ timestamp: number; equity: number }>
  ): number {
    if (snapshotA.length < 2 || snapshotB.length < 2) return 0;

    // Align snapshots by timestamp
    const aligned: Array<{ a: number; b: number }> = [];
    let idxA = 0;
    let idxB = 0;

    while (idxA < snapshotA.length && idxB < snapshotB.length) {
      const timeA = snapshotA[idxA].timestamp;
      const timeB = snapshotB[idxB].timestamp;

      if (Math.abs(timeA - timeB) < 1000) {
        // Same time (within 1 second)
        aligned.push({
          a: snapshotA[idxA].equity,
          b: snapshotB[idxB].equity,
        });
        idxA++;
        idxB++;
      } else if (timeA < timeB) {
        idxA++;
      } else {
        idxB++;
      }
    }

    if (aligned.length < 2) return 0;

    // Calculate Pearson correlation
    const valuesA = aligned.map(p => p.a);
    const valuesB = aligned.map(p => p.b);

    const meanA = valuesA.reduce((s, v) => s + v, 0) / valuesA.length;
    const meanB = valuesB.reduce((s, v) => s + v, 0) / valuesB.length;

    let covariance = 0;
    let varianceA = 0;
    let varianceB = 0;

    for (let i = 0; i < aligned.length; i++) {
      const diffA = valuesA[i] - meanA;
      const diffB = valuesB[i] - meanB;
      covariance += diffA * diffB;
      varianceA += diffA * diffA;
      varianceB += diffB * diffB;
    }

    if (varianceA === 0 || varianceB === 0) return 0;

    return covariance / Math.sqrt(varianceA * varianceB);
  }

  /**
   * Calculate all pairwise correlations
   */
  calculateAllCorrelations(drones: DroneMetrics[]): CorrelationPair[] {
    const pairs: CorrelationPair[] = [];

    for (let i = 0; i < drones.length; i++) {
      for (let j = i + 1; j < drones.length; j++) {
        const droneA = drones[i];
        const droneB = drones[j];

        // For now, use a simplified correlation based on performance trends
        // In full implementation, would use actual equity snapshots
        const correlation = this.estimateCorrelation();

        pairs.push({
          droneA: droneA.droneId,
          droneB: droneB.droneId,
          correlation,
        });
      }
    }

    return pairs;
  }

  /**
   * Estimate correlation based on metrics
   * This is a simplified approach - full implementation would use equity curves
   */
  private estimateCorrelation(): number {
    // Similar strategies (same prompt pack, risk params) = higher correlation
    // Different strategies = lower correlation

    // For now, return a neutral correlation
    // This would be replaced with actual equity snapshot comparison
    return 0.3; // Placeholder
  }

  /**
   * Identify diversification opportunities
   * Low correlation means good diversification
   */
  findDiversificationPairs(correlations: CorrelationPair[]): CorrelationPair[] {
    return correlations.filter(pair => pair.correlation < 0.3);
  }

  /**
   * Group highly correlated drones
   */
  groupCorrelatedDrones(correlations: CorrelationPair[], threshold: number = 0.7): Array<string[]> {
    const groups: Array<string[]> = [];
    const processed = new Set<string>();

    for (const pair of correlations) {
      if (pair.correlation >= threshold) {
        // Find or create group
        let group = groups.find(g => g.includes(pair.droneA) || g.includes(pair.droneB));

        if (!group) {
          group = [];
          groups.push(group);
        }

        if (!group.includes(pair.droneA)) group.push(pair.droneA);
        if (!group.includes(pair.droneB)) group.push(pair.droneB);

        processed.add(pair.droneA);
        processed.add(pair.droneB);
      }
    }

    return groups;
  }
}

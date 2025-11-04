/**
 * Performance Comparator - Compare performance metrics across drones
 */

import type { DroneMetrics, DroneComparison } from '../types.js';

export class PerformanceComparator {
  /**
   * Compare performance metrics across drones and rank them
   */
  compareDrones(drones: DroneMetrics[]): DroneComparison[] {
    if (drones.length === 0) return [];

    // Calculate relative performance to best, median, and worst
    const totalReturns = drones.map(d => d.totalReturn);
    const bestReturn = Math.max(...totalReturns);
    const worstReturn = Math.min(...totalReturns);
    const sortedReturns = [...totalReturns].sort((a, b) => b - a);
    const medianReturn =
      sortedReturns.length % 2 === 0
        ? (sortedReturns[sortedReturns.length / 2 - 1] + sortedReturns[sortedReturns.length / 2]) /
          2
        : sortedReturns[Math.floor(sortedReturns.length / 2)];

    // Rank drones by total return
    const ranked = drones
      .map((drone, index) => ({
        drone,
        index,
        totalReturn: drone.totalReturn,
      }))
      .sort((a, b) => b.totalReturn - a.totalReturn)
      .map((item, rank) => ({
        droneId: item.drone.droneId,
        name: item.drone.name,
        ranking: rank + 1,
        metrics: item.drone,
        relativePerformance: {
          vsBest: bestReturn !== 0 ? (item.totalReturn / bestReturn) * 100 : 0,
          vsMedian: medianReturn !== 0 ? (item.totalReturn / medianReturn) * 100 : 0,
          vsWorst: worstReturn !== 0 ? (item.totalReturn / worstReturn) * 100 : 0,
        },
      }));

    return ranked;
  }

  /**
   * Calculate performance differential matrix
   * Returns percentage difference between each pair of drones
   */
  calculateDifferentialMatrix(drones: DroneMetrics[]): Map<string, Map<string, number>> {
    const matrix = new Map<string, Map<string, number>>();

    for (const droneA of drones) {
      const row = new Map<string, number>();
      for (const droneB of drones) {
        if (droneA.droneId === droneB.droneId) {
          row.set(droneB.droneId, 0);
        } else {
          const diff = droneA.totalReturn - droneB.totalReturn;
          const pctDiff = (diff / Math.abs(droneB.totalReturn)) * 100 || 0;
          row.set(droneB.droneId, pctDiff);
        }
      }
      matrix.set(droneA.droneId, row);
    }

    return matrix;
  }

  /**
   * Identify winner (best performer)
   */
  getWinner(drones: DroneMetrics[]): DroneMetrics | null {
    if (drones.length === 0) return null;

    return drones.reduce((best, current) => {
      // Primary metric: total return
      if (current.totalReturn > best.totalReturn) return current;

      // Tie-breaker: Sharpe ratio
      if (current.totalReturn === best.totalReturn) {
        if (current.sharpeRatio > best.sharpeRatio) return current;
      }

      return best;
    });
  }

  /**
   * Get performance distribution statistics
   */
  getPerformanceStats(drones: DroneMetrics[]): {
    mean: number;
    median: number;
    min: number;
    max: number;
    stdDev: number;
  } {
    if (drones.length === 0) {
      return { mean: 0, median: 0, min: 0, max: 0, stdDev: 0 };
    }

    const returns = drones.map(d => d.totalReturn);
    const mean = returns.reduce((s, r) => s + r, 0) / returns.length;
    const variance = returns.reduce((s, r) => s + Math.pow(r - mean, 2), 0) / returns.length;
    const stdDev = Math.sqrt(variance);

    const sorted = [...returns].sort((a, b) => a - b);
    const median =
      sorted.length % 2 === 0
        ? (sorted[sorted.length / 2 - 1] + sorted[sorted.length / 2]) / 2
        : sorted[Math.floor(sorted.length / 2)];

    return {
      mean,
      median,
      min: sorted[0],
      max: sorted[sorted.length - 1],
      stdDev,
    };
  }
}

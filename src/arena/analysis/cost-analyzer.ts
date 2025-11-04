/**
 * Cost Analyzer - AI cost analysis across drones
 */

import type { DroneMetrics } from '../types.js';

export interface CostEfficiency {
  droneId: string;
  name: string;
  totalCost: number;
  totalPnL: number;
  costPerPnL: number; // Cost per dollar of PnL (lower is better)
  costPerTrade: number;
  costPerSignal: number;
  roi: number; // Return on investment (PnL / Cost)
}

export class CostAnalyzer {
  /**
   * Analyze cost efficiency across drones
   */
  analyzeCosts(drones: DroneMetrics[]): CostEfficiency[] {
    return drones.map(drone => {
      const costPerPnL = drone.pnl !== 0 ? Math.abs(drone.aiCost / drone.pnl) : Infinity;
      const costPerTrade = drone.totalTrades > 0 ? drone.aiCost / drone.totalTrades : 0;
      const costPerSignal = drone.totalSignals > 0 ? drone.aiCost / drone.totalSignals : 0;
      const roi = drone.aiCost > 0 ? (drone.pnl / drone.aiCost) * 100 : 0;

      return {
        droneId: drone.droneId,
        name: drone.name,
        totalCost: drone.aiCost,
        totalPnL: drone.pnl,
        costPerPnL,
        costPerTrade,
        costPerSignal,
        roi,
      };
    });
  }

  /**
   * Get most expensive drone
   */
  getMostExpensive(drones: DroneMetrics[]): DroneMetrics | null {
    if (drones.length === 0) return null;

    return drones.reduce((most, current) => (current.aiCost > most.aiCost ? current : most));
  }

  /**
   * Get most cost-efficient drone (best PnL/cost ratio)
   */
  getMostEfficient(drones: DroneMetrics[]): CostEfficiency | null {
    const efficiencies = this.analyzeCosts(drones);
    if (efficiencies.length === 0) return null;

    return efficiencies.reduce((best, current) => {
      // Prioritize positive PnL
      if (current.totalPnL <= 0 && best.totalPnL > 0) return best;
      if (current.totalPnL > 0 && best.totalPnL <= 0) return current;

      // Among positive PnL, pick highest ROI
      if (current.totalPnL > 0 && best.totalPnL > 0) {
        return current.roi > best.roi ? current : best;
      }

      // Both negative: lowest cost per trade
      return current.costPerTrade < best.costPerTrade ? current : best;
    });
  }

  /**
   * Get total cost across all drones
   */
  getTotalCost(drones: DroneMetrics[]): number {
    return drones.reduce((sum, drone) => sum + drone.aiCost, 0);
  }

  /**
   * Get average cost per drone
   */
  getAverageCost(drones: DroneMetrics[]): number {
    if (drones.length === 0) return 0;
    return this.getTotalCost(drones) / drones.length;
  }
}

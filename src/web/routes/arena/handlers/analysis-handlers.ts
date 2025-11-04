import { Request, Response } from 'express';
import { sendErrorResponse } from '../../../utils/error-handler.js';
import { ArenaService } from '../arena-service.js';
import { PerformanceComparator } from '../../../../arena/analysis/performance-comparator.js';
import { CostAnalyzer } from '../../../../arena/analysis/cost-analyzer.js';
import { CorrelationAnalyzer } from '../../../../arena/analysis/correlation-analyzer.js';

/**
 * Get comprehensive comparison
 */
export function createGetComparisonHandler(arenaService: ArenaService) {
  return async (req: Request, res: Response): Promise<void> => {
    try {
      const { arenaId } = req.params;
      const arena = arenaService.getArena(arenaId);

      const drones = arena.getAllDrones();
      const metrics = drones.map(d => d.getMetrics());

      // Performance comparison
      const performanceComparator = new PerformanceComparator();
      const comparisons = performanceComparator.compareDrones(metrics);
      const winner = performanceComparator.getWinner(metrics);
      const performanceStats = performanceComparator.getPerformanceStats(metrics);

      // Cost analysis
      const costAnalyzer = new CostAnalyzer();
      const costs = costAnalyzer.analyzeCosts(metrics);
      const mostEfficient = costAnalyzer.getMostEfficient(metrics);

      // Correlation analysis
      const correlationAnalyzer = new CorrelationAnalyzer();
      const correlations = correlationAnalyzer.calculateAllCorrelations(metrics);

      res.json({
        arenaId,
        performance: {
          comparisons,
          winner: winner
            ? {
                droneId: winner.droneId,
                name: winner.name,
                metrics: winner,
              }
            : null,
          stats: performanceStats,
        },
        costs: {
          totalCost: costAnalyzer.getTotalCost(metrics),
          averageCost: costAnalyzer.getAverageCost(metrics),
          mostEfficient: mostEfficient,
          allCosts: costs,
        },
        correlations: {
          pairs: correlations,
          diversification: correlationAnalyzer.findDiversificationPairs(correlations),
        },
      });
    } catch (error) {
      if (error instanceof Error && error.message.includes('not found')) {
        res.status(404).json({ error: error.message });
      } else {
        sendErrorResponse(res, error, 'Failed to get comparison', 500);
      }
    }
  };
}

/**
 * Get AI analysis
 */
export function createGetAIAnalysisHandler(arenaService: ArenaService) {
  return async (req: Request, res: Response): Promise<void> => {
    try {
      const { arenaId } = req.params;
      const arena = arenaService.getArena(arenaId);

      const drones = arena.getAllDrones();
      const metrics = drones.map(d => d.getMetrics());

      // Group by prompt pack
      const byPromptPack = new Map<string, typeof metrics>();
      for (const metric of metrics) {
        const config = drones.find(d => d.getId() === metric.droneId)?.getConfig();
        const pack = config?.promptPack || 'unknown';

        if (!byPromptPack.has(pack)) {
          byPromptPack.set(pack, []);
        }
        byPromptPack.get(pack)!.push(metric);
      }

      // Calculate effectiveness
      const packEffectiveness = Array.from(byPromptPack.entries()).map(([pack, packMetrics]) => {
        const avgReturn = packMetrics.reduce((s, m) => s + m.totalReturn, 0) / packMetrics.length;
        const avgSharpe = packMetrics.reduce((s, m) => s + m.sharpeRatio, 0) / packMetrics.length;
        const avgWinRate = packMetrics.reduce((s, m) => s + m.winRate, 0) / packMetrics.length;
        const totalCost = packMetrics.reduce((s, m) => s + m.aiCost, 0);
        const totalTokens = packMetrics.reduce((s, m) => s + m.aiTokens, 0);
        const totalCalls = packMetrics.reduce((s, m) => s + m.aiCallCount, 0);

        return {
          promptPack: pack,
          drones: packMetrics.length,
          avgReturn,
          avgSharpe,
          avgWinRate,
          totalCost,
          totalTokens,
          totalCalls,
          costPerToken: totalTokens > 0 ? totalCost / totalTokens : 0,
          avgTokensPerCall: totalCalls > 0 ? totalTokens / totalCalls : 0,
        };
      });

      // Sort by effectiveness (weighted score)
      packEffectiveness.sort((a, b) => {
        const scoreA = a.avgReturn * 0.5 + a.avgSharpe * 0.3 + a.avgWinRate * 0.2;
        const scoreB = b.avgReturn * 0.5 + b.avgSharpe * 0.3 + b.avgWinRate * 0.2;
        return scoreB - scoreA;
      });

      res.json({
        arenaId,
        promptEffectiveness: packEffectiveness,
        summary: {
          totalPacks: packEffectiveness.length,
          bestPerforming: packEffectiveness[0]?.promptPack,
          mostExpensive: packEffectiveness.reduce(
            (max, pack) => (pack.totalCost > max.totalCost ? pack : max),
            packEffectiveness[0]!
          ).promptPack,
        },
      });
    } catch (error) {
      if (error instanceof Error && error.message.includes('not found')) {
        res.status(404).json({ error: error.message });
      } else {
        sendErrorResponse(res, error, 'Failed to get AI analysis', 500);
      }
    }
  };
}

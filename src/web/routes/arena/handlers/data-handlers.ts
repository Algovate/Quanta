import { Request, Response } from 'express';
import { sendErrorResponse } from '../../../utils/error-handler.js';
import { ArenaService } from '../arena-service.js';
import { parseLimit } from '../utils.js';

/**
 * Get arena trades (completed trades history)
 */
export function createGetTradesHandler(arenaService: ArenaService) {
  return async (req: Request, res: Response): Promise<void> => {
    try {
      const { arenaId } = req.params;
      const limit = parseLimit(req.query.limit, 100, 1, 1000);

      const arena = arenaService.getArena(arenaId);
      const trades = arenaService.collectTradesFromDrones(arena, limit);

      res.json({
        success: true,
        arenaId,
        trades,
        count: trades.length,
      });
    } catch (error) {
      if (error instanceof Error && error.message.includes('not found')) {
        res.status(404).json({ error: error.message });
      } else {
        sendErrorResponse(res, error, 'Failed to get arena trades', 500);
      }
    }
  };
}

/**
 * Get arena positions (all open positions across all drones)
 */
export function createGetPositionsHandler(arenaService: ArenaService) {
  return async (req: Request, res: Response): Promise<void> => {
    try {
      const { arenaId } = req.params;

      const arena = arenaService.getArena(arenaId);
      const dronePositions = await arenaService.collectPositionsFromDrones(arena);

      res.json({
        success: true,
        arenaId,
        drones: dronePositions,
        count: dronePositions.reduce((sum, d) => sum + d.positions.length, 0),
      });
    } catch (error) {
      if (error instanceof Error && error.message.includes('not found')) {
        res.status(404).json({ 
          success: false,
          error: error.message 
        });
        return;
      } else {
        sendErrorResponse(res, error, 'Failed to get arena positions', 500);
      }
    }
  };
}

/**
 * Get arena performance history (equity snapshots over time)
 */
export function createGetPerformanceHistoryHandler(arenaService: ArenaService) {
  return async (req: Request, res: Response): Promise<void> => {
    try {
      const { arenaId } = req.params;
      const timeRange = req.query.timeRange as string | undefined;

      const arena = arenaService.getArena(arenaId);
      const snapshots = arenaService.collectPerformanceHistory(arena, timeRange);

      res.json({
        success: true,
        arenaId,
        snapshots,
        count: snapshots.length,
      });
    } catch (error) {
      if (error instanceof Error && error.message.includes('not found')) {
        res.status(404).json({ error: error.message });
      } else {
        sendErrorResponse(res, error, 'Failed to get performance history', 500);
      }
    }
  };
}

/**
 * Get ticker prices for arena symbols
 */
export function createGetTickerPricesHandler(arenaService: ArenaService) {
  return async (req: Request, res: Response): Promise<void> => {
    try {
      const { arenaId } = req.params;

      const arena = arenaService.getArena(arenaId);
      const tickerPrices = await arenaService.collectTickerPrices(arena);

      res.json({
        success: true,
        arenaId,
        prices: tickerPrices,
        count: Object.keys(tickerPrices).length,
      });
    } catch (error) {
      if (error instanceof Error && error.message.includes('not found')) {
        res.status(404).json({ error: error.message });
      } else {
        sendErrorResponse(res, error, 'Failed to get ticker prices', 500);
      }
    }
  };
}

import { Request, Response } from 'express';
import { sendErrorResponse } from '../../../utils/error-handler.js';
import { ArenaService } from '../arena-service.js';
import { parseLimit } from '../utils.js';

/**
 * Get arena config info (for README tab)
 */
export function createGetConfigInfoHandler(arenaService: ArenaService) {
  return async (req: Request, res: Response): Promise<void> => {
    try {
      const { arenaId } = req.params;
      const arena = arenaService.getArena(arenaId);

      const state = arena.getState();
      const drones = arena.getAllDrones();
      const config = arena.getConfig();

      const droneInfo = drones.map(drone => {
        const droneConfig = drone.getConfig();
        return {
          id: droneConfig.id,
          name: droneConfig.name,
          promptPack: droneConfig.promptPack,
          coins: droneConfig.coins,
        };
      });

      res.json({
        arenaId: state.arenaId,
        name: config.name || arenaId,
        mode: config.mode || 'paper',
        startTime: state.startTime,
        droneCount: state.droneCount,
        drones: droneInfo,
      });
    } catch (error) {
      if (error instanceof Error && error.message.includes('not found')) {
        res.status(404).json({ error: error.message });
      } else {
        sendErrorResponse(res, error, 'Failed to get arena config info', 500);
      }
    }
  };
}

/**
 * Get arena events
 */
export function createGetEventsHandler(arenaService: ArenaService) {
  return async (req: Request, res: Response): Promise<void> => {
    try {
      const { arenaId } = req.params;
      const limit = parseLimit(req.query.limit, 100, 1, 1000);

      const arena = arenaService.getArena(arenaId);
      const events = arena.getEvents(limit);

      res.json({
        success: true,
        events,
        count: events.length,
      });
    } catch (error) {
      if (error instanceof Error && error.message.includes('not found')) {
        res.status(404).json({ error: error.message });
      } else {
        sendErrorResponse(res, error, 'Failed to get arena events', 500);
      }
    }
  };
}

/**
 * Get AI commentary (reasoning, signals, execution insights)
 */
export function createGetAICommentaryHandler(arenaService: ArenaService) {
  return async (req: Request, res: Response): Promise<void> => {
    try {
      const { arenaId } = req.params;
      const limit = parseLimit(req.query.limit, 50, 1, 500);

      const arena = arenaService.getArena(arenaId);
      const commentary = arenaService.collectAICommentary(arena, limit);

      res.json({
        success: true,
        arenaId,
        commentary,
        count: commentary.length,
      });
    } catch (error) {
      if (error instanceof Error && error.message.includes('not found')) {
        res.status(404).json({ error: error.message });
      } else {
        sendErrorResponse(res, error, 'Failed to get AI commentary', 500);
      }
    }
  };
}

/**
 * Get arena status
 */
export function createGetStatusHandler(arenaService: ArenaService) {
  return async (req: Request, res: Response): Promise<void> => {
    try {
      const { arenaId } = req.params;
      const arena = arenaService.getArena(arenaId);

      const state = arena.getState();
      const drones = arena.getAllDrones();

      res.json({
        success: true,
        arenaId: state.arenaId,
        status: state.status,
        startTime: state.startTime,
        droneCount: state.droneCount,
        drones: drones.map(d => {
          const metrics = d.getMetrics();
          return {
            droneId: metrics.droneId,
            name: metrics.name,
            cycleCount: metrics.cycleCount || 0,
            equity: metrics.equity || 0,
            pnl: metrics.pnl || 0,
            pnlPercent: metrics.pnlPercent || 0,
            totalSignals: metrics.totalSignals || 0,
            totalTrades: metrics.totalTrades || 0,
            winRate: metrics.winRate || 0,
            sharpeRatio: metrics.sharpeRatio || 0,
            maxDrawdown: metrics.maxDrawdown || 0,
            aiCost: metrics.aiCost || 0,
            lastUpdate: metrics.lastUpdate || Date.now(),
          };
        }),
      });
    } catch (error) {
      if (error instanceof Error && error.message.includes('not found')) {
        res.status(404).json({ error: error.message });
      } else {
        sendErrorResponse(res, error, 'Failed to get arena status', 500);
      }
    }
  };
}

/**
 * List all arenas
 */
export function createListArenasHandler(arenaService: ArenaService) {
  return async (_req: Request, res: Response): Promise<void> => {
    try {
      const arenas = await arenaService.arenaManager.listArenas();
      res.json({
        success: true,
        arenas,
      });
    } catch (error) {
      sendErrorResponse(res, error, 'Failed to list arenas', 500);
    }
  };
}

/**
 * List only running arenas
 */
export function createListRunningArenasHandler(arenaService: ArenaService) {
  return async (_req: Request, res: Response): Promise<void> => {
    try {
      const arenas = await arenaService.arenaManager.listArenas();
      const running = (arenas || []).filter(a => a.status === 'running');
      res.json({ success: true, arenas: running });
    } catch (error) {
      sendErrorResponse(res, error, 'Failed to list running arenas', 500);
    }
  };
}

/**
 * List history (non-running) arenas
 */
export function createListHistoryArenasHandler(arenaService: ArenaService) {
  return async (_req: Request, res: Response): Promise<void> => {
    try {
      const arenas = await arenaService.arenaManager.listArenas();
      const history = (arenas || []).filter(a => a.status !== 'running');
      res.json({ success: true, arenas: history });
    } catch (error) {
      sendErrorResponse(res, error, 'Failed to list historical arenas', 500);
    }
  };
}

/**
 * Get detailed drone list for an arena
 */
export function createGetDronesHandler(arenaService: ArenaService) {
  return async (req: Request, res: Response): Promise<void> => {
    try {
      const { arenaId } = req.params;
      const arena = arenaService.getArena(arenaId);
      const drones = arena.getAllDrones();

      const droneDetails = drones.map(drone => {
        const metrics = drone.getMetrics();
        const config = drone.getConfig();
        return {
          id: metrics.droneId,
          name: metrics.name,
          config: {
            promptPack: config.promptPack,
            coins: config.coins,
            initialBalance: config.initialBalance,
            riskParams: config.riskParams,
          },
          metrics: {
            cycleCount: metrics.cycleCount || 0,
            equity: metrics.equity || 0,
            pnl: metrics.pnl || 0,
            pnlPercent: metrics.pnlPercent || 0,
            totalSignals: metrics.totalSignals || 0,
            totalTrades: metrics.totalTrades || 0,
            winRate: metrics.winRate || 0,
            sharpeRatio: metrics.sharpeRatio || 0,
            maxDrawdown: metrics.maxDrawdown || 0,
            aiCost: metrics.aiCost || 0,
            lastUpdate: metrics.lastUpdate || Date.now(),
          },
        };
      });

      res.json({
        success: true,
        arenaId,
        drones: droneDetails,
      });
    } catch (error) {
      if (error instanceof Error && error.message.includes('not found')) {
        res.status(404).json({ error: error.message });
      } else {
        sendErrorResponse(res, error, 'Failed to get drones', 500);
      }
    }
  };
}

import { Request, Response } from 'express';
import { sendErrorResponse } from '../../../utils/error-handler.js';
import { ArenaService } from '../arena-service.js';
import { ArenaConfigSchema } from '../types.js';
import { getConfig } from '../../../../config/settings.js';
import type { ArenaConfig } from '../../../../arena/types.js';

/**
 * Start a new arena
 */
export function createStartArenaHandler(arenaService: ArenaService) {
  return async (req: Request, res: Response): Promise<void> => {
    try {
      // Validate request body
      const parseResult = ArenaConfigSchema.safeParse(req.body);
      if (!parseResult.success) {
        // Check if error is due to backtest mode
        const hasBacktestMode = req.body.mode === 'backtest';
        if (hasBacktestMode) {
          res.status(400).json({
            error:
              'Arena only supports "paper" mode. Use standalone backtest command for historical data testing.',
          });
          return;
        }

        res.status(400).json({
          error: 'Invalid arena configuration',
          details: parseResult.error.errors,
        });
        return;
      }

      const config = parseResult.data as ArenaConfig;

      // Additional validation: ensure mode is paper (should be caught by schema, but extra safety)
      if (config.mode !== 'paper') {
        res.status(400).json({
          error:
            'Arena only supports "paper" mode. Use standalone backtest command for historical data testing.',
        });
        return;
      }

      // Get API key
      const globalConfig = getConfig();
      const apiKey = process.env.OPENROUTER_API_KEY || globalConfig.ai.apiKey;

      if (!apiKey) {
        res.status(400).json({
          error: 'API key required. Set OPENROUTER_API_KEY or configure in config.json',
        });
        return;
      }

      // Start arena
      const arenaId = await arenaService.startArena(config, apiKey);

      res.status(201).json({
        success: true,
        arenaId,
        drones: config.drones.map(d => ({
          id: d.id,
          name: d.name,
          status: 'running',
        })),
      });
    } catch (error) {
      // Return 409 Conflict for concurrent arena attempts
      if (error instanceof Error && error.message.includes('Another arena is already running')) {
        res.status(409).json({
          error: 'Another arena is already running',
          message: error.message,
        });
        return;
      }

      sendErrorResponse(res, error, 'Failed to start arena', 500);
    }
  };
}

/**
 * Stop an arena
 */
export function createStopArenaHandler(arenaService: ArenaService) {
  return async (req: Request, res: Response): Promise<void> => {
    try {
      const { arenaId } = req.params;
      await arenaService.stopArena(arenaId);

      res.json({
        success: true,
        arenaId,
        message: 'Arena stopped successfully',
      });
    } catch (error) {
      sendErrorResponse(res, error, 'Failed to stop arena', 500);
    }
  };
}

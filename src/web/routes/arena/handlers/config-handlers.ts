import { Request, Response } from 'express';
import { sendErrorResponse } from '../../../utils/error-handler.js';
import { ArenaService } from '../arena-service.js';

/**
 * List available arena configs
 */
export function createListConfigsHandler(arenaService: ArenaService) {
  return async (_req: Request, res: Response): Promise<void> => {
    try {
      const configs = arenaService.listArenaConfigs();

      res.json({
        success: true,
        configs,
      });
    } catch (error) {
      sendErrorResponse(res, error, 'Failed to list arena configs', 500);
    }
  };
}

/**
 * Get a specific arena config by name
 */
export function createGetConfigHandler(arenaService: ArenaService) {
  return async (req: Request, res: Response): Promise<void> => {
    try {
      const { configName } = req.params;
      const config = arenaService.getArenaConfig(configName);

      res.json({
        success: true,
        config,
      });
    } catch (error) {
      if (error instanceof Error && error.message.includes('not found')) {
        res.status(404).json({
          error: 'Config not found',
          configName: req.params.configName,
        });
      } else {
        sendErrorResponse(res, error, 'Failed to load arena config', 500);
      }
    }
  };
}

import { Router, Request, Response } from 'express';
import { startTradingService } from '../api-service.js';
import { sendErrorResponse } from '../utils/error-handler.js';
import type { TradingManager } from '../trading-manager.js';

/**
 * Register system-related routes (status, start, stop, pause)
 */
export function registerSystemRoutes(router: Router, tradingManager: TradingManager): void {
  // Get system status
  router.get('/api/status', async (_req: Request, res: Response) => {
    try {
      const state = tradingManager.getState();
      const workflow = tradingManager.getWorkflow();

      let account = null;
      let positions: { symbol: string; side: 'long' | 'short'; size: number }[] = [];

      if (workflow) {
        const exchange = workflow.getExchange();
        account = await exchange.getAccount();
        positions = await exchange.getPositions();
      }

      res.json({
        state,
        account,
        positions,
      });
    } catch (error) {
      sendErrorResponse(res, error, 'Failed to get status', 500);
    }
  });

  // Start trading
  router.post('/api/trade/start', async (req: Request, res: Response) => {
    try {
      const { coins } = req.body;
      await startTradingService(tradingManager, coins);

      res.json({ success: true, message: 'Trading started' });
    } catch (error) {
      sendErrorResponse(res, error, 'Failed to start trading', 500);
    }
  });

  // Stop trading
  router.post('/api/trade/stop', async (_req: Request, res: Response) => {
    try {
      await tradingManager.stop();
      res.json({ success: true, message: 'Trading stopped' });
    } catch (error) {
      sendErrorResponse(res, error, 'Failed to stop trading', 500);
    }
  });

  // Pause trading
  router.post('/api/trade/pause', async (_req: Request, res: Response) => {
    try {
      await tradingManager.pause();
      res.json({ success: true, message: 'Trading paused' });
    } catch (error) {
      sendErrorResponse(res, error, 'Failed to pause trading', 500);
    }
  });
}

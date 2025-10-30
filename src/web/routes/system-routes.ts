import { Router, Request, Response } from 'express';
import { Logger } from '../../utils/logger.js';
import { startTradingService } from '../api-service.js';

const logger = Logger.getInstance('SystemRoutes');

/**
 * Register system-related routes (status, start, stop, pause)
 */
export function registerSystemRoutes(router: Router, tradingManager: any): void {
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
      logger.error('Error getting status', error);
      res.status(500).json({ error: 'Failed to get status' });
    }
  });

  // Start trading
  router.post('/api/trade/start', async (req: Request, res: Response) => {
    try {
      const { coins } = req.body;
      await startTradingService(tradingManager, coins);

      res.json({ success: true, message: 'Trading started' });
    } catch (error) {
      logger.error('Error starting trade', error);
      res.status(500).json({ error: 'Failed to start trading' });
    }
  });

  // Stop trading
  router.post('/api/trade/stop', async (_req: Request, res: Response) => {
    try {
      await tradingManager.stop();
      res.json({ success: true, message: 'Trading stopped' });
    } catch (error) {
      logger.error('Error stopping trade', error);
      res.status(500).json({ error: 'Failed to stop trading' });
    }
  });

  // Pause trading
  router.post('/api/trade/pause', async (_req: Request, res: Response) => {
    try {
      await tradingManager.pause();
      res.json({ success: true, message: 'Trading paused' });
    } catch (error) {
      logger.error('Error pausing trade', error);
      res.status(500).json({ error: 'Failed to pause trading' });
    }
  });
}

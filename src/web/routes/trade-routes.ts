import { Router, Request, Response } from 'express';
import { Logger } from '../../utils/logger.js';
import {
  getPositionsService,
  getAccountService,
  closePositionService,
  placeOrderService,
} from '../api-service.js';

const logger = Logger.getInstance('TradeRoutes');

/**
 * Register trade-related routes
 */
export function registerTradeRoutes(router: Router, tradingManager: any): void {
  // Get positions
  router.get('/api/positions', async (_req: Request, res: Response) => {
    try {
      const workflow = tradingManager.getWorkflow();
      if (!workflow) {
        return res.json([]);
      }

      const positions = await getPositionsService(tradingManager);
      res.json(positions);
    } catch (error) {
      logger.error('Error getting positions', error);
      res.status(500).json({ error: 'Failed to get positions' });
    }
  });

  // Get account
  router.get('/api/account', async (_req: Request, res: Response) => {
    try {
      const workflow = tradingManager.getWorkflow();
      if (!workflow) {
        return res.json(null);
      }

      const account = await getAccountService(tradingManager);
      res.json(account);
    } catch (error) {
      logger.error('Error getting account', error);
      res.status(500).json({ error: 'Failed to get account' });
    }
  });

  // Close position (by symbol and side)
  router.post('/api/position/close', async (req: Request, res: Response) => {
    try {
      const { symbol, side } = req.body || {};
      if (!symbol || !side) {
        return res.status(400).json({ error: 'Missing symbol or side' });
      }

      const workflow = tradingManager.getWorkflow();
      if (!workflow) return res.status(400).json({ error: 'Trading workflow is not running' });

      try {
        const order = await closePositionService(tradingManager, { symbol, side });
        res.json({ success: true, order });
      } catch (e) {
        return res.status(404).json({ error: e instanceof Error ? e.message : 'Not found' });
      }
    } catch (error) {
      logger.error('Error closing position', error);
      res.status(500).json({ error: 'Failed to close position' });
    }
  });

  // Place manual order
  router.post('/api/order', async (req: Request, res: Response) => {
    try {
      const { symbol, side, amount, price, leverage } = req.body || {};
      if (!symbol || !side || !amount || (side !== 'buy' && side !== 'sell')) {
        return res.status(400).json({ error: 'Invalid order payload' });
      }

      const workflow = tradingManager.getWorkflow();
      if (!workflow) {
        return res.status(409).json({
          error: 'Trading workflow is not running',
          code: 'WORKFLOW_NOT_RUNNING',
          hint: 'Start trading via POST /api/trade/start or the dashboard control, then retry.',
        });
      }

      const order = await placeOrderService(tradingManager, {
        symbol,
        side,
        amount: Number(amount),
        price: price ? Number(price) : undefined,
        leverage: leverage ? Number(leverage) : undefined,
      });
      res.json({ success: true, order });
    } catch (error) {
      logger.error('Error placing order', error);
      res.status(500).json({ error: 'Failed to place order' });
    }
  });
}

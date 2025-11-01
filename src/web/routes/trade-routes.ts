import { Router, Request, Response } from 'express';
import {
  getPositionsService,
  getAccountService,
  closePositionService,
  placeOrderService,
} from '../api-service.js';
import { sendErrorResponse, validateRequiredFields } from '../utils/error-handler.js';
import type { TradingManager } from '../trading-manager.js';

/**
 * Register trade-related routes
 */
export function registerTradeRoutes(router: Router, tradingManager: TradingManager): void {
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
      sendErrorResponse(res, error, 'Failed to get positions', 500);
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
      sendErrorResponse(res, error, 'Failed to get account', 500);
    }
  });

  // Close position (by symbol and side)
  router.post('/api/position/close', async (req: Request, res: Response) => {
    try {
      interface ClosePositionBody extends Record<string, unknown> {
        symbol: string;
        side: 'long' | 'short';
      }

      if (!validateRequiredFields<ClosePositionBody>(req.body, ['symbol', 'side'])) {
        return res.status(400).json({ error: 'Missing symbol or side' });
      }

      const { symbol, side } = req.body as ClosePositionBody;

      const workflow = tradingManager.getWorkflow();
      if (!workflow) {
        return res.status(400).json({ error: 'Trading workflow is not running' });
      }

      try {
        const order = await closePositionService(tradingManager, { symbol, side });
        res.json({ success: true, order });
      } catch (e) {
        const statusCode = e instanceof Error && e.message.includes('not found') ? 404 : 400;
        sendErrorResponse(res, e, 'Failed to close position', statusCode);
      }
    } catch (error) {
      sendErrorResponse(res, error, 'Failed to close position', 500);
    }
  });

  // Place manual order
  router.post('/api/order', async (req: Request, res: Response) => {
    try {
      interface PlaceOrderBody extends Record<string, unknown> {
        symbol: string;
        side: 'buy' | 'sell';
        amount: number;
        price?: number;
        leverage?: number;
      }

      const body = req.body as PlaceOrderBody;

      if (
        !validateRequiredFields<PlaceOrderBody>(body, ['symbol', 'side', 'amount']) ||
        (body.side !== 'buy' && body.side !== 'sell')
      ) {
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
        symbol: body.symbol,
        side: body.side,
        amount: Number(body.amount),
        price: body.price ? Number(body.price) : undefined,
        leverage: body.leverage ? Number(body.leverage) : undefined,
      });
      res.json({ success: true, order });
    } catch (error) {
      sendErrorResponse(res, error, 'Failed to place order', 500);
    }
  });

  // Update exit plan for a position
  router.post('/api/position/exit-plan', async (req: Request, res: Response) => {
    try {
      interface ExitPlanBody extends Record<string, unknown> {
        symbol: string;
        side: 'long' | 'short';
        stopLoss?: number;
        takeProfit?: number;
      }

      if (!validateRequiredFields<ExitPlanBody>(req.body, ['symbol', 'side'])) {
        return res.status(400).json({ error: 'Missing symbol or side' });
      }

      const { symbol, side, stopLoss, takeProfit } = req.body as ExitPlanBody;

      tradingManager.setCustomExitPlan(symbol, side, stopLoss, takeProfit);

      res.json({ success: true });
    } catch (error) {
      sendErrorResponse(res, error, 'Failed to update exit plan', 500);
    }
  });
}

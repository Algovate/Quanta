import { Router, Request, Response } from 'express';
import { startTradingService } from '../api-service.js';
import { sendErrorResponse } from '../utils/error-handler.js';
import type { TradingManager } from '../trading-manager.js';

/**
 * Register system-related routes (status, start, stop, pause)
 */
export function registerSystemRoutes(router: Router, tradingManager: TradingManager): void {
  // Return current normalized config (exposes mode/env)
  router.get('/api/config', async (_req: Request, res: Response) => {
    try {
      const { getConfig } = await import('../../config/settings.js');
      const cfg = getConfig();
      res.json({
        mode: (cfg as any).mode,
        env: (cfg as any).env,
        exchange: cfg.exchange,
        trading: cfg.trading,
      });
    } catch (error) {
      sendErrorResponse(res, error, 'Failed to get config', 500);
    }
  });
  // Get system status
  router.get('/api/status', async (_req: Request, res: Response) => {
    try {
      const state = tradingManager.getState();
      const workflow = tradingManager.getWorkflow();

      let account = null;
      let positions: {
        symbol: string;
        side: 'long' | 'short';
        size: number;
        customStopLoss?: number;
        customTakeProfit?: number;
      }[] = [];

      if (workflow) {
        const exchange = workflow.getExchange();
        account = await exchange.getAccount();
        const raw = await exchange.getPositions();
        // Enrich with custom or default (config-activated) exit plans so initial load shows Exit Plan
        positions = raw.map(p => {
          const custom = tradingManager.getCustomExitPlan(p.symbol, p.side);
          let customStopLoss = custom.stopLoss;
          let customTakeProfit = custom.takeProfit;
          if (!customStopLoss && !p.trailingStopPrice) {
            try {
              const cfg = tradingManager.getWorkflow()?.getConfig();
              const slPct = cfg?.riskParams?.defaultStopLoss;
              if (typeof slPct === 'number' && slPct > 0) {
                const isLong = p.side === 'long';
                const entry = p.entryPrice;
                const defaultSL = isLong ? entry * (1 - slPct) : entry * (1 + slPct);
                customStopLoss = defaultSL;
                const tpPct = slPct * 2;
                const defaultTP = isLong ? entry * (1 + tpPct) : entry * (1 - tpPct);
                customTakeProfit = customTakeProfit ?? defaultTP;
              }
            } catch {
              // best-effort
            }
          }
          return {
            ...p,
            customStopLoss,
            customTakeProfit,
          } as typeof p & { customStopLoss?: number; customTakeProfit?: number };
        });
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
      const { coins, env, mode } = req.body || {};
      await startTradingService(tradingManager, coins, { env, mode });

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

import { Router, Request, Response, NextFunction } from 'express';
import { startTradingService } from '../api-service.js';
import { sendErrorResponse } from '../utils/error-handler.js';
import type { TradingManager } from '../trading-manager.js';
import { ExecutionSessionManager } from '../execution-session-manager.js';
import type { SystemStatusResponse, SessionResponse, SuccessResponse } from '../types/dto.js';

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
        mode: cfg.mode,
        env: cfg.env,
        exchange: cfg.exchange,
        trading: cfg.trading,
      });
    } catch (error) {
      sendErrorResponse(res, error, 'Failed to get config', 500);
    }
  });
  // Get system status
  router.get(
    '/api/status',
    async (_req: Request, res: Response<SystemStatusResponse>, next: NextFunction) => {
      try {
        const state = tradingManager.getState();
        const workflow = tradingManager.getWorkflow();

        let account = null;
        let positions: SystemStatusResponse['positions'] = [];

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
            };
          });
        }

        const response: SystemStatusResponse = {
          state,
          account,
          positions,
        };

        res.json(response);
      } catch (error) {
        next(error);
      }
    }
  );

  // Get active execution session (arena or strategy)
  router.get('/api/system/session', (_req: Request, res: Response<SessionResponse>) => {
    const session = ExecutionSessionManager.getInstance().getActive();
    const response: SessionResponse = {
      active: !!session,
      session: session
        ? {
            mode: session.mode,
            id: session.id,
            startTime: session.startTime,
          }
        : null,
    };
    res.json(response);
  });

  // Start trading
  router.post(
    '/api/trade/start',
    async (req: Request, res: Response<SuccessResponse>, next: NextFunction) => {
      try {
        const { coins, env, mode } = req.body || {};
        await startTradingService(tradingManager, coins, { env, mode });

        const response: SuccessResponse = {
          success: true,
          message: 'Trading started',
        };
        res.json(response);
      } catch (error) {
        next(error);
      }
    }
  );

  // Stop trading
  router.post(
    '/api/trade/stop',
    async (_req: Request, res: Response<SuccessResponse>, next: NextFunction) => {
      try {
        await tradingManager.stop();
        const response: SuccessResponse = {
          success: true,
          message: 'Trading stopped',
        };
        res.json(response);
      } catch (error) {
        next(error);
      }
    }
  );

  // Pause trading
  router.post(
    '/api/trade/pause',
    async (_req: Request, res: Response<SuccessResponse>, next: NextFunction) => {
      try {
        await tradingManager.pause();
        const response: SuccessResponse = {
          success: true,
          message: 'Trading paused',
        };
        res.json(response);
      } catch (error) {
        next(error);
      }
    }
  );
}

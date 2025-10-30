import { Router, Request, Response } from 'express';
import { Logger } from '../../utils/logger.js';
import { getConfig } from '../../config/settings.js';
import { createDataSourceManager } from '../../core/data-source-manager.js';
import { TradingManager } from '../trading-manager.js';
import type { Exchange } from '../../exchange/types.js';

const logger = Logger.getInstance('DataRoutes');

/**
 * Resolve exchange instance from workflow or config
 */
async function resolveExchange(tradingManager: any): Promise<Exchange> {
  const workflow = tradingManager.getWorkflow();
  if (workflow) return workflow.getExchange();
  const config = getConfig();
  const dsm = createDataSourceManager(config);
  return dsm.getExchange();
}

/**
 * Normalize symbol format for exchange-specific requirements
 */
function normalizeSymbolForExchange(exchangeName: string, symbol: string): string {
  const s = symbol.toUpperCase();
  if (exchangeName === 'okx') {
    // OKX futures/swap often require ":USDT" suffix, e.g., BTC/USDT:USDT
    if (s.endsWith('/USDT') && !s.includes(':USDT')) {
      return `${s}:USDT`;
    }
  }
  return s;
}

/**
 * Register data-related routes (config, signals, orders, risk, equity, klines, market)
 */
export function registerDataRoutes(router: Router, tradingManager: TradingManager): void {
  // Get config
  router.get('/api/config', (_req: Request, res: Response) => {
    try {
      const config = getConfig();
      res.json(config);
    } catch (error) {
      logger.error('Error getting config', error);
      res.status(500).json({ error: 'Failed to get config' });
    }
  });

  // Update config (simplified for now)
  router.put('/api/config', (_req: Request, res: Response) => {
    res.status(501).json({ error: 'Config update not yet implemented' });
  });

  // Signals (recent)
  router.get('/api/signals', (req: Request, res: Response) => {
    try {
      const limit = Math.max(1, Math.min(200, parseInt(String(req.query.limit || '50'), 10)));
      const items = tradingManager.getSignals(limit) || [];
      res.json(items);
    } catch (error) {
      logger.error('Error getting signals', error);
      res.status(500).json({ error: 'Failed to get signals' });
    }
  });

  // Orders (recent)
  router.get('/api/orders', (req: Request, res: Response) => {
    try {
      const limit = Math.max(1, Math.min(200, parseInt(String(req.query.limit || '50'), 10)));
      const items = tradingManager.getOrders(limit) || [];
      res.json(items);
    } catch (error) {
      logger.error('Error getting orders', error);
      res.status(500).json({ error: 'Failed to get orders' });
    }
  });

  // Risk snapshot
  router.get('/api/risk', (_req: Request, res: Response) => {
    try {
      const risk = tradingManager.getRisk();
      res.json(risk || null);
    } catch (error) {
      logger.error('Error getting risk', error);
      res.status(500).json({ error: 'Failed to get risk' });
    }
  });

  // Equity history
  router.get('/api/equity/history', (req: Request, res: Response) => {
    try {
      const limit = Math.max(1, Math.min(1000, parseInt(String(req.query.limit || '500'), 10)));
      const items = tradingManager.getEquityHistory(limit) || [];
      res.json(items);
    } catch (error) {
      logger.error('Error getting equity history', error);
      res.status(500).json({ error: 'Failed to get equity history' });
    }
  });

  // Get K-lines (candlestick data)
  router.get('/api/klines/:symbol', async (req: Request, res: Response) => {
    try {
      const { symbol } = req.params;
      const timeframe = (req.query.timeframe as string) || '1h';
      const limit = Math.max(1, Math.min(1000, parseInt(String(req.query.limit || '100'), 10)));

      // Resolve exchange from workflow or config (allows klines even when not trading)
      const exchange = await resolveExchange(tradingManager);

      // Normalize symbol: convert ETHUSDT -> ETH/USDT, BTCUSDT -> BTC/USDT, etc.
      let normalizedSymbol = symbol.includes('/')
        ? symbol
        : symbol.replace(/([A-Z]+)(USDT)/, '$1/$2');

      // Further normalize for exchange-specific requirements
      const exchangeName = exchange.getExchangeName?.() || '';
      normalizedSymbol = normalizeSymbolForExchange(exchangeName, normalizedSymbol);

      const candlesticks = await exchange.getCandlesticks(normalizedSymbol, timeframe, limit);

      if (!candlesticks || candlesticks.length === 0) {
        return res.status(404).json({ error: `No data available for ${normalizedSymbol}` });
      }

      res.json(candlesticks);
    } catch (error) {
      logger.error('Error getting K-lines', error);
      const errorMessage = error instanceof Error ? error.message : 'Failed to get K-lines data';
      res.status(500).json({ error: errorMessage });
    }
  });

  // Get order book depth (stub implementation for now)
  router.get('/api/depth/:symbol', async (_req: Request, res: Response) => {
    try {
      // TODO: Implement actual depth data from exchange
      // For now, return mock data to prevent 404 errors
      res.json({
        bids: [],
        asks: [],
      });
    } catch (error) {
      logger.error('Error getting depth', error);
      res.status(500).json({ error: 'Failed to get depth data' });
    }
  });

  // Get recent trades (stub implementation for now)
  router.get('/api/trades/:symbol', async (_req: Request, res: Response) => {
    try {
      // TODO: Implement actual trades data from exchange
      // For now, return mock data to prevent 404 errors
      res.json([]);
    } catch (error) {
      logger.error('Error getting trades', error);
      res.status(500).json({ error: 'Failed to get trades data' });
    }
  });
}

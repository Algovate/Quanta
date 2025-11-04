import { Router, Request, Response } from 'express';
import type * as ccxt from 'ccxt';
import { getConfig, saveConfig } from '../../config/settings.js';
import { TradingManager } from '../trading-manager.js';
import type { Exchange } from '../../exchange/types.js';
import { resolveExchange, isNonCCXTExchange } from '../utils/exchange-utils.js';
import { normalizeSymbolParam } from '../utils/symbol-normalization.js';
import { parseQueryLimit } from '../utils/error-handler.js';
import { createLogger } from '../utils/logger.js';

const { logger, context: loggerContext } = createLogger('DataRoutes');

/**
 * Check if exchange has underlying CCXT instance and access it
 */
function getCCXTExchange(exchange: Exchange): {
  fetchOrderBook: (symbol: string, limit?: number) => Promise<ccxt.OrderBook>;
  fetchTrades: (symbol: string, since?: number, limit?: number) => Promise<ccxt.Trade[]>;
  loadMarkets: () => Promise<void>;
} | null {
  // Check if exchange has a private 'exchange' property (CCXT instance)
  // This works for OKXExchange, BinanceExchange, CoinbaseExchange, HyperliquidExchange
  const exchangeAny = exchange as unknown as Record<string, unknown>;
  const ccxtInstance = exchangeAny.exchange as
    | {
        fetchOrderBook?: (symbol: string, limit?: number) => Promise<ccxt.OrderBook>;
        fetchTrades?: (symbol: string, since?: number, limit?: number) => Promise<ccxt.Trade[]>;
        loadMarkets?: () => Promise<void>;
      }
    | undefined;

  if (
    ccxtInstance &&
    typeof ccxtInstance.fetchOrderBook === 'function' &&
    typeof ccxtInstance.fetchTrades === 'function'
  ) {
    return {
      fetchOrderBook: ccxtInstance.fetchOrderBook.bind(ccxtInstance),
      fetchTrades: ccxtInstance.fetchTrades.bind(ccxtInstance),
      loadMarkets: ccxtInstance.loadMarkets?.bind(ccxtInstance) || (async () => {}),
    };
  }

  return null;
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
      logger.error(
        'Error getting config',
        error instanceof Error ? error : new Error(String(error)),
        loggerContext
      );
      res.status(500).json({ error: 'Failed to get config' });
    }
  });

  // Update config
  router.put('/api/config', (req: Request, res: Response) => {
    try {
      const configUpdate = req.body;
      saveConfig(configUpdate);
      res.json({ success: true, message: 'Configuration saved successfully' });
    } catch (error) {
      logger.error(
        'Error saving config',
        error instanceof Error ? error : new Error(String(error)),
        loggerContext
      );
      res.status(500).json({ error: 'Failed to save config' });
    }
  });

  // Signals (recent)
  router.get('/api/signals', (req: Request, res: Response) => {
    try {
      const limit = parseQueryLimit(req.query.limit, 50, 1, 200);
      const items = tradingManager.getSignals(limit) || [];
      res.json(items);
    } catch (error) {
      logger.error(
        'Error getting signals',
        error instanceof Error ? error : new Error(String(error)),
        loggerContext
      );
      res.status(500).json({ error: 'Failed to get signals' });
    }
  });

  // Orders (recent)
  router.get('/api/orders', (req: Request, res: Response) => {
    try {
      const limit = parseQueryLimit(req.query.limit, 50, 1, 200);
      const items = tradingManager.getOrders(limit) || [];
      res.json(items);
    } catch (error) {
      logger.error(
        'Error getting orders',
        error instanceof Error ? error : new Error(String(error)),
        loggerContext
      );
      res.status(500).json({ error: 'Failed to get orders' });
    }
  });

  // Trades (recent completed executions)
  router.get('/api/trades', (req: Request, res: Response) => {
    try {
      const limit = parseQueryLimit(req.query.limit, 50, 1, 200);
      const items = tradingManager.getTrades(limit) || [];
      res.json(items);
    } catch (error) {
      logger.error(
        'Error getting trades',
        error instanceof Error ? error : new Error(String(error)),
        loggerContext
      );
      res.status(500).json({ error: 'Failed to get trades' });
    }
  });

  // Risk snapshot
  router.get('/api/risk', (_req: Request, res: Response) => {
    try {
      const risk = tradingManager.getRisk();
      res.json(risk || null);
    } catch (error) {
      logger.error(
        'Error getting risk',
        error instanceof Error ? error : new Error(String(error)),
        loggerContext
      );
      res.status(500).json({ error: 'Failed to get risk' });
    }
  });

  // Equity history
  router.get('/api/equity/history', (req: Request, res: Response) => {
    try {
      const limit = parseQueryLimit(req.query.limit, 500, 1, 1000);
      const items = tradingManager.getEquityHistory(limit) || [];
      res.json(items);
    } catch (error) {
      logger.error(
        'Error getting equity history',
        error instanceof Error ? error : new Error(String(error)),
        loggerContext
      );
      res.status(500).json({ error: 'Failed to get equity history' });
    }
  });

  // Get K-lines (candlestick data)
  router.get('/api/klines/:symbol', async (req: Request, res: Response) => {
    try {
      const { symbol } = req.params;
      const timeframe = (req.query.timeframe as string) || '1h';
      const limit = parseQueryLimit(req.query.limit, 100, 1, 1000);

      // Resolve exchange from workflow or config (allows klines even when not trading)
      const exchange = await resolveExchange(tradingManager);

      // Normalize symbol
      const normalizedSymbol = normalizeSymbolParam(symbol, exchange);

      const candlesticks = await exchange.getCandlesticks(normalizedSymbol, timeframe, limit);

      if (!candlesticks || candlesticks.length === 0) {
        return res.status(404).json({ error: `No data available for ${normalizedSymbol}` });
      }

      res.json(candlesticks);
    } catch (error) {
      logger.error(
        'Error getting K-lines',
        error instanceof Error ? error : new Error(String(error)),
        loggerContext
      );
      const errorMessage = error instanceof Error ? error.message : 'Failed to get K-lines data';
      res.status(500).json({ error: errorMessage });
    }
  });

  // Get order book depth
  router.get('/api/depth/:symbol', async (req: Request, res: Response) => {
    try {
      const { symbol } = req.params;
      const limit = parseQueryLimit(req.query.limit, 20, 1, 100);

      // Resolve exchange from workflow or config
      const exchange = await resolveExchange(tradingManager);
      const exchangeName = exchange.getExchangeName();

      // Check if exchange is simulator/paper/backtest (don't support order book)
      if (isNonCCXTExchange(exchangeName)) {
        return res.json({
          bids: [],
          asks: [],
          timestamp: Date.now(),
        });
      }

      // Try to get CCXT instance for real exchanges
      const ccxtExchange = getCCXTExchange(exchange);
      if (!ccxtExchange) {
        return res.json({
          bids: [],
          asks: [],
          timestamp: Date.now(),
        });
      }

      // Normalize symbol
      const normalizedSymbol = normalizeSymbolParam(symbol, exchange);

      // Load markets if needed
      await ccxtExchange.loadMarkets();

      // Fetch order book from exchange
      const orderBook = await ccxtExchange.fetchOrderBook(normalizedSymbol, limit);

      // Format response
      res.json({
        bids: (orderBook.bids || []).map(([price, amount]) => [price, amount]),
        asks: (orderBook.asks || []).map(([price, amount]) => [price, amount]),
        timestamp: orderBook.timestamp || Date.now(),
      });
    } catch (error) {
      logger.error(
        'Error getting depth',
        error instanceof Error ? error : new Error(String(error)),
        loggerContext
      );
      const errorMessage = error instanceof Error ? error.message : 'Failed to get depth data';
      res.status(500).json({ error: errorMessage });
    }
  });

  // Get recent trades
  router.get('/api/trades/:symbol', async (req: Request, res: Response) => {
    try {
      const { symbol } = req.params;
      const limit = parseQueryLimit(req.query.limit, 50, 1, 100);
      const since = req.query.since ? parseInt(String(req.query.since), 10) : undefined;

      // Resolve exchange from workflow or config
      const exchange = await resolveExchange(tradingManager);
      const exchangeName = exchange.getExchangeName();

      // Check if exchange is simulator/paper/backtest (don't support trades)
      if (isNonCCXTExchange(exchangeName)) {
        return res.json([]);
      }

      // Try to get CCXT instance for real exchanges
      const ccxtExchange = getCCXTExchange(exchange);
      if (!ccxtExchange) {
        return res.json([]);
      }

      // Normalize symbol
      const normalizedSymbol = normalizeSymbolParam(symbol, exchange);

      // Load markets if needed
      await ccxtExchange.loadMarkets();

      // Fetch trades from exchange
      const trades = await ccxtExchange.fetchTrades(normalizedSymbol, since, limit);

      // Format response: convert CCXT Trade format to simple array
      const formattedTrades = trades.map(trade => ({
        id: trade.id || String(trade.timestamp),
        symbol: trade.symbol,
        side: trade.side === 'buy' ? 'buy' : 'sell',
        amount: trade.amount,
        price: trade.price,
        timestamp: trade.timestamp || Date.now(),
        cost: trade.cost,
        fee: trade.fee,
      }));

      res.json(formattedTrades);
    } catch (error) {
      logger.error(
        'Error getting trades',
        error instanceof Error ? error : new Error(String(error)),
        loggerContext
      );
      const errorMessage = error instanceof Error ? error.message : 'Failed to get trades data';
      res.status(500).json({ error: errorMessage });
    }
  });
}

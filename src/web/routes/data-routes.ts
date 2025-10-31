import { Router, Request, Response } from 'express';
import type * as ccxt from 'ccxt';
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

  // Get order book depth
  router.get('/api/depth/:symbol', async (req: Request, res: Response) => {
    try {
      const { symbol } = req.params;
      const limit = Math.max(1, Math.min(100, parseInt(String(req.query.limit || '20'), 10)));

      // Resolve exchange from workflow or config
      const exchange = await resolveExchange(tradingManager);
      const exchangeName = exchange.getExchangeName();

      // Check if exchange is simulator/paper/backtest (don't support order book)
      if (
        exchangeName === 'simulator' ||
        exchangeName.startsWith('paper(') ||
        exchangeName === 'backtest'
      ) {
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

      // Normalize symbol format
      let normalizedSymbol = symbol.includes('/')
        ? symbol
        : symbol.replace(/([A-Z]+)(USDT)/, '$1/$2');
      normalizedSymbol = normalizeSymbolForExchange(exchangeName, normalizedSymbol);

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
      logger.error('Error getting depth', error);
      const errorMessage = error instanceof Error ? error.message : 'Failed to get depth data';
      res.status(500).json({ error: errorMessage });
    }
  });

  // Get recent trades
  router.get('/api/trades/:symbol', async (req: Request, res: Response) => {
    try {
      const { symbol } = req.params;
      const limit = Math.max(1, Math.min(100, parseInt(String(req.query.limit || '50'), 10)));
      const since = req.query.since ? parseInt(String(req.query.since), 10) : undefined;

      // Resolve exchange from workflow or config
      const exchange = await resolveExchange(tradingManager);
      const exchangeName = exchange.getExchangeName();

      // Check if exchange is simulator/paper/backtest (don't support trades)
      if (
        exchangeName === 'simulator' ||
        exchangeName.startsWith('paper(') ||
        exchangeName === 'backtest'
      ) {
        return res.json([]);
      }

      // Try to get CCXT instance for real exchanges
      const ccxtExchange = getCCXTExchange(exchange);
      if (!ccxtExchange) {
        return res.json([]);
      }

      // Normalize symbol format
      let normalizedSymbol = symbol.includes('/')
        ? symbol
        : symbol.replace(/([A-Z]+)(USDT)/, '$1/$2');
      normalizedSymbol = normalizeSymbolForExchange(exchangeName, normalizedSymbol);

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
      logger.error('Error getting trades', error);
      const errorMessage = error instanceof Error ? error.message : 'Failed to get trades data';
      res.status(500).json({ error: errorMessage });
    }
  });
}

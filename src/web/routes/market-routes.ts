import { Router, Request, Response } from 'express';
import { Logger } from '../../utils/logger.js';
import { getConfig } from '../../config/settings.js';
import { createDataSourceManager } from '../../core/data-source-manager.js';
import type { Exchange } from '../../exchange/types.js';

const logger = Logger.getInstance('MarketRoutes');

/**
 * Register market data routes
 */
export function registerMarketRoutes(router: Router, tradingManager: any): void {
  // Market summary: current price and latest kline for symbols
  router.get('/api/market/summary', async (req: Request, res: Response) => {
    try {
      const symbolsParam = String(req.query.symbols || '').trim();
      const interval = (req.query.interval as string) || '1m';
      const symbols = symbolsParam
        ? symbolsParam
            .split(',')
            .map(s => decodeURIComponent(s.trim()))
            .filter(Boolean)
        : [];

      if (!symbols.length) {
        return res.status(400).json({ error: 'Missing symbols query param' });
      }

      const exchange = await resolveExchange(tradingManager);
      const now = Date.now();
      const PRICE_TTL_MS = 1000;
      const KLINE_TTL_MS = 5000;

      // Create caches if they don't exist
      if (!tradingManager._priceCache) {
        tradingManager._priceCache = new Map<string, { price: number; ts: number }>();
      }
      if (!tradingManager._klineCache) {
        tradingManager._klineCache = new Map<
          string,
          {
            candle: {
              timestamp: number;
              open: number;
              high: number;
              low: number;
              close: number;
              volume: number;
            };
            ts: number;
          }
        >();
      }

      const results = await Promise.all(
        symbols.map(async symbol => {
          const exchangeName = exchange.getExchangeName?.() || '';
          const sym = normalizeSymbolForExchange(exchangeName, symbol);

          let price: number = 0;
          let candle = null;

          try {
            // price with cache
            const priceEntry = tradingManager._priceCache.get(sym);
            if (priceEntry && now - priceEntry.ts < PRICE_TTL_MS) {
              price = priceEntry.price;
            } else {
              const ticker = await exchange.getTicker(sym);
              price = ticker.price;
              tradingManager._priceCache.set(sym, { price, ts: now });
            }

            // latest kline with cache
            const kKey = `${sym}_${interval}`;
            const klineEntry = tradingManager._klineCache.get(kKey);
            if (klineEntry && now - klineEntry.ts < KLINE_TTL_MS) {
              candle = klineEntry.candle;
            } else {
              const candles = await exchange.getCandlesticks(sym, interval, 1);
              const last = candles && candles.length ? candles[candles.length - 1] : null;
              candle = last || null;
              if (candle) tradingManager._klineCache.set(kKey, { candle, ts: now });
            }
          } catch (error) {
            logger.error(`Error fetching data for ${sym}:`, error);
            // Return zeros instead of failing completely
          }

          return {
            symbol: sym,
            price,
            kline: candle
              ? {
                  t: candle.timestamp,
                  o: candle.open,
                  h: candle.high,
                  l: candle.low,
                  c: candle.close,
                  v: candle.volume,
                }
              : null,
          };
        })
      );

      res.json({ data: results, interval, updatedAt: Date.now() });
    } catch (error) {
      logger.error('Error getting market summary', error);
      res.status(500).json({ error: 'Failed to get market summary' });
    }
  });
}

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

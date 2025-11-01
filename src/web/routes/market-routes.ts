import { Router, Request, Response } from 'express';
import { Logger } from '../../utils/logger.js';
import { getConfig } from '../../config/settings.js';
import { sendErrorResponse, validateRequiredQuery } from '../utils/error-handler.js';
import { parseSymbolsQuery, normalizeSymbolForExchange } from '../utils/symbol-normalization.js';
import { isPriceCacheValid, isKlineCacheValid, type KlineCacheEntry } from '../utils/cache.js';
import { resolveExchange } from '../utils/exchange-utils.js';
import type { TradingManager } from '../trading-manager.js';

const logger = Logger.getInstance('MarketRoutes');

/**
 * Register market data routes
 */
export function registerMarketRoutes(router: Router, tradingManager: TradingManager): void {
  // Market summary: current price and latest kline for symbols
  router.get('/api/market/summary', async (req: Request, res: Response) => {
    try {
      if (!validateRequiredQuery(req.query, ['symbols'])) {
        return res.status(400).json({ error: 'Missing symbols query param' });
      }

      const symbols = parseSymbolsQuery(req.query);
      if (symbols.length === 0) {
        return res.status(400).json({ error: 'Invalid or empty symbols query param' });
      }

      const interval = (req.query.interval as string) || '1m';
      const exchange = await resolveExchange(tradingManager);
      const config = getConfig();
      const marketType = config.exchange?.marketType as
        | 'spot'
        | 'swap'
        | 'perp'
        | 'perpetual'
        | undefined;
      const now = Date.now();
      const PRICE_TTL_MS = 1000;
      const KLINE_TTL_MS = 5000;

      // Ensure caches exist
      if (!tradingManager._priceCache || !tradingManager._klineCache) {
        return res.status(500).json({ error: 'Cache not initialized' });
      }

      const results = await Promise.all(
        symbols.map(async symbol => {
          const sym = normalizeSymbolForExchange(exchange, symbol, marketType);
          let price: number | undefined = undefined;
          let candle: KlineCacheEntry['candle'] | null = null;

          try {
            // Check price cache
            const priceEntry = tradingManager._priceCache!.get(sym);
            if (isPriceCacheValid(priceEntry, PRICE_TTL_MS, now)) {
              price = priceEntry!.price;
            } else {
              // Invalid or expired cache - remove it
              if (priceEntry) {
                tradingManager._priceCache!.delete(sym);
              }

              // Fetch fresh price
              try {
                const ticker = await exchange.getTicker(sym);
                if (ticker.price > 0 && isFinite(ticker.price)) {
                  price = ticker.price;
                  tradingManager._priceCache!.set(sym, { price, ts: now });
                } else {
                  logger.warn(`Invalid price from ticker for ${sym}: ${ticker.price}`);
                }
              } catch (tickerError) {
                logger.error(`Error fetching ticker for ${sym}:`, tickerError);
              }
            }

            // Check kline cache
            const kKey = `${sym}_${interval}`;
            const klineEntry = tradingManager._klineCache!.get(kKey);
            if (isKlineCacheValid(klineEntry, KLINE_TTL_MS, now)) {
              candle = klineEntry!.candle;
            } else {
              // Fetch fresh kline
              try {
                const candles = await exchange.getCandlesticks(sym, interval, 1);
                const last = candles && candles.length ? candles[candles.length - 1] : null;
                if (last) {
                  candle = last;
                  tradingManager._klineCache!.set(kKey, { candle: last, ts: now });
                }
              } catch (klineError) {
                logger.error(`Error fetching candlesticks for ${sym}:`, klineError);
              }
            }
          } catch (error) {
            logger.error(`Error fetching data for ${sym}:`, error);
          }

          return {
            symbol: sym,
            price: price ?? null, // Return null instead of 0 for invalid/missing price
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
      sendErrorResponse(res, error, 'Failed to get market summary', 500);
    }
  });
}

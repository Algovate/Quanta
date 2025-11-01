/**
 * Symbol normalization utilities for different exchanges
 */

import type { Exchange } from '../../exchange/types.js';

/**
 * Normalizes symbol format for exchange-specific requirements
 */
export function normalizeSymbolForExchange(exchange: Exchange, symbol: string): string {
  const exchangeName = exchange.getExchangeName?.() || '';
  const normalized = symbol.toUpperCase().trim();

  switch (exchangeName) {
    case 'okx':
      // OKX futures/swap often require ":USDT" suffix, e.g., BTC/USDT:USDT
      if (normalized.endsWith('/USDT') && !normalized.includes(':USDT')) {
        return `${normalized}:USDT`;
      }
      break;
    case 'binance':
      // Binance uses BTCUSDT format (no slash)
      if (normalized.includes('/')) {
        return normalized.replace('/', '');
      }
      break;
    // Add more exchange-specific normalizations as needed
  }

  return normalized;
}

/**
 * Parses symbols from query parameter (comma-separated)
 */
export function parseSymbolsQuery(query: unknown): string[] {
  if (!query || typeof query !== 'object') {
    return [];
  }

  const symbolsParam = String((query as { symbols?: string }).symbols || '').trim();
  if (!symbolsParam) {
    return [];
  }

  return symbolsParam
    .split(',')
    .map(s => decodeURIComponent(s.trim()))
    .filter(Boolean);
}

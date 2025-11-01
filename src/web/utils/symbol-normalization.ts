/**
 * Symbol normalization utilities for different exchanges
 */

import type { Exchange } from '../../exchange/types.js';
import { getConfig } from '../../config/settings.js';

/**
 * Normalizes symbol format for exchange-specific requirements
 * @param exchange - The exchange instance
 * @param symbol - The symbol to normalize
 * @param marketType - Optional market type override (spot, swap, perp). If not provided, reads from config.
 */
export function normalizeSymbolForExchange(
  exchange: Exchange,
  symbol: string,
  marketType?: 'spot' | 'swap' | 'perp' | 'perpetual'
): string {
  const exchangeName = exchange.getExchangeName?.() || '';
  const normalized = symbol.toUpperCase().trim();

  switch (exchangeName) {
    case 'okx':
      // OKX spot uses BTC/USDT, while swap/perp uses BTC/USDT:USDT
      // Only add :USDT suffix for swap/perp markets, not spot
      if (normalized.endsWith('/USDT') && !normalized.includes(':USDT')) {
        // Determine market type from parameter or config
        let isSwap = false;
        if (marketType) {
          isSwap = marketType === 'swap' || marketType === 'perp' || marketType === 'perpetual';
        } else {
          try {
            const config = getConfig();
            const mt = config.exchange?.marketType?.toLowerCase();
            isSwap = mt === 'swap' || mt === 'perp' || mt === 'perpetual';
          } catch {
            // If config read fails, default to swap behavior for backward compatibility
            isSwap = true;
          }
        }

        if (isSwap) {
          return `${normalized}:USDT`;
        }
        // For spot, return as-is (BTC/USDT)
        return normalized;
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

/**
 * Normalizes a symbol from URL parameter format to exchange format
 * Handles common patterns like ETHUSDT -> ETH/USDT
 * @param symbol - The symbol from URL parameter
 * @param exchange - The exchange instance
 * @returns Normalized symbol
 */
export function normalizeSymbolParam(symbol: string, exchange: Exchange): string {
  // First normalize from URL format to standard format
  const normalizedSymbol = symbol.includes('/')
    ? symbol
    : symbol.replace(/([A-Z]+)(USDT)/, '$1/$2');

  // Then apply exchange-specific normalization
  return normalizeSymbolForExchange(exchange, normalizedSymbol);
}

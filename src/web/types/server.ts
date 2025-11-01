/**
 * Server-side type definitions
 */

export interface PriceCacheEntry {
  price: number;
  ts: number;
}

export interface KlineCacheEntry {
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

export interface PriceCache {
  get(key: string): PriceCacheEntry | undefined;
  set(key: string, value: PriceCacheEntry): void;
  delete(key: string): void;
}

export interface KlineCache {
  get(key: string): KlineCacheEntry | undefined;
  set(key: string, value: KlineCacheEntry): void;
  delete(key: string): void;
}

export interface RouteContext {
  tradingManager: {
    getWorkflow: () => any | null;
    getExchange: () => any | null;
    getState: () => any;
    _priceCache?: PriceCache;
    _klineCache?: KlineCache;
    pushOrder: (order: any) => void;
    stop: () => Promise<void>;
    pause: () => Promise<void>;
    resume: () => Promise<void>;
  };
}

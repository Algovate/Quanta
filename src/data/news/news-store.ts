import type { NewsStoreItem, UnifiedNewsEvent } from './types.js';

/**
 * In-memory ring buffer store for recent news events with TTL.
 * Not persistent; designed for short-window aggregation inside trading cycles.
 */
export class NewsStore {
  private items: Map<string, NewsStoreItem> = new Map();
  private indexBySymbol: Map<string, Set<string>> = new Map();
  private ttlMs: number;

  constructor(ttlMinutes: number = 120) {
    this.ttlMs = Math.max(1, ttlMinutes) * 60 * 1000;
  }

  upsert(event: UnifiedNewsEvent): void {
    const key = this.makeKey(event);
    const now = Date.now();
    this.items.set(key, { event, receivedTs: now });

    const symbols = (event.entities || []).map(e => e.symbol);
    for (const sym of symbols) {
      if (!this.indexBySymbol.has(sym)) this.indexBySymbol.set(sym, new Set());
      this.indexBySymbol.get(sym)!.add(key);
    }
    this.gc();
  }

  getWindow(symbols: string[], fromTs: number, toTs: number): UnifiedNewsEvent[] {
    const result: UnifiedNewsEvent[] = [];
    const seen = new Set<string>();
    for (const sym of symbols) {
      const keys = this.indexBySymbol.get(sym);
      if (!keys) continue;
      for (const key of keys) {
        if (seen.has(key)) continue;
        const item = this.items.get(key);
        if (!item) continue;
        const ts = item.event.ts;
        if (ts >= fromTs && ts <= toTs) {
          result.push(item.event);
          seen.add(key);
        }
      }
    }
    return result.sort((a, b) => a.ts - b.ts);
  }

  private makeKey(e: UnifiedNewsEvent): string {
    return `${e.source}:${e.id}`;
  }

  private gc(): void {
    const now = Date.now();
    for (const [key, item] of this.items) {
      if (now - item.receivedTs > this.ttlMs) {
        this.items.delete(key);
      }
    }
    // Rebuild symbol index lazily to keep logic simple
    this.indexBySymbol.clear();
    for (const [key, item] of this.items) {
      const symbols = (item.event.entities || []).map(e => e.symbol);
      for (const sym of symbols) {
        if (!this.indexBySymbol.has(sym)) this.indexBySymbol.set(sym, new Set());
        this.indexBySymbol.get(sym)!.add(key);
      }
    }
  }
}

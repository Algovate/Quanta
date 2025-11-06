import type { NewsAdapter, NewsIngestionConfig, UnifiedNewsEvent } from './types.js';
import { NewsStore } from './news-store.js';
import { enrichWithLLM } from '../../ai/news-llm.js';

export class NewsIngestor {
  private adapters: NewsAdapter[] = [];
  private store: NewsStore;
  private cfg: NewsIngestionConfig;
  private timer?: ReturnType<typeof setInterval>;
  private lastFetchTs: number;

  constructor(cfg: NewsIngestionConfig, store?: NewsStore) {
    this.cfg = cfg;
    this.store = store ?? new NewsStore(120);
    // start from recent window
    this.lastFetchTs = Date.now() - Math.max(15_000, cfg.pollIntervalMs || 45_000);
  }

  registerAdapter(adapter: NewsAdapter): void {
    this.adapters.push(adapter);
  }

  getStore(): NewsStore {
    return this.store;
  }

  start(): void {
    if (!this.cfg.enabled) return;
    this.stop();
    const poll = async () => {
      const since = this.lastFetchTs;
      const all: UnifiedNewsEvent[] = [];
      await Promise.all(
        this.adapters.map(async a => {
          try {
            const events = await a.fetchSince(since);
            if (events && events.length) all.push(...events);
          } catch {
            // ignore adapter errors
          }
        })
      );
      // Deduplicate by source:id
      const seen = new Set<string>();
      for (const ev of all) {
        const key = `${ev.source}:${ev.id}`;
        if (seen.has(key)) continue;
        seen.add(key);
        let enriched = ev;
        if (this.cfg.llm?.enabledLLM || this.cfg.llm?.force) {
          try {
            enriched = await enrichWithLLM(ev, this.cfg.llm);
          } catch {
            // ignore enrichment errors
          }
        }
        this.store.upsert(enriched);
        if (enriched.ts > this.lastFetchTs) this.lastFetchTs = enriched.ts;
      }
    };
    void poll();
    this.timer = setInterval(
      () => void poll(),
      Math.max(10_000, this.cfg.pollIntervalMs || 45_000)
    );
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = undefined;
    }
  }
}

import { toError } from '../../utils/error-handler.js';
import type { NewsAdapter, UnifiedNewsEvent } from './types.js';

interface CryptoPanicItem {
  id: number | string;
  created_at: string; // ISO
  title: string;
  url?: string;
  votes?: { negative?: number; positive?: number; important?: number };
  source?: { title?: string; domain?: string };
  currencies?: Array<{ code: string }>;
}

interface CryptoPanicResponse {
  results?: CryptoPanicItem[];
}

export class CryptoPanicAdapter implements NewsAdapter {
  readonly name = 'cryptopanic';
  private apiKey?: string;

  constructor(apiKey?: string) {
    this.apiKey = apiKey;
  }

  async fetchSince(sinceTs: number): Promise<UnifiedNewsEvent[]> {
    try {
      const params: Record<string, string> = {
        kind: 'news',
        filter: 'rising',
        public: 'true',
      };
      if (this.apiKey) params.token = this.apiKey;
      const qs = new URLSearchParams(params).toString();
      const res = await fetch(`https://cryptopanic.com/api/v1/posts/?${qs}`);
      if (!res.ok) return [];
      const data = (await res.json()) as CryptoPanicResponse;
      const items = (data.results || []).filter(x => {
        const ts = Date.parse(x.created_at || '');
        return Number.isFinite(ts) && ts >= sinceTs;
      });
      return items.map(this.normalizeItem.bind(this));
    } catch (e) {
      // Swallow adapter errors; upstream will log if desired
      toError(e);
      return [];
    }
  }

  private normalizeItem(item: CryptoPanicItem): UnifiedNewsEvent {
    const ts = Date.parse(item.created_at || '') || Date.now();
    const symbols = (item.currencies || []).map(c => `${c.code}/USDT`);
    return {
      id: String(item.id),
      ts,
      source: this.name,
      title: item.title || '',
      url: item.url,
      entities: symbols.map(s => ({ symbol: s, confidence: 0.8 })),
      topics: [],
      meta: {
        source: item.source?.domain || item.source?.title,
        votes: item.votes,
      },
    } satisfies UnifiedNewsEvent;
  }
}

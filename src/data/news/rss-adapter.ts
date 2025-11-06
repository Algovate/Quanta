import type { NewsAdapter, UnifiedNewsEvent } from './types.js';

// Minimal RSS fetcher using DOMParser via xmldom-like environment is not available here.
// We implement a simple regex-based title/link/pubDate extraction that works for Coindesk/Cointelegraph RSS.

export class RSSAdapter implements NewsAdapter {
  readonly name = 'rss';
  private feedUrl: string;
  private sourceId: string;

  constructor(feedUrl: string, sourceId: string) {
    this.feedUrl = feedUrl;
    this.sourceId = sourceId;
  }

  async fetchSince(sinceTs: number): Promise<UnifiedNewsEvent[]> {
    try {
      const res = await fetch(this.feedUrl);
      if (!res.ok) return [];
      const xml = await res.text();
      const items = this.parseItems(xml);
      return items
        .filter(i => i.ts >= sinceTs)
        .map(i => ({
          id: i.guid || i.link || String(i.ts),
          ts: i.ts,
          source: `${this.name}:${this.sourceId}`,
          title: i.title,
          url: i.link,
          entities: [],
          topics: [],
        }));
    } catch {
      return [];
    }
  }

  private parseItems(
    xml: string
  ): Array<{ title: string; link: string; ts: number; guid?: string }> {
    const items: Array<{ title: string; link: string; ts: number; guid?: string }> = [];
    const itemRegex = /<item[\s\S]*?<\/item>/g;
    const titleRegex = /<title>([\s\S]*?)<\/title>/i;
    const linkRegex = /<link>([\s\S]*?)<\/link>/i;
    const dateRegex = /<pubDate>([\s\S]*?)<\/pubDate>/i;
    const guidRegex = /<guid[^>]*>([\s\S]*?)<\/guid>/i;
    const matches = xml.match(itemRegex) || [];
    for (const m of matches) {
      const title = (m.match(titleRegex)?.[1] || '').trim();
      const link = (m.match(linkRegex)?.[1] || '').trim();
      const dateStr = (m.match(dateRegex)?.[1] || '').trim();
      const guid = (m.match(guidRegex)?.[1] || '').trim();
      const ts = Date.parse(dateStr) || Date.now();
      if (title && link) items.push({ title, link, ts, guid });
    }
    return items;
  }
}

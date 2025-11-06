import type { UnifiedNewsEvent } from '../../data/news/types.js';

const SYMBOL_PATTERNS: Array<{ re: RegExp; symbol: string }> = [
  { re: /\bbitcoin\b|\bbtc\b/i, symbol: 'BTC/USDT' },
  { re: /\bethereum\b|\beth\b/i, symbol: 'ETH/USDT' },
  { re: /\bsolana\b|\bsol\b/i, symbol: 'SOL/USDT' },
];

export function linkEntitiesByHeuristics(
  title: string,
  body?: string
): Array<{ symbol: string; confidence: number }> {
  const text = `${title} ${body || ''}`;
  const out: Array<{ symbol: string; confidence: number }> = [];
  for (const p of SYMBOL_PATTERNS) {
    if (p.re.test(text)) out.push({ symbol: p.symbol, confidence: 0.7 });
  }
  return out;
}

export function ensureEntities(event: UnifiedNewsEvent): UnifiedNewsEvent {
  if (event.entities && event.entities.length) return event;
  const entities = linkEntitiesByHeuristics(event.title, event.body);
  return { ...event, entities };
}

import type { UnifiedNewsEvent } from '../../data/news/types.js';

export interface FeatureWeights {
  sentiment: number;
  novelty: number;
  reliability: number;
  volumeShock: number;
}

export function computeBasicFeatures(
  events: UnifiedNewsEvent[],
  options?: { now?: number }
): { sentiment: number; novelty: number; reliability: number; volumeShock: number } {
  const now = options?.now ?? Date.now();
  if (!events.length) return { sentiment: 0, novelty: 0, reliability: 0, volumeShock: 0 };

  const recent = events.slice(-Math.min(10, events.length));
  const s = avg(recent.map(e => clamp(e.sentiment ?? 0, -1, 1)));
  const n = avg(recent.map(e => clamp(e.novelty ?? 0, 0, 1)));
  const r = avg(recent.map(e => clamp(e.reliability ?? 0.5, 0, 1)));
  // Volume shock proxy: normalized count in recent 30 min window
  const thirtyMinAgo = now - 30 * 60 * 1000;
  const volCount = events.filter(e => e.ts >= thirtyMinAgo).length;
  const volumeShock = Math.min(1, volCount / 10);
  return { sentiment: s, novelty: n, reliability: r, volumeShock };
}

function avg(xs: number[]): number {
  if (!xs.length) return 0;
  return xs.reduce((a, b) => a + b, 0) / xs.length;
}

function clamp(x: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, x));
}

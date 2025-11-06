import type { UnifiedNewsEvent } from '../../data/news/types.js';
import { computeBasicFeatures, type FeatureWeights } from './features.js';

export interface TopicBoosts {
  hack?: number;
  regulatory?: number;
  etf?: number;
  listing?: number;
  [k: string]: number | undefined;
}

export interface DecayConfig {
  halflifeMinutesByTopic?: Record<string, number>;
}

export function scoreEvents(
  events: UnifiedNewsEvent[],
  weights: FeatureWeights,
  topicBoosts: TopicBoosts = {},
  now: number = Date.now()
): {
  score: number;
  components: ReturnType<typeof computeBasicFeatures>;
  topicFlags: Record<string, boolean>;
} {
  const components = computeBasicFeatures(events, { now });
  const base =
    weights.sentiment * components.sentiment +
    weights.novelty * components.novelty +
    weights.reliability * components.reliability +
    weights.volumeShock * components.volumeShock;

  const flags: Record<string, boolean> = {};
  for (const ev of events) {
    for (const t of ev.topics || []) flags[t] = true;
  }
  const boost = Object.entries(topicBoosts).reduce(
    (acc, [k, v]) => (flags[k] ? acc + (v ?? 0) : acc),
    0
  );
  const score = base + boost;
  return { score, components, topicFlags: flags };
}

export function applyTimeDecay(
  value: number,
  events: UnifiedNewsEvent[],
  decayCfg: DecayConfig,
  now: number = Date.now()
): number {
  if (!events.length) return value;
  const halflifeDefault = decayCfg.halflifeMinutesByTopic?.default ?? 30;
  // Use slowest decay among present topics to be conservative
  const topics = new Set<string>();
  for (const e of events) for (const t of e.topics || []) topics.add(t);
  let halflife = halflifeDefault;
  topics.forEach(t => {
    const h = decayCfg.halflifeMinutesByTopic?.[t];
    if (typeof h === 'number') halflife = Math.max(halflife, h);
  });
  const tauMs = (halflife * 60 * 1000) / Math.log(2);
  const lastTs = Math.max(...events.map(e => e.ts));
  const dt = Math.max(0, now - lastTs);
  const decayed = value * Math.exp(-dt / tauMs);
  return decayed;
}

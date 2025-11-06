import type { UnifiedNewsEvent } from '../data/news/types.js';

const TOPIC_RULES: Array<{ re: RegExp; topic: string; sentiment?: number }>[] = [
  [
    { re: /hack|exploit|bridge\s+attack|security breach/i, topic: 'hack', sentiment: -0.8 },
    { re: /outage|halt|downtime|status:\s*degraded/i, topic: 'outage', sentiment: -0.6 },
    { re: /sec|cftc|regulator|lawsuit|probe|ban|restrict/i, topic: 'regulatory', sentiment: -0.3 },
    { re: /etf|approval|filing|sec approval/i, topic: 'etf', sentiment: 0.4 },
    { re: /listing|list on|adds support/i, topic: 'listing', sentiment: 0.3 },
  ],
];

export function annotateTopicsAndSentiment(ev: UnifiedNewsEvent): UnifiedNewsEvent {
  const text = `${ev.title} ${ev.body || ''}`;
  const topics = new Set(ev.topics || []);
  let sentiment = ev.sentiment ?? 0;
  for (const group of TOPIC_RULES) {
    for (const rule of group) {
      if (rule.re.test(text)) {
        topics.add(rule.topic);
        if (typeof rule.sentiment === 'number') {
          // accumulate small adjustments
          sentiment += rule.sentiment * 0.5;
        }
      }
    }
  }
  // clamp sentiment
  if (sentiment > 1) sentiment = 1;
  if (sentiment < -1) sentiment = -1;
  return { ...ev, topics: Array.from(topics), sentiment };
}

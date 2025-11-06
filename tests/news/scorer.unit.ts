import assert from 'node:assert';
import { scoreEvents, applyTimeDecay } from '../../src/analytics/news/scorer.js';

describe('news scorer', () => {
  it('scores positive ETF topic higher', () => {
    const now = Date.now();
    const events = [
      {
        id: '1',
        ts: now - 10_000,
        source: 't',
        title: 'ETF approval',
        entities: [],
        topics: ['etf'],
      },
    ] as any[];
    const { score } = scoreEvents(
      events,
      { sentiment: 0.5, novelty: 0.2, reliability: 0.2, volumeShock: 0.1 },
      { etf: 0.6 },
      now
    );
    assert.ok(score > 0.1);
    const decayed = applyTimeDecay(
      score,
      events as any,
      { halflifeMinutesByTopic: { default: 30 } },
      now + 30 * 60 * 1000
    );
    assert.ok(decayed < score);
  });
});

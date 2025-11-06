import { BaseStrategy, type StrategyContext, type StrategyResult } from './base-strategy.js';
import type { UnifiedNewsEvent } from '../data/news/types.js';
import { scoreEvents, applyTimeDecay, type TopicBoosts } from '../analytics/news/scorer.js';

interface NewsAlphaParams {
  weights: { sentiment: number; novelty: number; reliability: number; volumeShock: number };
  topicBoosts: TopicBoosts;
  halflifeMinutesByTopic?: Record<string, number>;
  minScore?: number;
  killSwitch?: { outage?: boolean; hack?: boolean };
}

export class NewsAlphaStrategy extends BaseStrategy {
  constructor(params: Partial<NewsAlphaParams> = {}) {
    super({
      name: 'news-alpha',
      description: 'Generates signals from aggregated news events',
      enabled: true,
      params: {
        weights: {
          sentiment: 0.5,
          novelty: 0.2,
          reliability: 0.2,
          volumeShock: 0.1,
          ...(params as any)?.weights,
        },
        topicBoosts: {
          hack: -0.5,
          regulatory: -0.2,
          etf: 0.6,
          listing: 0.4,
          ...(params as any)?.topicBoosts,
        },
        halflifeMinutesByTopic: { default: 30, ...(params as any)?.halflifeMinutesByTopic },
        minScore: (params as any)?.minScore ?? 0.1,
        killSwitch: { outage: true, hack: true, ...(params as any)?.killSwitch },
      },
    });
  }

  async generateSignals(context: StrategyContext): Promise<StrategyResult> {
    const { marketData } = context;
    const coins = Array.from(new Set(marketData.map(md => md.coin)));
    const now = Date.now();
    const params = this.getConfig().params as NewsAlphaParams;
    const signals: any[] = [];

    // Expect upstream workflow stage to place aggregated events into context-like structure.
    // We read from a global attached field if available via (context as any).
    const cycleNews: Record<string, UnifiedNewsEvent[]> = (context as any)?.newsBySymbol || {};

    for (const coin of coins) {
      const symbol = `${coin}/USDT`;
      const events = cycleNews[symbol] || [];
      if (!events.length) continue;
      const { score, components, topicFlags } = scoreEvents(
        events,
        params.weights,
        params.topicBoosts,
        now
      );
      const decayed = applyTimeDecay(
        score,
        events,
        { halflifeMinutesByTopic: params.halflifeMinutesByTopic },
        now
      );
      if (Math.abs(decayed) < (params.minScore ?? 0.1)) continue;

      // Kill switches for negative operational risk topics
      if (
        (params.killSwitch?.hack && topicFlags['hack']) ||
        (params.killSwitch?.outage && topicFlags['outage'])
      ) {
        // Only allow protective sells; cap confidence
        if (decayed > 0) continue;
        const direction = 'sell';
        const confidence = Math.min(0.5, Math.max(0.1, Math.abs(decayed)));
        signals.push({
          coin,
          type: direction,
          confidence,
          reason: `news_alpha(kill) score=${decayed.toFixed(3)} topics=${Object.keys(topicFlags).join(',')}`,
        });
        continue;
      }

      const direction = decayed >= 0 ? 'buy' : 'sell';
      const confidence = Math.min(0.99, Math.max(0.01, Math.abs(decayed)));
      signals.push({
        coin,
        type: direction,
        confidence,
        reason: `news_alpha score=${decayed.toFixed(3)} components=${JSON.stringify(components)} topics=${Object.keys(topicFlags).join(',')}`,
      });
    }

    return {
      signals,
      metadata: {
        strategy: 'news-alpha',
        confidence: signals.length ? 0.5 : 0,
        reasoning: 'Signals derived from minute-level news aggregation and scoring',
      },
    };
  }
}

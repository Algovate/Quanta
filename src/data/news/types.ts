export type NewsSource = 'cryptopanic' | 'rss';

export interface UnifiedNewsEvent {
  id: string;
  ts: number; // epoch ms
  source: NewsSource | string;
  title: string;
  body?: string;
  url?: string;
  // Entities mapped to tradable symbols (e.g., BTC/USDT)
  entities: Array<{ symbol: string; confidence: number }>;
  // High-level topics
  topics: Array<'regulatory' | 'hack' | 'listing' | 'etf' | 'outage' | 'macro' | string>;
  // Scores normalized to [0,1] or [-1,1]
  sentiment?: number; // [-1, 1]
  reliability?: number; // [0, 1]
  novelty?: number; // [0, 1]
  meta?: Record<string, unknown>;
}

export interface NewsIngestionConfig {
  enabled: boolean;
  pollIntervalMs: number; // 30-60s typical
  sources: string[]; // e.g., ["cryptopanic", "rss:coindesk"]
  cycleWindowMinutes?: number; // default 3
  deliveryLagSeconds?: number; // safety lag for backtests/live
  llm?: {
    enabledLLM?: boolean;
    triggers?: { minReliability?: number; topics?: string[] };
    budget?: { dailyUSD?: number; rpm?: number };
    provider?: { use?: 'openrouter' | 'openai' | 'dashscope' | 'deepseek'; model?: string };
    force?: boolean;
  };
}

export interface NewsAdapter {
  readonly name: string;
  fetchSince(sinceTs: number): Promise<UnifiedNewsEvent[]>;
}

export interface NewsStoreItem {
  event: UnifiedNewsEvent;
  receivedTs: number;
}

export interface CycleNewsAggregate {
  symbol: string;
  windowStart: number;
  windowEnd: number;
  score: number;
  components: {
    sentiment: number;
    novelty: number;
    reliability: number;
    volumeShock: number;
  };
  topicFlags: Record<string, boolean>;
  events: UnifiedNewsEvent[];
}

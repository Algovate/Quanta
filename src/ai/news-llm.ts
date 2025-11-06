import type { UnifiedNewsEvent } from '../data/news/types.js';

export type LLMProvider = 'openrouter' | 'openai' | 'dashscope' | 'deepseek';

export interface LLMNewsConfig {
  enabledLLM?: boolean;
  triggers?: { minReliability?: number; topics?: string[] };
  budget?: { dailyUSD?: number; rpm?: number };
  provider?: { use?: LLMProvider; model?: string };
  force?: boolean; // CLI override
}

type CacheEntry = { enriched: UnifiedNewsEvent; ts: number };

const cache: Map<string, CacheEntry> = new Map();
let lastReset = Date.now();
let spentUSD = 0;
let tokens = 0;

function resetDailyBudget(): void {
  const now = Date.now();
  const day = 24 * 60 * 60 * 1000;
  if (now - lastReset > day) {
    lastReset = now;
    spentUSD = 0;
  }
}

function tryConsumeRPM(_rpm: number | undefined): boolean {
  if (tokens < 1) return false;
  tokens -= 1;
  return true;
}

export function tickRPMBucket(rpm?: number): void {
  const bucket = Math.max(1, rpm ?? 10);
  tokens = Math.min(bucket, tokens + 1);
}

export function shouldUseLLM(event: UnifiedNewsEvent, cfg?: LLMNewsConfig): boolean {
  if (!cfg?.enabledLLM && !cfg?.force) return false;
  const minRel = cfg?.triggers?.minReliability ?? 0.6;
  const topics = new Set(
    (cfg?.triggers?.topics ?? ['hack', 'etf', 'regulatory']).map(s => s.toLowerCase())
  );
  const hasTopic = (event.topics || []).some(t => topics.has(String(t).toLowerCase()));
  return (event.reliability ?? 0.5) >= minRel || hasTopic;
}

export async function enrichWithLLM(
  event: UnifiedNewsEvent,
  cfg?: LLMNewsConfig
): Promise<UnifiedNewsEvent> {
  try {
    if (!shouldUseLLM(event, cfg)) {
      return {
        ...event,
        meta: { ...(event.meta || {}), llm: { used: false, reason: 'not_triggered' } },
      };
    }

    // Budget controls
    resetDailyBudget();
    const maxUSD = cfg?.budget?.dailyUSD ?? 1.0;
    if (spentUSD >= maxUSD) {
      return {
        ...event,
        meta: { ...(event.meta || {}), llm: { used: false, reason: 'budget_exceeded' } },
      };
    }
    if (!tryConsumeRPM(cfg?.budget?.rpm)) {
      return {
        ...event,
        meta: { ...(event.meta || {}), llm: { used: false, reason: 'rate_limited' } },
      };
    }

    const key = `${cfg?.provider?.use || 'openrouter'}:${cfg?.provider?.model || 'deepseek/deepseek-chat-v3-0324'}:${event.source}:${event.id}`;
    const hit = cache.get(key);
    if (hit)
      return {
        ...hit.enriched,
        meta: { ...(hit.enriched.meta || {}), llm: { used: true, reason: 'cache_hit' } },
      };

    // Placeholder: call provider here. For now, refine heuristically to keep offline-safe.
    const text = `${event.title} ${event.body || ''}`.toLowerCase();
    let sentiment = event.sentiment ?? 0;
    if (/hack|exploit|breach/.test(text)) sentiment = Math.min(sentiment, -0.8);
    if (/approval|etf/.test(text)) sentiment = Math.max(sentiment, 0.6);
    const reliability = Math.max(event.reliability ?? 0.5, 0.7);
    const topics = Array.from(new Set([...(event.topics || [])]));
    const enriched: UnifiedNewsEvent = {
      ...event,
      sentiment,
      reliability,
      topics,
      meta: { ...(event.meta || {}), llm: { used: true, reason: 'enriched' } },
    };

    // Assume cost per call ~$0.01 for budgeting purposes (adjust if real calls are wired)
    spentUSD += 0.01;
    cache.set(key, { enriched, ts: Date.now() });
    return enriched;
  } catch {
    return { ...event, meta: { ...(event.meta || {}), llm: { used: false, reason: 'error' } } }; // fail closed
  }
}

import type { CycleIO, StageResult, WorkflowContext, WorkflowStage } from '../workflow-types.js';
import type { UnifiedNewsEvent } from '../../data/news/types.js';

export class FetchNewsDataStage implements WorkflowStage {
  name = 'fetch_news_data';

  async run(operationId: string, ctx: WorkflowContext, _io: CycleIO): Promise<StageResult> {
    const { config, unifiedLogger } = ctx;
    const newsCfg = (
      config as unknown as {
        data?: {
          news?: { enabled?: boolean; cycleWindowMinutes?: number; deliveryLagSeconds?: number };
        };
        coins?: string[];
      }
    ).data?.news;
    if (!newsCfg?.enabled) {
      return {};
    }

    const windowMinutes: number = newsCfg.cycleWindowMinutes ?? 3;
    const deliveryLagSec: number = newsCfg.deliveryLagSeconds ?? 10;
    const store = (
      ctx as unknown as {
        newsStore?: {
          getWindow: (symbols: string[], fromTs: number, toTs: number) => UnifiedNewsEvent[];
        };
      }
    ).newsStore;
    if (!store) {
      return {};
    }

    const now = Date.now();
    const cycleStart = now; // approximation; backtest can override via context
    const windowStart = cycleStart - windowMinutes * 60 * 1000;
    const usableCutoff = cycleStart - deliveryLagSec * 1000;

    const symbols = (config.coins || []).map((c: string) => `${c}/USDT`);
    const events = store.getWindow(symbols, windowStart, usableCutoff);

    unifiedLogger.startStage(operationId, this.name, {
      windowMinutes,
      events: events.length,
    });

    // Avoid extending CycleIO shape; downstream can access ctx.newsStore directly
    return {};
  }
}

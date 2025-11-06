import type { CycleIO, StageResult, WorkflowContext, WorkflowStage } from '../workflow-types.js';
import { toError } from '../../utils/error-handler.js';

export class FetchMarketDataStage implements WorkflowStage {
  name = 'fetch_market_data';

  async run(operationId: string, ctx: WorkflowContext, io: CycleIO): Promise<StageResult> {
    const { config, marketDataFetcher, snapshotService, unifiedLogger, loggerContext } = ctx;
    const coins = config.coins;
    const timeframes = config.marketTimeframes ?? ['3m', '1h', '4h'];

    unifiedLogger.startStage(operationId, this.name, { coins, timeframes });

    const start = Date.now();
    try {
      const result = await marketDataFetcher.fetchMarketData({
        coins,
        timeframes,
        tickerCache: io.tickerCache,
        snapshotService,
        unifiedLogger,
        loggerContext,
        parallel: config.marketFetchParallel !== false,
      });

      const duration = Date.now() - start;
      unifiedLogger.completeStage(operationId, this.name, {
        itemsCount: result.marketData.length,
        successCount: result.successCount,
        failCount: result.failCount,
        duration,
      });

      return {
        ioDelta: {
          marketData: result.marketData,
          marketMeta: {
            successCount: result.successCount,
            failCount: result.failCount,
            fetchMs: duration,
          },
        },
      };
    } catch (error) {
      const err = toError(error);
      unifiedLogger.recordError(err, {
        cycleId: (ctx as any)?.getState?.()?.cycleCount ?? 0,
        operationId,
      });
      unifiedLogger.completeStage(operationId, this.name, undefined, err);
      return { abort: { reason: 'fetch_market_data_failed', error: err } };
    }
  }
}

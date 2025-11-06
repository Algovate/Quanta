import type { CycleIO, StageResult, WorkflowContext, WorkflowStage } from '../workflow-types.js';
import { toError } from '../../utils/error-handler.js';

export class MonitorPositionsStage implements WorkflowStage {
  name = 'monitor_positions';

  async run(operationId: string, ctx: WorkflowContext, io: CycleIO): Promise<StageResult> {
    const { unifiedLogger, positionMonitor, snapshotService, loggerContext } = ctx;
    const positions = io.positions || [];

    unifiedLogger.startStage(operationId, this.name, { positionsCount: positions.length });

    if (positions.length === 0) {
      unifiedLogger.completeStage(operationId, this.name, { duration: 0 });
      return { ioDelta: {} };
    }

    const start = Date.now();
    const getTickerPrice = async (symbol: string): Promise<number | undefined> => {
      try {
        const ticker = await snapshotService.getTicker(symbol);
        return ticker?.price;
      } catch {
        return undefined;
      }
    };

    try {
      await positionMonitor.monitorPositions(positions, ctx.exchange, getTickerPrice);
      const duration = Date.now() - start;
      unifiedLogger.completeStage(operationId, this.name, { duration });
      return { ioDelta: {} };
    } catch (error) {
      const err = toError(error);
      unifiedLogger.recordError(err, {
        cycleId: (ctx as any)?.getState?.()?.cycleCount ?? 0,
        operationId,
      });
      unifiedLogger.completeStage(operationId, this.name, undefined, err);
      unifiedLogger.warn('Monitor positions stage failed', { error: err.message }, loggerContext);
      return { abort: { reason: 'monitor_positions_failed', error: err } };
    }
  }
}

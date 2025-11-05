import type { CycleIO, StageResult, WorkflowContext, WorkflowStage } from '../workflow-types.js';

export class ProcessSignalsStage implements WorkflowStage {
  name = 'process_signals';

  async run(operationId: string, ctx: WorkflowContext, io: CycleIO): Promise<StageResult> {
    const { unifiedLogger, loggerContext, snapshotService } = ctx as unknown as WorkflowContext & {
      signalProcessor?: any;
    };

    const signals = io.signals || [];
    unifiedLogger.startStage(operationId, this.name, { signalCount: signals.length });

    try {
      if (signals.length > 0 && ctx.signalProcessor) {
        await ctx.signalProcessor.processSignals(signals, {
          isBackgroundMode: false,
          tickerCache: io.tickerCache,
          snapshotService,
          unifiedLogger,
          loggerContext,
          eventBus: ctx.eventBus,
          emitLog: () => {},
        });
      }
      unifiedLogger.completeStage(operationId, this.name, { processed: signals.length });
      return { ioDelta: {} };
    } catch (error) {
      const err = error instanceof Error ? error : new Error(String(error));
      unifiedLogger.recordError(err, {
        cycleId: (ctx as any)?.getState?.()?.cycleCount ?? 0,
        operationId,
      });
      unifiedLogger.completeStage(operationId, this.name, undefined, err);
      return { abort: { reason: 'process_signals_failed', error: err } };
    }
  }
}

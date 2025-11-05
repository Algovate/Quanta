import type { CycleIO, StageResult, WorkflowContext, WorkflowStage } from '../workflow-types.js';

export class GenerateSignalsStage implements WorkflowStage {
  name = 'generate_signals';

  async run(operationId: string, ctx: WorkflowContext, io: CycleIO): Promise<StageResult> {
    const { unifiedLogger, aiAgent, config } = ctx;
    const marketData = io.marketData || [];

    unifiedLogger.startStage(operationId, this.name, {
      marketDataCount: marketData.length,
    });

    const context = {
      startTime: Date.now(),
      currentTime: Date.now(),
      invokeCount: 0,
      tradableCoins: config.coins,
      maxPositions: config.maxPositions,
      maxRiskPerTrade: config.riskParams.maxRiskPerTrade,
      maxLeverage: config.riskParams.maxLeverage,
      minLeverage: config.riskParams.minLeverage,
      defaultStopLoss: config.riskParams.defaultStopLoss,
      promptOptions: {
        candles3m: config.ai?.prompt?.candles?.m3 ?? 10,
        candles1h: config.ai?.prompt?.candles?.h1 ?? 8,
        candles4h: config.ai?.prompt?.candles?.h4 ?? 5,
        sections: {
          candlesTA: config.ai?.prompt?.sections?.candlesTA ?? true,
          sentiment: config.ai?.prompt?.sections?.sentiment ?? true,
          technicalState: config.ai?.prompt?.sections?.technicalState ?? true,
        },
      },
    } as any;

    const start = Date.now();
    try {
      const signals = await aiAgent.generateTradingSignal(
        marketData as any,
        io.account as any,
        io.positions as any,
        context,
        []
      );
      const duration = Date.now() - start;
      unifiedLogger.recordAPILatency('ai.generateSignal', duration);
      unifiedLogger.completeStage(operationId, this.name, {
        signalCount: signals.length,
        duration,
      });

      // Emit signals generated event for parity with legacy path
      if (ctx.emitEvent) {
        ctx.emitEvent('cycle:signals', {
          cycleCount: (ctx.getState?.()?.cycleCount as number) ?? 0,
          timestamp: Date.now(),
          signalCount: signals.length,
          signals: signals.map((s: any) => ({
            coin: s.coin,
            action: s.action,
            confidence: s.confidence,
          })),
        });
      }
      return { ioDelta: { signals } };
    } catch (error) {
      const err = error instanceof Error ? error : new Error(String(error));
      unifiedLogger.recordError(err, {
        cycleId: (ctx as any)?.getState?.()?.cycleCount ?? 0,
        operationId,
      });
      unifiedLogger.completeStage(operationId, this.name, undefined, err);
      return { abort: { reason: 'generate_signals_failed', error: err } };
    }
  }
}

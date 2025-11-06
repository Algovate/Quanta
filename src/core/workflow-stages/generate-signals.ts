import type { CycleIO, StageResult, WorkflowContext, WorkflowStage } from '../workflow-types.js';
import type { TradingSignal } from '../../types/index.js';
import { AIClientError } from '../../ai/agent.js';
import { toError } from '../../utils/error-handler.js';

export class GenerateSignalsStage implements WorkflowStage {
  name = 'generate_signals';

  async run(operationId: string, ctx: WorkflowContext, io: CycleIO): Promise<StageResult> {
    const { unifiedLogger, strategy, aiAgent, config } = ctx;
    const marketData = io.marketData || [];

    unifiedLogger.startStage(operationId, this.name, {
      marketDataCount: marketData.length,
      usingStrategy: !!strategy,
    });

    const start = Date.now();
    try {
      let signals: TradingSignal[];

      // Use strategy if available, otherwise fall back to direct AI agent call
      if (strategy) {
        // Use strategy pattern
        const strategyContext = {
          account: io.account,
          positions: io.positions,
          marketData: marketData as any,
          cycleCount: (ctx.getState?.()?.cycleCount as number) ?? 0,
          timestamp: Date.now(),
        };

        const strategyResult = await strategy.generateSignals(strategyContext);
        signals = strategyResult.signals;
      } else {
        // Fallback to direct AI agent call when strategy is not provided
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

        signals = await aiAgent.generateTradingSignal(
          marketData as any,
          io.account as any,
          io.positions as any,
          context,
          []
        );
      }

      const duration = Date.now() - start;
      unifiedLogger.recordAPILatency('ai.generateSignal', duration);
      unifiedLogger.completeStage(operationId, this.name, {
        signalCount: signals.length,
        duration,
      });

      // Emit signals generated event for event bus subscribers
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
      const err = toError(error);

      // If this is an AIClientError, propagate it to stop the workflow
      if (error instanceof AIClientError) {
        unifiedLogger.recordError(err, {
          cycleId: (ctx as any)?.getState?.()?.cycleCount ?? 0,
          operationId,
        });
        unifiedLogger.completeStage(operationId, this.name, undefined, err);

        // Return abort with special flag to indicate workflow should stop
        return { abort: { reason: 'ai_client_error', error: err, stopWorkflow: true } };
      }

      // For other errors, log and abort normally
      unifiedLogger.recordError(err, {
        cycleId: (ctx as any)?.getState?.()?.cycleCount ?? 0,
        operationId,
      });
      unifiedLogger.completeStage(operationId, this.name, undefined, err);
      return { abort: { reason: 'generate_signals_failed', error: err } };
    }
  }
}

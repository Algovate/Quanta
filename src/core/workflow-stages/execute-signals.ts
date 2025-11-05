import type { CycleIO, StageResult, WorkflowContext, WorkflowStage } from '../workflow-types.js';
import { createTickerPriceGetter } from '../../utils/ticker-cache.js';
import { CycleEvents } from '../cycle-events.js';

export class ExecuteSignalsStage implements WorkflowStage {
  name = 'execute_signals';

  async run(operationId: string, ctx: WorkflowContext, io: CycleIO): Promise<StageResult> {
    const {
      unifiedLogger,
      riskManager,
      snapshotService,
      loggerContext,
      executeSignalFn,
      emitLog,
      emitEvent,
    } = ctx;
    const signals = io.signals || [];
    const marketData = io.marketData || [];

    if (!executeSignalFn || !emitLog || !emitEvent) {
      return { abort: { reason: 'Missing required helpers in context' } };
    }

    unifiedLogger.startStage(operationId, this.name, {
      signalCount: signals.length,
      actionableSignals: signals.filter(s => s.action !== 'HOLD').length,
    });

    const start = Date.now();
    const getCachedPrice = createTickerPriceGetter(
      io.tickerCache,
      snapshotService,
      unifiedLogger,
      loggerContext
    );

    // Calculate signal quality scores and sort signals by quality
    const signalsWithQuality = signals.map(signal => {
      const coinMarketData = marketData.find((md: any) => md.coin === signal.coin);
      const indicators = coinMarketData?.indicators;

      const coinMultiTimeframeData = marketData
        .filter((md: any) => md.coin === signal.coin)
        .map((md: any) => ({
          timeframe: md.timeframe,
          trend: md.trend,
          indicators: md.indicators,
        }));

      const qualityScore = riskManager
        .getSignalValidator()
        .calculateSignalQuality(signal, indicators, coinMultiTimeframeData);

      return {
        signal,
        qualityScore,
        combinedScore: signal.confidence * 0.6 + qualityScore.score * 0.4,
      };
    });

    signalsWithQuality.sort((a, b) => b.combinedScore - a.combinedScore);

    // Log signal quality scores
    for (const { signal, qualityScore, combinedScore } of signalsWithQuality) {
      unifiedLogger.debug(
        `Signal quality score for ${signal.coin} ${signal.action}`,
        {
          coin: signal.coin,
          action: signal.action,
          confidence: signal.confidence,
          qualityScore: qualityScore.score,
          combinedScore,
          factors: qualityScore.factors,
          breakdown: qualityScore.breakdown,
        },
        loggerContext
      );
    }

    const signalDecisionInfos: any[] = [];
    let currentPositions = io.positions;
    let currentAccount = io.account;
    let totalTrades = 0;

    // Execute signals sequentially, prioritized by quality
    for (const { signal } of signalsWithQuality) {
      const symbol = `${signal.coin}/USDT`;
      const currentPrice = await getCachedPrice(symbol);

      if (currentPrice === undefined || currentPrice <= 0) {
        emitLog(
          'warn',
          `⚠️  ${signal.coin}: Skipping signal execution - price unavailable (${currentPrice === undefined ? 'undefined' : `$${currentPrice.toFixed(2)}`})`
        );
        unifiedLogger.warn(
          'Signal execution skipped due to unavailable price',
          {
            coin: signal.coin,
            symbol,
            action: signal.action,
            price: currentPrice,
          },
          loggerContext
        );
        signalDecisionInfos.push({
          coin: signal.coin,
          action: signal.action,
          validation: { passed: false, reason: 'Price unavailable' },
          sizing: { passed: false },
          execution: { expectedPrice: currentPrice ?? undefined },
        });
        continue;
      }

      const coinMarketData = marketData.find(
        (md: any) => md.coin === signal.coin && md.timeframe === '3m'
      );
      const atr14 = coinMarketData?.indicators?.atr14;
      const indicators = coinMarketData?.indicators;

      const result = await executeSignalFn(
        operationId,
        signal,
        currentAccount,
        currentPositions,
        io.tickerCache,
        currentPrice,
        atr14,
        indicators
      );

      if (result.decisionInfo) {
        signalDecisionInfos.push(result.decisionInfo);
      }

      if (result.success) {
        totalTrades++;
      }

      // Refresh positions and account after successful signal execution
      if (
        result.success &&
        (signal.action === 'LONG' || signal.action === 'SHORT' || signal.action === 'CLOSE')
      ) {
        try {
          const snapshot = await snapshotService.getSnapshot();
          currentPositions = snapshot.positions;
          currentAccount = snapshot.account;
        } catch (error) {
          unifiedLogger.warn(
            'Failed to refresh positions after signal execution - aborting remaining signals',
            {
              coin: signal.coin,
              action: signal.action,
              error: error instanceof Error ? error.message : String(error),
            },
            loggerContext
          );
          break;
        }
      }
    }

    const duration = Date.now() - start;

    // Emit execution phase event
    emitEvent(CycleEvents.Execution, {
      cycleCount: ctx.getState?.()?.cycleCount || 0,
      timestamp: Date.now(),
      executedSignals: signals.filter((s: any) => s.action !== 'HOLD').length,
      totalTrades: ctx.getState?.()?.totalTrades || 0,
    });

    // Refresh account and positions after executing signals
    const { account: finalAccount, positions: finalPositions } =
      await snapshotService.getSnapshot();

    // Build decision path for execute_signals
    if (ctx.cycleSummaryFormatter) {
      const decisionPath =
        ctx.cycleSummaryFormatter.buildExecutionDecisionPath(signalDecisionInfos);
      unifiedLogger.appendDecisionChoice(operationId, {
        step: 'execute_signals',
        decision: decisionPath.decision,
        reason: decisionPath.reason,
        factors: decisionPath.factors,
      });
    }

    unifiedLogger.completeStage(operationId, this.name, {
      executedCount: totalTrades,
      duration,
    });

    // Aggregate validation checks from execute_signals stage
    unifiedLogger.aggregateValidationResults(operationId, 'execute_signals');

    return {
      ioDelta: {
        account: finalAccount,
        positions: finalPositions,
      },
    };
  }
}

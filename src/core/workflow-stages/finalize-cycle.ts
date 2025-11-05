import type { CycleIO, StageResult, WorkflowContext, WorkflowStage } from '../workflow-types.js';
import { aggregatePositionMetrics } from '../../execution/position-utils.js';
import { CycleEvents } from '../cycle-events.js';

export class FinalizeCycleStage implements WorkflowStage {
  name = 'finalize_cycle';

  async run(operationId: string, ctx: WorkflowContext, io: CycleIO): Promise<StageResult> {
    const {
      unifiedLogger,
      performanceMetricsCalculator,
      getState,
      updateState,
      getCircuitBreakerStates,
      getRecentOperationsSummary,
      logCycleSummary,
      emitEvent,
    } = ctx;

    const signals = io.signals || [];
    const finalAccount = io.account;
    const finalPositions = io.positions;
    const cycleStartTime = getState?.()?.cycleStartTime || Date.now();

    if (!getState || !updateState) {
      return { abort: { reason: 'Missing state management in context' } };
    }

    const state = getState();
    const tradesBefore = state.tradesBefore || 0;

    // Aggregate once per cycle for reuse
    const aggregates = aggregatePositionMetrics(finalPositions);

    // Update performance metrics with latest data
    if (performanceMetricsCalculator) {
      const metricsUpdate = performanceMetricsCalculator.updatePerformanceMetrics(
        state,
        finalAccount,
        aggregates
      );
      updateState(metricsUpdate.state);
    }

    // Record cycle execution time
    const cycleDuration = Date.now() - cycleStartTime;
    unifiedLogger.recordCycleTime(state.cycleCount, cycleDuration);

    // Log cycle summary with latest data
    const tradeCountCycle = state.totalTrades - tradesBefore;
    if (logCycleSummary) {
      logCycleSummary(finalAccount, finalPositions, signals, aggregates, {
        rejectedSignalsCycle: state.rejectedSignalsCycle || 0,
        tradeCountCycle,
      });
    }

    // Create system snapshot for state tracking
    unifiedLogger.startStage(operationId, 'create_snapshot', {});
    const circuitBreakers = getCircuitBreakerStates?.() || [];
    const recentOperations = getRecentOperationsSummary?.() || [];

    unifiedLogger.createSnapshot(
      state.cycleCount,
      {
        equity: finalAccount.equity,
        balance: finalAccount.balance,
        marginUsed: aggregates.totalMarginUsed,
        availableMargin: finalAccount.availableMargin,
      },
      finalPositions.map(p => ({
        symbol: p.symbol,
        side: p.side,
        size: p.size,
        entryPrice: p.entryPrice,
        unrealizedPnl: p.unrealizedPnl,
      })),
      circuitBreakers,
      recentOperations
    );
    unifiedLogger.completeStage(operationId, 'create_snapshot', {
      positionsCount: finalPositions.length,
    });

    // Prepare per-cycle action distribution
    const actionCounts = { LONG: 0, SHORT: 0, CLOSE: 0, HOLD: 0 } as {
      LONG: number;
      SHORT: number;
      CLOSE: number;
      HOLD: number;
    };
    for (const s of signals) {
      const a = s.action as 'LONG' | 'SHORT' | 'CLOSE' | 'HOLD';
      if (a in actionCounts) actionCounts[a]++;
    }

    // Notify cycle completion via event bus
    if (emitEvent) {
      emitEvent(CycleEvents.Complete, {
        cycleCount: state.cycleCount,
        timestamp: Date.now(),
        duration: Date.now() - (state.lastUpdate || Date.now()),
        totalSignals: state.totalSignals,
        totalTrades: state.totalTrades,
        totalPnl: state.totalPnl,
        signalCount: signals.length,
        tradeCount: state.totalTrades - tradesBefore,
        cyclePnl: state.cyclePnl ?? 0,
        actionCounts,
      });
    }

    // Complete cycle operation
    unifiedLogger.completeStage(operationId, 'cycle_start', {
      cycleCount: state.cycleCount,
    });
    unifiedLogger.completeOperation(operationId, 'completed', {
      cycleCount: state.cycleCount,
      duration: cycleDuration,
      signalsGenerated: signals.length,
      tradesExecuted: tradeCountCycle,
      totalPnl: state.totalPnl,
    });

    return { ioDelta: {} };
  }
}

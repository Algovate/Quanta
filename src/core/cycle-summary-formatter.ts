/**
 * Cycle Summary Formatter - Handles formatting and summary generation for trading cycles
 */

import type { TradingSignal } from '../types/index.js';
import type { Account, Position } from '../exchange/types.js';
import type { PositionAggregates } from '../execution/position-utils.js';
import type { PnLMetrics } from './performance-metrics-calculator.js';
import { CycleDisplay } from './display/index.js';

export interface SignalDecisionInfo {
  coin: string;
  action: string;
  validation: { passed: boolean; reason?: string };
  sizing: {
    passed: boolean;
    leverage?: number;
    suggestedSize?: number;
    riskAmount?: number;
    regime?: string;
    atrAdjustment?: number;
  };
  execution: {
    expectedPrice: number;
    actualPrice?: number;
    slippage?: number;
    slippageAbs?: number;
    orderId?: string;
  };
}

export interface CycleMetrics {
  signalsCount: number;
  executedTrades: number;
  rejectedSignals: number;
  openPositions: number;
  maxPositions: number;
  efficiency: number;
  marginUsage: number;
  riskLevel: 'LOW' | 'MEDIUM' | 'HIGH';
  averageLeverage: number;
}

export interface RuntimeMetrics {
  minutes: number;
  seconds: number;
  string: string;
}

/**
 * CycleSummaryFormatter - Formats and generates summaries for trading cycles
 */
export class CycleSummaryFormatter {
  private cycleDisplay: CycleDisplay;

  constructor() {
    this.cycleDisplay = new CycleDisplay();
  }

  /**
   * Build decision string from signals grouped by action
   */
  buildSignalDecisionString(signals: TradingSignal[]): string {
    const signalsByAction: Record<string, Array<{ coin: string; confidence: number }>> = {};

    for (const signal of signals) {
      if (!signalsByAction[signal.action]) {
        signalsByAction[signal.action] = [];
      }
      signalsByAction[signal.action].push({
        coin: signal.coin,
        confidence: signal.confidence,
      });
    }

    const decisionParts: string[] = [];
    for (const [action, signalList] of Object.entries(signalsByAction)) {
      const signalSummary = signalList
        .map(s => `${s.coin}(${(s.confidence * 100).toFixed(0)}%)`)
        .join(', ');
      decisionParts.push(`${action}: ${signalSummary}`);
    }

    return decisionParts.join('; ');
  }

  /**
   * Build decision reason with AI reasoning summary
   */
  buildSignalDecisionReason(signals: TradingSignal[], marketDataCount: number): string {
    const reasonParts: string[] = [
      `Generated ${signals.length} signals from ${marketDataCount} market data items`,
    ];

    const reasoningSummary = this.extractAIReasoningSummary(signals);
    if (reasoningSummary) {
      reasonParts.push(`Key reasoning: ${reasoningSummary}`);
    }

    return reasonParts.join('\n');
  }

  /**
   * Extract AI reasoning summary from primary signals (non-HOLD signals have priority)
   */
  extractAIReasoningSummary(signals: TradingSignal[], maxLength: number = 150): string | null {
    const primarySignals = signals.filter(s => s.action !== 'HOLD');
    const reasoningSource = primarySignals.length > 0 ? primarySignals : signals;

    // Select the highest confidence signal's reasoning
    const bestSignal = reasoningSource.sort((a, b) => b.confidence - a.confidence)[0];

    if (!bestSignal?.reasoning) {
      return null;
    }

    // Extract key reasoning (first maxLength characters or until sentence end)
    let reasoningSummary = bestSignal.reasoning.trim();
    if (reasoningSummary.length > maxLength) {
      // Try to cut at sentence boundary
      const sentenceEnd = reasoningSummary.substring(0, maxLength).lastIndexOf('.');
      if (sentenceEnd > maxLength * 0.67) {
        // Only cut at sentence if it's reasonably far into the text (2/3 of maxLength)
        reasoningSummary = reasoningSummary.substring(0, sentenceEnd + 1);
      } else {
        reasoningSummary = reasoningSummary.substring(0, maxLength) + '...';
      }
    }

    return reasoningSummary;
  }

  /**
   * Calculate confidence for primary decisions (non-HOLD signals)
   * Uses primary signals' confidence if available, otherwise uses average
   */
  calculatePrimaryDecisionConfidence(
    signals: TradingSignal[],
    _allConfidenceScores: number[],
    overallAvgConfidence: number
  ): number {
    const primarySignals = signals.filter(s => s.action !== 'HOLD');

    if (primarySignals.length === 0) {
      // If only HOLD signals, use overall average
      return overallAvgConfidence;
    }

    // Calculate average confidence of primary signals
    const primaryConfidences = primarySignals.map(s => s.confidence);
    return primaryConfidences.reduce((a, b) => a + b, 0) / primaryConfidences.length;
  }

  /**
   * Calculate runtime metrics from start time
   */
  calculateRuntimeMetrics(startTime: number): RuntimeMetrics {
    const runtime = Date.now() - startTime;
    const minutes = Math.floor(runtime / (1000 * 60));
    const seconds = Math.floor((runtime / 1000) % 60);
    return {
      minutes,
      seconds,
      string: `${minutes}m ${seconds}s`,
    };
  }

  /**
   * Calculate cycle summary metrics (efficiency, margin usage, risk level, etc.)
   */
  calculateCycleMetrics(
    account: Account,
    positions: Position[],
    signals: TradingSignal[],
    aggregates: PositionAggregates,
    cycleMetrics: { rejectedSignalsCycle: number; tradeCountCycle: number },
    maxPositions: number
  ): CycleMetrics {
    const signalsCount = signals.length;
    const executedTrades = cycleMetrics.tradeCountCycle;
    const rejectedSignals = cycleMetrics.rejectedSignalsCycle;
    const openPositions = positions.length;

    const efficiency = signalsCount > 0 ? (executedTrades / signalsCount) * 100 : 0;
    const totalMarginUsed = aggregates.totalMarginUsed;
    const marginUsage = account.equity > 0 ? (totalMarginUsed / account.equity) * 100 : 0;

    let riskLevel: 'LOW' | 'MEDIUM' | 'HIGH' = 'LOW';
    if (marginUsage >= 80) {
      riskLevel = 'HIGH';
    } else if (marginUsage >= 50) {
      riskLevel = 'MEDIUM';
    }

    const averageLeverage =
      positions.length > 0
        ? positions.reduce((sum, p) => sum + (p.leverage || 1), 0) / positions.length
        : 0;

    return {
      signalsCount,
      executedTrades,
      rejectedSignals,
      openPositions,
      maxPositions,
      efficiency,
      marginUsage,
      riskLevel,
      averageLeverage,
    };
  }

  /**
   * Calculate countdown to next cycle
   */
  calculateNextCycleCountdown(cyclePeriod: number): string {
    const nextCycleTime = Date.now() + cyclePeriod;
    const remainingMs = nextCycleTime - Date.now();
    const remainingMinutes = Math.floor(remainingMs / (1000 * 60));
    const remainingSeconds = Math.floor((remainingMs % (1000 * 60)) / 1000);
    return remainingMinutes > 0
      ? `${remainingMinutes}m ${remainingSeconds}s`
      : `${remainingSeconds}s`;
  }

  /**
   * Format cycle summary for display
   */
  formatCycleSummary(
    runtimeString: string,
    cycleCount: number,
    cycleMetrics: CycleMetrics,
    account: Account,
    positions: Position[],
    aggregates: PositionAggregates,
    pnlMetrics: PnLMetrics,
    winRate: number,
    countdown: string,
    previousEquity?: number
  ): string | undefined {
    try {
      return this.cycleDisplay.formatCycleSummary({
        runtime: runtimeString,
        cycleCount,
        signalsCount: cycleMetrics.signalsCount,
        executedTrades: cycleMetrics.executedTrades,
        rejectedSignals: cycleMetrics.rejectedSignals,
        openPositions: cycleMetrics.openPositions,
        maxPositions: cycleMetrics.maxPositions,
        efficiency: cycleMetrics.efficiency,
        account,
        positions,
        totalMarginUsed: aggregates.totalMarginUsed,
        totalUnleveredExposure: aggregates.totalUnleveredExposure,
        totalPnl: pnlMetrics.totalPnl,
        totalPnlPercent: pnlMetrics.totalPnlPercent,
        unrealizedPnl: pnlMetrics.unrealizedPnl,
        unrealizedPnlPercent: pnlMetrics.unrealizedPnlPercent,
        cyclePnl: pnlMetrics.cyclePnlChange,
        cyclePnlPercent: pnlMetrics.cyclePnlPercent,
        realizedCyclePnl: pnlMetrics.realizedCyclePnl,
        marginUsage: cycleMetrics.marginUsage,
        riskLevel: cycleMetrics.riskLevel,
        averageLeverage: cycleMetrics.averageLeverage,
        winRate,
        countdown,
        previousEquity,
      });
    } catch {
      // Return undefined if formatting fails - caller should handle error logging
      return undefined;
    }
  }

  /**
   * Build decision path for signal execution
   */
  buildExecutionDecisionPath(signalDecisionInfos: SignalDecisionInfo[]): {
    decision: string;
    reason: string;
    factors: {
      signals: SignalDecisionInfo[];
      summary: {
        total: number;
        accepted: number;
        rejectedValidation: number;
        rejectedSizing: number;
        executed: number;
      };
      validationSummary: {
        passed: number;
        failed: number;
        reasons: Array<{ coin: string; reason?: string }>;
      };
      sizingSummary: {
        passed: number;
        failed: number;
        details: Array<{
          coin: string;
          leverage?: number;
          size?: number;
          riskAmount?: number;
          regime?: string;
          atrAdjustment?: number;
        }>;
      };
      executionSummary: {
        executed: number;
        details: Array<{
          coin: string;
          expectedPrice: number;
          actualPrice?: number;
          slippage?: number;
          slippageAbs?: number;
          orderId?: string;
        }>;
      };
    };
  } {
    const acceptedSignals = signalDecisionInfos.filter(d => d.validation.passed && d.sizing.passed);
    const rejectedValidation = signalDecisionInfos.filter(d => !d.validation.passed);
    const rejectedSizing = signalDecisionInfos.filter(d => d.validation.passed && !d.sizing.passed);
    const executedSignals = signalDecisionInfos.filter(d => d.execution.orderId);

    // Build decision summary
    const decisionParts: string[] = [];
    if (acceptedSignals.length > 0) {
      const byAction: Record<string, string[]> = {};
      for (const sig of acceptedSignals) {
        if (!byAction[sig.action]) byAction[sig.action] = [];
        byAction[sig.action].push(sig.coin);
      }
      const actionSummary = Object.entries(byAction)
        .map(([action, coins]) => `${action}: ${coins.join(', ')}`)
        .join('; ');
      decisionParts.push(`Accepted: ${acceptedSignals.length} (${actionSummary})`);
    }
    if (rejectedValidation.length > 0) {
      const reasons = rejectedValidation
        .map(s => `${s.coin}(${s.validation.reason || 'unknown'})`)
        .join(', ');
      decisionParts.push(`Rejected (validation): ${rejectedValidation.length} (${reasons})`);
    }
    if (rejectedSizing.length > 0) {
      const coins = rejectedSizing.map(s => s.coin).join(', ');
      decisionParts.push(`Rejected (sizing): ${rejectedSizing.length} (${coins})`);
    }
    const decision = decisionParts.length > 0 ? decisionParts.join('; ') : 'No signals processed';

    // Build concise reason for decision path (detailed info in validation checks)
    const reasonParts: string[] = [];
    reasonParts.push(
      `Processed ${signalDecisionInfos.length} signals, executed ${executedSignals.length} orders`
    );
    if (acceptedSignals.length > 0) {
      reasonParts.push(`Accepted: ${acceptedSignals.length}`);
    }
    if (rejectedValidation.length > 0) {
      reasonParts.push(`Rejected (validation): ${rejectedValidation.length}`);
    }
    if (rejectedSizing.length > 0) {
      reasonParts.push(`Rejected (sizing): ${rejectedSizing.length}`);
    }

    const reason = reasonParts.join('\n');

    return {
      decision,
      reason,
      factors: {
        signals: signalDecisionInfos,
        summary: {
          total: signalDecisionInfos.length,
          accepted: acceptedSignals.length,
          rejectedValidation: rejectedValidation.length,
          rejectedSizing: rejectedSizing.length,
          executed: executedSignals.length,
        },
        validationSummary: {
          passed: acceptedSignals.length + rejectedSizing.length,
          failed: rejectedValidation.length,
          reasons: rejectedValidation.map(s => ({ coin: s.coin, reason: s.validation.reason })),
        },
        sizingSummary: {
          passed: acceptedSignals.length,
          failed: rejectedSizing.length,
          details: acceptedSignals.map(s => ({
            coin: s.coin,
            leverage: s.sizing.leverage,
            size: s.sizing.suggestedSize,
            riskAmount: s.sizing.riskAmount,
            regime: s.sizing.regime,
            atrAdjustment: s.sizing.atrAdjustment,
          })),
        },
        executionSummary: {
          executed: executedSignals.length,
          details: executedSignals.map(s => ({
            coin: s.coin,
            expectedPrice: s.execution.expectedPrice,
            actualPrice: s.execution.actualPrice,
            slippage: s.execution.slippage,
            slippageAbs: s.execution.slippageAbs,
            orderId: s.execution.orderId,
          })),
        },
      },
    };
  }
}

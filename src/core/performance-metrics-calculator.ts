/**
 * Performance Metrics Calculator - Handles calculation of trading performance metrics
 */

import chalk from 'chalk';
import type { Exchange } from '../exchange/types.js';
import type { Account } from '../exchange/types.js';
import type { RiskManager } from '../execution/risk.js';
import type { PositionAggregates } from '../execution/position-utils.js';
import type { UnifiedLogger } from '../logging/index.js';
import type { SystemState } from './workflow.js';

export interface PerformanceMetricsUpdate {
  state: SystemState;
  drawdownCheck?: {
    state: 'normal' | 'reduced' | 'paused';
    shouldReducePositionSize: boolean;
    shouldPauseTrading: boolean;
  };
}

export interface PnLMetrics {
  totalPnl: number;
  totalPnlPercent: number;
  totalPnlColor: (str: string) => string;
  unrealizedPnl: number;
  unrealizedPnlPercent: number;
  unrealizedPnlColor: (str: string) => string;
  cyclePnlChange: number;
  cyclePnlPercent: number;
  cyclePnlColor: (str: string) => string;
  realizedCyclePnl: number;
}

/**
 * PerformanceMetricsCalculator - Calculates and updates trading performance metrics
 */
export class PerformanceMetricsCalculator {
  constructor(
    private riskManager: RiskManager,
    private exchange: Exchange,
    private unifiedLogger: UnifiedLogger,
    private loggerContext: string
  ) {}

  /**
   * Update performance metrics including PnL, drawdown, and win rate
   */
  updatePerformanceMetrics(
    state: SystemState,
    account: Account,
    aggregates: PositionAggregates
  ): PerformanceMetricsUpdate {
    const updatedState: SystemState = { ...state };

    // Update unrealized P&L from open positions using pre-computed aggregates
    updatedState.unrealizedPnl = aggregates.totalPnl;

    // Calculate total P&L: (Current Equity - Initial Balance)
    // This includes both realized P&L from closed trades and unrealized P&L from open positions
    // Guard: ensure initialBalance is set before calculating P&L
    if (updatedState.initialBalance > 0) {
      updatedState.totalPnl = account.equity - updatedState.initialBalance;
    } else {
      // If initialBalance is not set, use 0 as default (prevents incorrect calculations)
      updatedState.totalPnl = 0;
      this.unifiedLogger.warn(
        'Cannot calculate total P&L: initial balance not set',
        {
          cycleCount: updatedState.cycleCount,
          equity: account.equity,
        },
        this.loggerContext
      );
    }

    let drawdownCheck:
      | {
          state: 'normal' | 'reduced' | 'paused';
          shouldReducePositionSize: boolean;
          shouldPauseTrading: boolean;
        }
      | undefined;

    // Update peak equity and calculate drawdown
    if (account.equity > 0) {
      // Initialize peak equity if not set
      if (!updatedState.peakEquity || updatedState.peakEquity === 0) {
        updatedState.peakEquity = account.equity;
      }

      // Update peak equity if current equity is higher
      if (account.equity > updatedState.peakEquity) {
        updatedState.peakEquity = account.equity;
      }

      // Calculate current drawdown
      const currentDrawdown = (updatedState.peakEquity - account.equity) / updatedState.peakEquity;

      // Update max drawdown if current drawdown is higher
      if (!updatedState.maxDrawdown || currentDrawdown > updatedState.maxDrawdown) {
        updatedState.maxDrawdown = currentDrawdown;
      }

      // Check drawdown protection thresholds
      const drawdownCheckResult = this.riskManager.checkDrawdownProtection(
        account.equity,
        updatedState.peakEquity,
        updatedState.maxDrawdown,
        updatedState.drawdownState
      );

      // Update drawdown state
      updatedState.drawdownState = drawdownCheckResult.state;
      drawdownCheck = {
        state: drawdownCheckResult.state,
        shouldReducePositionSize: drawdownCheckResult.shouldReducePositionSize,
        shouldPauseTrading: drawdownCheckResult.shouldPauseTrading,
      };

      // Log drawdown warnings if needed
      if (drawdownCheckResult.shouldReducePositionSize || drawdownCheckResult.shouldPauseTrading) {
        this.unifiedLogger.warn(
          'Drawdown protection activated',
          {
            currentDrawdown: (currentDrawdown * 100).toFixed(2) + '%',
            maxDrawdown: (updatedState.maxDrawdown * 100).toFixed(2) + '%',
            state: drawdownCheckResult.state,
            action: drawdownCheckResult.shouldPauseTrading ? 'pause' : 'reduce',
          },
          this.loggerContext
        );
      }
    }

    // Calculate win rate from completed trades
    updatedState.winRate = this.calculateWinRate(state);

    // Update performance tracker with completed trades for adaptive parameters
    if (this.exchange.getCompletedTrades) {
      const completedTrades = this.exchange.getCompletedTrades();
      if (completedTrades.length > 0) {
        this.riskManager.updatePerformanceStats(completedTrades);
      }
    }

    return {
      state: updatedState,
      drawdownCheck,
    };
  }

  /**
   * Calculate win rate from completed trades
   * Win rate should only be based on closed positions, not open positions
   */
  calculateWinRate(state: SystemState): number {
    // Skip if exchange doesn't support completed trades tracking
    if (!this.exchange.getCompletedTrades) {
      return state.winRate;
    }

    const completedTrades = this.exchange.getCompletedTrades();

    // No completed trades yet
    if (completedTrades.length === 0) {
      return state.totalTrades === 0 ? 0 : state.winRate;
    }

    // Calculate win rate from completed trades
    const winningTrades = completedTrades.filter(trade => trade.pnl > 0).length;
    return (winningTrades / completedTrades.length) * 100;
  }

  /**
   * Calculate and update P&L metrics for the cycle
   */
  calculatePnLMetrics(
    state: SystemState,
    account: Account,
    aggregates: PositionAggregates
  ): PnLMetrics & { updatedState: SystemState } {
    const unrealizedPnl = aggregates.totalPnl;
    const totalPnl = state.totalPnl;
    const totalPnlPercent = state.initialBalance > 0 ? (totalPnl / state.initialBalance) * 100 : 0;
    const totalPnlColor = totalPnl >= 0 ? chalk.green : chalk.red;

    const unrealizedPnlPercent = account.equity > 0 ? (unrealizedPnl / account.equity) * 100 : 0;
    const unrealizedPnlColor = unrealizedPnl >= 0 ? chalk.green : chalk.red;

    const cyclePnlChange = state.previousEquity ? account.equity - state.previousEquity : 0;
    const cyclePnlPercent = state.previousEquity
      ? (cyclePnlChange / state.previousEquity) * 100
      : 0;
    const cyclePnlColor = cyclePnlChange >= 0 ? chalk.green : chalk.red;

    const realizedCyclePnl = state.previousBalance ? account.balance - state.previousBalance : 0;

    // Update state with cycle metrics
    const updatedState: SystemState = {
      ...state,
      previousEquity: account.equity,
      cyclePnl: cyclePnlChange,
      previousBalance: account.balance,
    };

    return {
      totalPnl,
      totalPnlPercent,
      totalPnlColor,
      unrealizedPnl,
      unrealizedPnlPercent,
      unrealizedPnlColor,
      cyclePnlChange,
      cyclePnlPercent,
      cyclePnlColor,
      realizedCyclePnl,
      updatedState,
    };
  }
}

import {
  PerformanceMetrics,
  CompletedTrade,
  EquitySnapshot,
  BacktestResult,
} from '../types/index.js';

export class PerformanceAnalytics {
  /**
   * Calculate all performance metrics from a backtest result
   */
  calculateMetrics(result: BacktestResult): PerformanceMetrics {
    const initialBalance = result.config.initialBalance;
    const finalEquity = result.finalEquity;
    const trades = result.trades;
    const snapshots = result.equitySnapshots;

    return {
      totalReturn: this.calculateTotalReturn(initialBalance, finalEquity),
      totalPnL: this.calculateTotalPnL(initialBalance, finalEquity),
      annualizedReturn: this.calculateAnnualizedReturn(
        initialBalance,
        finalEquity,
        result.duration
      ),
      sharpeRatio: this.calculateSharpeRatio(result.equitySnapshots, result.duration),
      maxDrawdown: this.calculateMaxDrawdown(snapshots),
      maxDrawdownValue: this.calculateMaxDrawdownValue(snapshots),
      winRate: this.calculateWinRate(trades),
      profitFactor: this.calculateProfitFactor(trades),
      avgWin: this.calculateAvgWin(trades),
      avgLoss: this.calculateAvgLoss(trades),
      totalTrades: trades.length,
      winningTrades: trades.filter(t => t.pnl > 0).length,
      losingTrades: trades.filter(t => t.pnl < 0).length,
      avgHoldingPeriod: this.calculateAvgHoldingPeriod(trades),
      volatility: this.calculateVolatility(snapshots),
      var95: this.calculateVaR(snapshots, 0.95),
      bestTrade: this.getBestTrade(trades),
      worstTrade: this.getWorstTrade(trades),
      largestWin: this.getLargestWin(trades),
      largestLoss: this.getLargestLoss(trades),
    };
  }

  /**
   * Calculate total return as percentage
   */
  private calculateTotalReturn(initialBalance: number, finalEquity: number): number {
    return ((finalEquity - initialBalance) / initialBalance) * 100;
  }

  /**
   * Calculate total PnL
   */
  private calculateTotalPnL(initialBalance: number, finalEquity: number): number {
    return finalEquity - initialBalance;
  }

  /**
   * Calculate annualized return
   */
  private calculateAnnualizedReturn(
    initialBalance: number,
    finalEquity: number,
    durationSeconds: number
  ): number {
    const totalReturn = (finalEquity - initialBalance) / initialBalance;
    const durationYears = durationSeconds / (365 * 24 * 60 * 60);

    if (durationYears <= 0) return 0;

    return (Math.pow(1 + totalReturn, 1 / durationYears) - 1) * 100;
  }

  /**
   * Calculate Sharpe Ratio (risk-adjusted returns)
   * Uses 0% as risk-free rate for simplicity
   */
  private calculateSharpeRatio(snapshots: EquitySnapshot[], _durationSeconds: number): number {
    if (snapshots.length < 2) return 0;

    // Calculate per-period returns and infer average period length from timestamps
    const returns: number[] = [];
    const deltasSec: number[] = [];
    for (let i = 1; i < snapshots.length; i++) {
      const prev = snapshots[i - 1];
      const curr = snapshots[i];
      const r = (curr.equity - prev.equity) / prev.equity;
      returns.push(r);
      const delta = (curr.timestamp - prev.timestamp) / 1000;
      if (delta > 0 && isFinite(delta)) deltasSec.push(delta);
    }

    if (returns.length === 0 || deltasSec.length === 0) return 0;

    // Mean and standard deviation of returns
    const meanReturn = returns.reduce((s, r) => s + r, 0) / returns.length;
    const variance = returns.reduce((s, r) => s + Math.pow(r - meanReturn, 2), 0) / returns.length;
    const stdDev = Math.sqrt(variance);
    if (stdDev === 0) return 0;

    // Annualize using observed average period length
    const avgPeriodSec = deltasSec.reduce((s, d) => s + d, 0) / deltasSec.length;
    if (!isFinite(avgPeriodSec) || avgPeriodSec <= 0) return 0;
    const periodsPerYear = (365 * 24 * 60 * 60) / avgPeriodSec;

    return (meanReturn / stdDev) * Math.sqrt(periodsPerYear);
  }

  /**
   * Calculate maximum drawdown as percentage
   */
  private calculateMaxDrawdown(snapshots: EquitySnapshot[]): number {
    if (snapshots.length < 2) return 0;

    let maxEquity = snapshots[0].equity;
    let maxDrawdown = 0;

    for (let i = 1; i < snapshots.length; i++) {
      if (snapshots[i].equity > maxEquity) {
        maxEquity = snapshots[i].equity;
      }

      const drawdown = ((snapshots[i].equity - maxEquity) / maxEquity) * 100;
      if (drawdown < maxDrawdown) {
        maxDrawdown = drawdown;
      }
    }

    return maxDrawdown;
  }

  /**
   * Calculate maximum drawdown value
   */
  private calculateMaxDrawdownValue(snapshots: EquitySnapshot[]): number {
    if (snapshots.length < 2) return 0;

    let maxEquity = snapshots[0].equity;
    let maxDrawdown = 0;

    for (let i = 1; i < snapshots.length; i++) {
      if (snapshots[i].equity > maxEquity) {
        maxEquity = snapshots[i].equity;
      }

      const drawdown = snapshots[i].equity - maxEquity;
      if (drawdown < maxDrawdown) {
        maxDrawdown = drawdown;
      }
    }

    return maxDrawdown;
  }

  /**
   * Calculate win rate as percentage
   */
  private calculateWinRate(trades: CompletedTrade[]): number {
    if (trades.length === 0) return 0;
    const winningTrades = trades.filter(t => t.pnl > 0).length;
    return (winningTrades / trades.length) * 100;
  }

  /**
   * Calculate profit factor (gross profit / gross loss)
   */
  private calculateProfitFactor(trades: CompletedTrade[]): number {
    const grossProfit = trades.filter(t => t.pnl > 0).reduce((sum, t) => sum + t.pnl, 0);
    const grossLoss = Math.abs(trades.filter(t => t.pnl < 0).reduce((sum, t) => sum + t.pnl, 0));

    if (grossLoss === 0) return grossProfit > 0 ? Infinity : 0;
    return grossProfit / grossLoss;
  }

  /**
   * Calculate average winning trade
   */
  private calculateAvgWin(trades: CompletedTrade[]): number {
    const winners = trades.filter(t => t.pnl > 0);
    if (winners.length === 0) return 0;
    return winners.reduce((sum, t) => sum + t.pnl, 0) / winners.length;
  }

  /**
   * Calculate average losing trade
   */
  private calculateAvgLoss(trades: CompletedTrade[]): number {
    const losers = trades.filter(t => t.pnl < 0);
    if (losers.length === 0) return 0;
    return losers.reduce((sum, t) => sum + t.pnl, 0) / losers.length;
  }

  /**
   * Calculate average holding period in hours
   */
  private calculateAvgHoldingPeriod(trades: CompletedTrade[]): number {
    if (trades.length === 0) return 0;

    // Validate and filter out invalid holding periods
    const validTrades = trades.filter(
      t => t.holdingPeriod > 0 && t.holdingPeriod < 1000000000 // Max 1 billion seconds (31+ years)
    );

    if (validTrades.length === 0) return 0;

    const totalSeconds = validTrades.reduce((sum, t) => sum + t.holdingPeriod, 0);
    const totalHours = totalSeconds / (60 * 60);
    return totalHours / validTrades.length;
  }

  /**
   * Calculate volatility as percentage
   */
  private calculateVolatility(snapshots: EquitySnapshot[]): number {
    if (snapshots.length < 2) return 0;

    const returns: number[] = [];
    for (let i = 1; i < snapshots.length; i++) {
      const return_ = (snapshots[i].equity - snapshots[i - 1].equity) / snapshots[i - 1].equity;
      returns.push(return_);
    }

    if (returns.length === 0) return 0;

    const meanReturn = returns.reduce((sum, r) => sum + r, 0) / returns.length;
    const variance =
      returns.reduce((sum, r) => sum + Math.pow(r - meanReturn, 2), 0) / returns.length;
    const volatility = Math.sqrt(variance);

    return volatility * 100;
  }

  /**
   * Calculate Value at Risk (VaR) at specified confidence level
   */
  private calculateVaR(snapshots: EquitySnapshot[], confidence: number): number {
    if (snapshots.length < 2) return 0;

    const returns: number[] = [];
    for (let i = 1; i < snapshots.length; i++) {
      const return_ = (snapshots[i].equity - snapshots[i - 1].equity) / snapshots[i - 1].equity;
      returns.push(return_);
    }

    if (returns.length === 0) return 0;

    // Sort returns
    const sortedReturns = [...returns].sort((a, b) => a - b);

    // Calculate VaR percentile
    const index = Math.floor((1 - confidence) * sortedReturns.length);
    const varReturn = sortedReturns[index] || 0;

    return varReturn * snapshots[snapshots.length - 1].equity;
  }

  /**
   * Get best trade
   */
  private getBestTrade(trades: CompletedTrade[]): number {
    if (trades.length === 0) return 0;
    const validTrades = trades.filter(t => t.pnl != null && !isNaN(t.pnl));
    if (validTrades.length === 0) return 0;
    return Math.max(...validTrades.map(t => t.pnl));
  }

  /**
   * Get worst trade
   */
  private getWorstTrade(trades: CompletedTrade[]): number {
    if (trades.length === 0) return 0;
    const validTrades = trades.filter(t => t.pnl != null && !isNaN(t.pnl));
    if (validTrades.length === 0) return 0;
    return Math.min(...validTrades.map(t => t.pnl));
  }

  /**
   * Get largest win
   */
  private getLargestWin(trades: CompletedTrade[]): number {
    const winners = trades.filter(t => t.pnl > 0);
    if (winners.length === 0) return 0;
    return Math.max(...winners.map(t => t.pnl), 0);
  }

  /**
   * Get largest loss
   */
  private getLargestLoss(trades: CompletedTrade[]): number {
    const losers = trades.filter(t => t.pnl < 0);
    if (losers.length === 0) return 0;
    return Math.min(...losers.map(t => t.pnl), 0);
  }
}

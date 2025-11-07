import {
  PerformanceMetrics,
  CompletedTrade,
  EquitySnapshot,
  BacktestResult,
} from '../types/index.js';

export interface SymbolPerformance {
  symbol: string;
  totalTrades: number;
  winningTrades: number;
  losingTrades: number;
  winRate: number;
  totalPnL: number;
  totalReturn: number;
  avgWin: number;
  avgLoss: number;
  profitFactor: number;
  sharpeRatio: number;
  maxDrawdown: number;
  qualityScore: number; // 0-1, based on multiple factors
}

export interface TimePeriodPerformance {
  period: string; // e.g., "2024-01", "2024-01-01 to 2024-01-31"
  startDate: string;
  endDate: string;
  totalTrades: number;
  totalPnL: number;
  totalReturn: number;
  winRate: number;
  profitFactor: number;
  sharpeRatio: number;
  maxDrawdown: number;
}

export interface SignalQualityAnalysis {
  signalType: 'LONG' | 'SHORT' | 'CLOSE' | 'HOLD';
  totalSignals: number;
  executedSignals: number;
  averageConfidence: number;
  averageQualityScore: number;
  winRate: number;
  averagePnL: number;
  profitFactor: number;
}

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

  /**
   * Calculate performance metrics by symbol
   * @param trades - Array of completed trades
   * @param snapshots - Array of equity snapshots for symbol-specific analysis
   * @returns Performance metrics grouped by symbol
   */
  calculateSymbolPerformance(
    trades: CompletedTrade[],
    _snapshots: EquitySnapshot[]
  ): Map<string, SymbolPerformance> {
    const symbolMap = new Map<string, SymbolPerformance>();

    // Group trades by symbol
    const tradesBySymbol = new Map<string, CompletedTrade[]>();
    for (const trade of trades) {
      const symbol = trade.symbol;
      if (!tradesBySymbol.has(symbol)) {
        tradesBySymbol.set(symbol, []);
      }
      tradesBySymbol.get(symbol)?.push(trade);
    }

    // Calculate metrics for each symbol
    for (const [symbol, symbolTrades] of tradesBySymbol.entries()) {
      const winningTrades = symbolTrades.filter(t => t.pnl > 0);
      const losingTrades = symbolTrades.filter(t => t.pnl < 0);
      const totalPnL = symbolTrades.reduce((sum, t) => sum + t.pnl, 0);
      const winRate =
        symbolTrades.length > 0 ? (winningTrades.length / symbolTrades.length) * 100 : 0;
      const avgWin =
        winningTrades.length > 0
          ? winningTrades.reduce((sum, t) => sum + t.pnl, 0) / winningTrades.length
          : 0;
      const avgLoss =
        losingTrades.length > 0
          ? losingTrades.reduce((sum, t) => sum + t.pnl, 0) / losingTrades.length
          : 0;
      const grossProfit = winningTrades.reduce((sum, t) => sum + t.pnl, 0);
      const grossLoss = Math.abs(losingTrades.reduce((sum, t) => sum + t.pnl, 0));
      const profitFactor = grossLoss > 0 ? grossProfit / grossLoss : grossProfit > 0 ? Infinity : 0;

      // Calculate Sharpe ratio for this symbol (simplified)
      const returns = symbolTrades.map(t => t.pnlPercent / 100);
      const meanReturn =
        returns.length > 0 ? returns.reduce((a, b) => a + b, 0) / returns.length : 0;
      const variance =
        returns.length > 0
          ? returns.reduce((sum, r) => sum + Math.pow(r - meanReturn, 2), 0) / returns.length
          : 0;
      const stdDev = Math.sqrt(variance);
      const sharpeRatio = stdDev > 0 ? meanReturn / stdDev : 0;

      // Calculate max drawdown for this symbol
      // Note: EquitySnapshot may not have symbol field, so we'll calculate from trades
      // Calculate cumulative P&L to track equity curve
      const cumulativePnLs: number[] = [];
      let runningPnL = 0;
      for (const trade of symbolTrades) {
        runningPnL += trade.pnl;
        cumulativePnLs.push(runningPnL);
      }

      // Calculate max drawdown for this symbol
      // Use total investment as baseline to avoid division by tiny peak values
      const totalInvestment = symbolTrades.reduce(
        (sum, t) => sum + Math.abs(t.size * t.entryPrice),
        0
      );

      let maxDrawdown = 0;
      let peak = 0;
      let maxAbsoluteDrawdown = 0;

      for (const cumPnL of cumulativePnLs) {
        if (cumPnL > peak) {
          peak = cumPnL;
        }

        // Calculate absolute drawdown (peak - current)
        const absoluteDrawdown = peak - cumPnL;
        if (absoluteDrawdown > maxAbsoluteDrawdown) {
          maxAbsoluteDrawdown = absoluteDrawdown;
        }
      }

      // Calculate percentage drawdown using total investment as baseline
      // This provides stable and meaningful percentages regardless of peak size
      if (totalInvestment > 0.01) {
        // Use total investment as denominator to avoid extreme percentages
        const drawdownPercent = (maxAbsoluteDrawdown / totalInvestment) * 100;
        maxDrawdown = -Math.min(drawdownPercent, 100); // Cap at -100%
      } else if (maxAbsoluteDrawdown > 0) {
        // For edge cases with very small investment, cap at -100%
        maxDrawdown = -100;
      }

      // Calculate quality score (0-1): combination of win rate, profit factor, and Sharpe ratio
      const qualityScore = this.calculateTradeQualityScore(
        winRate,
        profitFactor,
        sharpeRatio,
        maxDrawdown
      );

      symbolMap.set(symbol, {
        symbol,
        totalTrades: symbolTrades.length,
        winningTrades: winningTrades.length,
        losingTrades: losingTrades.length,
        winRate,
        totalPnL,
        // Calculate total return based on total investment (sum of all entry notional values)
        // This is more accurate than using a single entry price
        totalReturn: (() => {
          const totalInvestment = symbolTrades.reduce(
            (sum, t) => sum + Math.abs(t.size * t.entryPrice),
            0
          );
          return totalInvestment > 0 ? (totalPnL / totalInvestment) * 100 : 0;
        })(),
        avgWin,
        avgLoss,
        profitFactor,
        sharpeRatio,
        maxDrawdown,
        qualityScore,
      });
    }

    return symbolMap;
  }

  /**
   * Calculate performance metrics by time period
   * @param trades - Array of completed trades
   * @param snapshots - Array of equity snapshots
   * @param periodType - 'monthly' or 'daily'
   * @returns Performance metrics grouped by time period
   */
  calculateTimePeriodPerformance(
    trades: CompletedTrade[],
    _snapshots: EquitySnapshot[],
    periodType: 'monthly' | 'daily' = 'monthly'
  ): Map<string, TimePeriodPerformance> {
    const periodMap = new Map<string, TimePeriodPerformance>();

    // Group trades by time period
    const tradesByPeriod = new Map<string, CompletedTrade[]>();
    for (const trade of trades) {
      const period = this.getPeriodKey(trade.exitTime, periodType);
      if (!tradesByPeriod.has(period)) {
        tradesByPeriod.set(period, []);
      }
      tradesByPeriod.get(period)?.push(trade);
    }

    // Calculate metrics for each period
    for (const [period, periodTrades] of tradesByPeriod.entries()) {
      const sortedTrades = [...periodTrades].sort((a, b) => a.exitTime - b.exitTime);
      const startDate = new Date(sortedTrades[0]?.exitTime || 0).toISOString().split('T')[0];
      const endDate = new Date(sortedTrades[sortedTrades.length - 1]?.exitTime || 0)
        .toISOString()
        .split('T')[0];

      const winningTrades = periodTrades.filter(t => t.pnl > 0);
      const totalPnL = periodTrades.reduce((sum, t) => sum + t.pnl, 0);
      const winRate =
        periodTrades.length > 0 ? (winningTrades.length / periodTrades.length) * 100 : 0;
      const grossProfit = winningTrades.reduce((sum, t) => sum + t.pnl, 0);
      const grossLoss = Math.abs(
        periodTrades.filter(t => t.pnl < 0).reduce((sum, t) => sum + t.pnl, 0)
      );
      const profitFactor = grossLoss > 0 ? grossProfit / grossLoss : grossProfit > 0 ? Infinity : 0;

      // Calculate Sharpe ratio for this period
      const returns = periodTrades.map(t => t.pnlPercent / 100);
      const meanReturn =
        returns.length > 0 ? returns.reduce((a, b) => a + b, 0) / returns.length : 0;
      const variance =
        returns.length > 0
          ? returns.reduce((sum, r) => sum + Math.pow(r - meanReturn, 2), 0) / returns.length
          : 0;
      const stdDev = Math.sqrt(variance);
      const sharpeRatio = stdDev > 0 ? meanReturn / stdDev : 0;

      // Calculate max drawdown for this period
      // Use total investment as baseline to avoid division by tiny peaks
      const periodInvestment = periodTrades.reduce(
        (sum, t) => sum + Math.abs(t.size * t.entryPrice),
        0
      );

      const periodPnLs = periodTrades.map(t => t.pnl);
      let maxDrawdown = 0;
      let peakEquity = 0;
      let runningEquity = 0;
      let maxAbsoluteDrawdown = 0;

      for (const pnl of periodPnLs) {
        runningEquity += pnl;
        if (runningEquity > peakEquity) {
          peakEquity = runningEquity;
        }
        // Track absolute drawdown
        const absoluteDrawdown = peakEquity - runningEquity;
        if (absoluteDrawdown > maxAbsoluteDrawdown) {
          maxAbsoluteDrawdown = absoluteDrawdown;
        }
      }

      // Calculate percentage drawdown using period investment as baseline
      if (periodInvestment > 0.01) {
        const drawdownPercent = (maxAbsoluteDrawdown / periodInvestment) * 100;
        maxDrawdown = -Math.min(drawdownPercent, 100); // Cap at -100%
      } else if (maxAbsoluteDrawdown > 0) {
        maxDrawdown = -100; // Cap at -100% for edge cases
      }

      // Calculate total return based on total investment (reuse periodInvestment calculated above)
      // This is more accurate than using a single entry price
      const totalReturn = periodInvestment > 0 ? (totalPnL / periodInvestment) * 100 : 0;

      periodMap.set(period, {
        period,
        startDate,
        endDate,
        totalTrades: periodTrades.length,
        totalPnL,
        totalReturn,
        winRate,
        profitFactor,
        sharpeRatio,
        maxDrawdown,
      });
    }

    return periodMap;
  }

  /**
   * Analyze signal quality based on trade outcomes
   * @param trades - Array of completed trades with signal information
   * @returns Signal quality analysis grouped by signal type
   */
  analyzeSignalQuality(trades: CompletedTrade[]): Map<string, SignalQualityAnalysis> {
    const signalMap = new Map<string, SignalQualityAnalysis>();

    // Group trades by signal type (if available)
    // Note: CompletedTrade doesn't have signal type, so we'll infer from side
    const tradesByType = new Map<string, CompletedTrade[]>();
    for (const trade of trades) {
      // Infer signal type from side (LONG/SHORT) or use 'UNKNOWN' if not available
      const signalType =
        trade.side === 'long' ? 'LONG' : trade.side === 'short' ? 'SHORT' : 'UNKNOWN';
      if (!tradesByType.has(signalType)) {
        tradesByType.set(signalType, []);
      }
      tradesByType.get(signalType)?.push(trade);
    }

    // Calculate metrics for each signal type
    for (const [signalType, typeTrades] of tradesByType.entries()) {
      const winningTrades = typeTrades.filter(t => t.pnl > 0);
      const winRate = typeTrades.length > 0 ? (winningTrades.length / typeTrades.length) * 100 : 0;
      const averagePnL =
        typeTrades.length > 0
          ? typeTrades.reduce((sum, t) => sum + t.pnl, 0) / typeTrades.length
          : 0;
      const grossProfit = winningTrades.reduce((sum, t) => sum + t.pnl, 0);
      const grossLoss = Math.abs(
        typeTrades.filter(t => t.pnl < 0).reduce((sum, t) => sum + t.pnl, 0)
      );
      const profitFactor = grossLoss > 0 ? grossProfit / grossLoss : grossProfit > 0 ? Infinity : 0;

      // Calculate average confidence and quality score (if available in trade metadata)
      // Note: These would need to be stored in CompletedTrade if available
      const averageConfidence = 0.7; // Placeholder - would need to be tracked
      const averageQualityScore = 0.7; // Placeholder - would need to be tracked

      signalMap.set(signalType, {
        signalType: signalType as 'LONG' | 'SHORT' | 'CLOSE' | 'HOLD',
        totalSignals: typeTrades.length,
        executedSignals: typeTrades.length,
        averageConfidence,
        averageQualityScore,
        winRate,
        averagePnL,
        profitFactor,
      });
    }

    return signalMap;
  }

  /**
   * Calculate trade quality score based on multiple factors
   * @param winRate - Win rate percentage (0-100)
   * @param profitFactor - Profit factor
   * @param sharpeRatio - Sharpe ratio
   * @param maxDrawdown - Maximum drawdown percentage
   * @returns Quality score (0-1)
   */
  private calculateTradeQualityScore(
    winRate: number,
    profitFactor: number,
    sharpeRatio: number,
    maxDrawdown: number
  ): number {
    // Normalize factors to 0-1 scale
    const winRateScore = Math.min(winRate / 100, 1); // 50% = 0.5, 100% = 1.0
    const profitFactorScore = Math.min(profitFactor / 3, 1); // 3.0 = 1.0, cap at 1.0
    const sharpeScore = Math.min(Math.max(sharpeRatio / 3, 0), 1); // 3.0 = 1.0, cap at 1.0
    const drawdownScore = Math.max(0, 1 - Math.abs(maxDrawdown) / 50); // 50% drawdown = 0, 0% = 1.0

    // Weighted combination
    const weights = {
      winRate: 0.3,
      profitFactor: 0.3,
      sharpeRatio: 0.25,
      drawdown: 0.15,
    };

    return (
      winRateScore * weights.winRate +
      profitFactorScore * weights.profitFactor +
      sharpeScore * weights.sharpeRatio +
      drawdownScore * weights.drawdown
    );
  }

  /**
   * Get period key for grouping trades
   * @param timestamp - Timestamp in milliseconds
   * @param periodType - 'monthly' or 'daily'
   * @returns Period key string
   */
  private getPeriodKey(timestamp: number, periodType: 'monthly' | 'daily'): string {
    const date = new Date(timestamp);
    if (periodType === 'monthly') {
      return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
    } else {
      return date.toISOString().split('T')[0];
    }
  }
}

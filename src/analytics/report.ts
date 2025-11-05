import { BacktestResult, PerformanceMetrics } from '../types/index.js';
import {
  fmtMoney,
  formatDuration,
  fmtSharpeColor,
  fmtProfitFactor,
  fmtVolatilityColor,
  fmtPercentage,
  winRateBar,
} from '../utils/format.js';
import chalk from 'chalk';
import fs from 'fs';
import type { EquitySnapshot } from '../types/index.js';
import { PerformanceAnalytics } from './performance.js';

export interface ReportOptions {
  summaryOnly?: boolean;
  showRisks?: boolean;
  showSignals?: boolean;
  showEquity?: boolean;
}

export class BacktestReport {
  private result: BacktestResult;
  private metrics: PerformanceMetrics;
  private opts: Required<ReportOptions>;
  private analytics: PerformanceAnalytics;

  constructor(result: BacktestResult, opts?: ReportOptions) {
    this.result = result;
    this.metrics = result.metrics;
    this.analytics = new PerformanceAnalytics();
    this.opts = {
      summaryOnly: false,
      showRisks: true,
      showSignals: true,
      showEquity: true,
      ...(opts || {}),
    };
  }

  /**
   * Display the complete backtest report
   */
  displayReport(): void {
    this.displayHeader();
    this.displayExecutiveSummary();
    if (this.opts.summaryOnly) return;
    this.displayPerformanceSummary();
    if (this.opts.showRisks) this.displayRiskMetrics();
    this.displayTradeStatistics();
    if (this.opts.showSignals) this.displaySignalStatistics();
    this.displaySymbolPerformance();
    this.displayTimePeriodPerformance();
    this.displaySignalQualityAnalysis();
    if (this.opts.showEquity) this.displayEquityCurve();
  }

  /**
   * Display the report header
   */
  private displayHeader(): void {
    console.log(
      '\n' + chalk.cyan.bold('┏━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━┓')
    );
    console.log(
      chalk.cyan.bold('┃') +
        chalk.cyan.bold('  📈 Quanta Backtest Results'.padEnd(68)) +
        chalk.cyan.bold('┃')
    );
    console.log(
      chalk.cyan.bold('┗━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━┛')
    );
    console.log(
      `  Period:         ${chalk.white.bold(this.result.config.startDate)} ${chalk.gray('→')} ${chalk.white.bold(this.result.config.endDate)}`
    );
    console.log(`  Duration:       ${chalk.white.bold(formatDuration(this.result.duration))}`);
    console.log(`  Coins:          ${chalk.white.bold(this.result.config.coins.join(', '))}`);
    console.log(
      `  Initial:        ${chalk.white.bold(fmtMoney(this.result.config.initialBalance))}`
    );
    console.log('');
  }

  /** Executive one-liner */
  private displayExecutiveSummary(): void {
    const pnl = this.metrics.totalPnL;
    const pnlColor = pnl >= 0 ? chalk.green : chalk.red;
    const pnlStr = pnlColor(`${pnl >= 0 ? '+' : '-'}${fmtMoney(Math.abs(pnl))}`);
    const retStr = pnlColor(
      `${pnl >= 0 ? '+' : '-'}${Math.abs(this.metrics.totalReturn).toFixed(2)}%`
    );
    const line = [
      `P&L: ${pnlStr} (${retStr})`,
      `Sharpe ${this.metrics.sharpeRatio.toFixed(2)}`,
      `MDD ${Math.abs(this.metrics.maxDrawdown).toFixed(2)}%`,
      `Trades ${this.metrics.totalTrades} (${this.metrics.winRate.toFixed(1)}%, PF ${this.metrics.profitFactor.toFixed(2)})`,
      formatDuration(this.result.duration),
    ].join(' | ');
    console.log('  ' + line);
    const notes = this.buildNotables();
    if (notes.length) {
      console.log('  ' + chalk.yellow('Notable: ') + notes.join('; '));
    }
    console.log('');
  }

  /**
   * Display signal statistics
   */
  private displaySignalStatistics(): void {
    console.log(chalk.blue.bold('🤖 Signal Statistics'));
    console.log(chalk.gray('━'.repeat(70)));

    const stats = this.result.signalStats;
    const acceptanceRate =
      stats.generated > 0 ? ((stats.accepted / stats.generated) * 100).toFixed(1) : '0.0';

    console.log(`  Generated:        ${chalk.white.bold(stats.generated.toLocaleString())}`);
    console.log(
      `  Accepted:         ${chalk.green.bold('✓')} ${chalk.green(stats.accepted.toLocaleString())}`
    );
    console.log(
      `  Rejected:         ${chalk.red.bold('✗')} ${chalk.red(stats.rejected.toLocaleString())}`
    );
    console.log(`  Acceptance Rate:  ${this.formatAcceptanceRate(parseFloat(acceptanceRate))}`);

    console.log('');
  }

  /**
   * Display performance summary
   */
  private displayPerformanceSummary(): void {
    console.log(chalk.blue.bold('📊 Performance Summary'));
    console.log(chalk.gray('━'.repeat(70)));

    const totalReturnColor = this.metrics.totalReturn >= 0 ? chalk.green : chalk.red;
    const pnlSign = this.metrics.totalPnL >= 0 ? '+' : '';

    console.log(
      `  Total Return:     ${totalReturnColor.bold(`${pnlSign}${this.metrics.totalReturn.toFixed(2)}%`)}`
    );
    console.log(
      `  Total P&L:        ${totalReturnColor.bold(`${pnlSign}${fmtMoney(Math.abs(this.metrics.totalPnL))}`)}`
    );
    console.log(`  Final Balance:    ${chalk.white.bold(fmtMoney(this.result.finalEquity))}`);
    console.log(chalk.gray('  ' + '─'.repeat(68)));
    console.log(
      `  Annual Return:    ${totalReturnColor(`${pnlSign}${this.metrics.annualizedReturn.toFixed(2)}%`)}`
    );
    console.log(`  Sharpe Ratio:     ${fmtSharpeColor(this.metrics.sharpeRatio)}`);
    console.log(`  Max Drawdown:     ${chalk.red.bold(this.metrics.maxDrawdown.toFixed(2) + '%')}`);

    console.log('');
  }

  /**
   * Display trade statistics
   */
  private displayTradeStatistics(): void {
    console.log(chalk.blue.bold('📈 Trade Statistics'));
    console.log(chalk.gray('━'.repeat(70)));

    console.log(`  Total Trades:     ${chalk.white.bold(this.metrics.totalTrades)}`);
    console.log(
      `  ${chalk.green('Wins:')} ${chalk.green(this.metrics.winningTrades)} ${chalk.gray('|')} ${chalk.red('Losses:')} ${chalk.red(this.metrics.losingTrades)}`
    );
    console.log(`  Win Rate:         ${winRateBar(this.metrics.winRate)}`);
    console.log(`  Profit Factor:    ${fmtProfitFactor(this.metrics.profitFactor)}`);

    console.log(chalk.gray('  ' + '─'.repeat(68)));

    if (this.metrics.avgWin > 0) {
      console.log(`  Average Win:      ${chalk.green.bold('$' + this.metrics.avgWin.toFixed(2))}`);
    }
    if (this.metrics.avgLoss < 0) {
      console.log(
        `  Average Loss:     ${chalk.red.bold('$' + Math.abs(this.metrics.avgLoss).toFixed(2))}`
      );
    }
    console.log(`  Best Trade:       ${chalk.green('$' + this.metrics.bestTrade.toFixed(2))}`);
    console.log(
      `  Worst Trade:      ${chalk.red('$' + Math.abs(this.metrics.worstTrade).toFixed(2))}`
    );

    console.log(chalk.gray('  ' + '─'.repeat(68)));
    console.log(`  Avg Hold Period:  ${this.formatHoldingPeriod(this.metrics.avgHoldingPeriod)}`);

    console.log('');
  }

  /**
   * Display risk metrics
   */
  private displayRiskMetrics(): void {
    console.log(chalk.blue.bold('⚠️  Risk Metrics'));
    console.log(chalk.gray('━'.repeat(70)));

    console.log(`  Volatility:       ${fmtVolatilityColor(this.metrics.volatility)}`);
    console.log(`  VaR (95%):        ${chalk.red(fmtMoney(Math.abs(this.metrics.var95)))}`);
    console.log(
      `  Max Drawdown:     ${chalk.red.bold(fmtMoney(Math.abs(this.metrics.maxDrawdownValue)))}`
    );
    console.log(chalk.gray('  ' + '─'.repeat(68)));
    console.log(
      `  Largest Win:      ${chalk.green.bold('$' + this.metrics.largestWin.toFixed(2))}`
    );
    console.log(
      `  Largest Loss:     ${chalk.red.bold('$' + Math.abs(this.metrics.largestLoss).toFixed(2))}`
    );

    console.log('');
  }

  /**
   * Display equity curve information
   */
  private displayEquityCurve(): void {
    console.log(chalk.blue.bold('📉 Equity Curve'));
    console.log(chalk.gray('━'.repeat(70)));

    const snapshots = this.result.equitySnapshots;
    if (snapshots.length === 0) {
      console.log(chalk.gray('  No equity data available'));
      return;
    }

    const peaks = this.findPeaks(snapshots);
    const lows = this.findLows(snapshots);

    if (peaks.length > 0) {
      console.log(`  Peak Equity:      ${chalk.green.bold(fmtMoney(Math.max(...peaks)))}`);
    }
    if (lows.length > 0) {
      console.log(`  Lowest Equity:    ${chalk.red(fmtMoney(Math.min(...lows)))}`);
    }

    const returns = [];
    for (let i = 1; i < snapshots.length; i++) {
      const return_ = (snapshots[i].equity - snapshots[i - 1].equity) / snapshots[i - 1].equity;
      returns.push(return_);
    }

    const positiveReturns = returns.filter(r => r > 0).length;
    const positiveDays = ((positiveReturns / returns.length) * 100).toFixed(1);

    console.log(`  Positive Periods: ${fmtPercentage(parseFloat(positiveDays))}`);

    console.log('');
  }

  /**
   * Export results to JSON file
   */
  async exportToJSON(filePath: string): Promise<void> {
    const exportData = {
      config: this.result.config,
      summary: {
        period: `${this.result.config.startDate} to ${this.result.config.endDate}`,
        duration: formatDuration(this.result.duration),
        initialBalance: this.result.config.initialBalance,
        finalBalance: this.result.finalEquity,
        totalReturn: this.metrics.totalReturn,
        totalPnL: this.metrics.totalPnL,
      },
      metrics: this.metrics,
      trades: this.result.trades,
      equitySnapshots: this.result.equitySnapshots.slice(0, 100), // Limit to first 100 to avoid huge files
    };

    fs.writeFileSync(filePath, JSON.stringify(exportData, null, 2));
    console.log(chalk.green(`✓ Results exported to ${filePath}`));
  }

  /**
   * Export results to CSV
   */
  async exportToCSV(filePath: string): Promise<void> {
    let csv = 'Timestamp,Equity,Balance,UnrealizedPnl\n';

    for (const snapshot of this.result.equitySnapshots) {
      csv += `${snapshot.timestamp},${snapshot.equity},${snapshot.balance},${snapshot.unrealizedPnl}\n`;
    }

    fs.writeFileSync(filePath, csv);
    console.log(chalk.green(`✓ Equity curve exported to ${filePath}`));
  }

  // Keep acceptance rate color thresholds specific to signals

  // Build notable alerts
  private buildNotables(): string[] {
    const notes: string[] = [];
    const acceptance = this.result.signalStats?.generated
      ? (this.result.signalStats.accepted / this.result.signalStats.generated) * 100
      : 0;
    if (acceptance > 0 && acceptance < 5) notes.push(`Low acceptance ${acceptance.toFixed(1)}%`);
    if (this.metrics.sharpeRatio < 0)
      notes.push(`Negative Sharpe ${this.metrics.sharpeRatio.toFixed(2)}`);
    if (this.metrics.maxDrawdown > 20)
      notes.push(`High MDD ${this.metrics.maxDrawdown.toFixed(1)}%`);
    return notes;
  }

  /**
   * Find peaks in equity curve
   */
  private findPeaks(snapshots: EquitySnapshot[]): number[] {
    const peaks: number[] = [];
    let currentPeak = snapshots[0].equity;

    for (let i = 1; i < snapshots.length; i++) {
      if (snapshots[i].equity > currentPeak) {
        currentPeak = snapshots[i].equity;
        peaks.push(currentPeak);
      }
    }

    return peaks;
  }

  /**
   * Find lows in equity curve
   */
  private findLows(snapshots: EquitySnapshot[]): number[] {
    const lows: number[] = [];
    let currentLow = snapshots[0].equity;

    for (let i = 1; i < snapshots.length; i++) {
      if (snapshots[i].equity < currentLow) {
        currentLow = snapshots[i].equity;
        lows.push(currentLow);
      }
    }

    return lows;
  }

  private formatAcceptanceRate(rate: number): string {
    if (rate >= 90) return chalk.green.bold(rate.toFixed(1) + '%');
    if (rate >= 70) return chalk.yellow(rate.toFixed(1) + '%');
    return chalk.red(rate.toFixed(1) + '%');
  }

  private formatHoldingPeriod(hours: number): string {
    if (hours < 1) return chalk.white(`${(hours * 60).toFixed(0)} minutes`);
    if (hours < 24) return chalk.white(`${hours.toFixed(1)} hours`);
    const days = (hours / 24).toFixed(1);
    return chalk.white(`${days} days`);
  }

  /**
   * Display symbol performance analysis
   */
  private displaySymbolPerformance(): void {
    const symbolPerformance = this.analytics.calculateSymbolPerformance(
      this.result.trades,
      this.result.equitySnapshots
    );

    if (symbolPerformance.size === 0) return;

    console.log(chalk.cyan.bold('\n  📊 Performance by Symbol'));
    console.log(
      chalk.gray('  ──────────────────────────────────────────────────────────────────────')
    );

    // Sort by quality score descending
    const sortedSymbols = Array.from(symbolPerformance.values()).sort(
      (a, b) => b.qualityScore - a.qualityScore
    );

    for (const perf of sortedSymbols) {
      const pnlColor = perf.totalPnL >= 0 ? chalk.green : chalk.red;
      const qualityColor =
        perf.qualityScore >= 0.7
          ? chalk.green
          : perf.qualityScore >= 0.5
            ? chalk.yellow
            : chalk.red;

      console.log(`\n  ${chalk.white.bold(perf.symbol)}`);
      console.log(
        `    P&L: ${pnlColor(fmtMoney(perf.totalPnL))} (${pnlColor((perf.totalReturn > 0 ? '+' : '') + perf.totalReturn.toFixed(2) + '%')})`
      );
      console.log(
        `    Trades: ${chalk.white(perf.totalTrades)} | Win Rate: ${chalk.white(perf.winRate.toFixed(1) + '%')} | PF: ${fmtProfitFactor(perf.profitFactor)}`
      );
      console.log(
        `    Avg Win: ${chalk.green(fmtMoney(perf.avgWin))} | Avg Loss: ${chalk.red(fmtMoney(perf.avgLoss))}`
      );
      console.log(
        `    Sharpe: ${fmtSharpeColor(perf.sharpeRatio)} | MDD: ${chalk.red(perf.maxDrawdown.toFixed(2) + '%')}`
      );
      console.log(
        `    Quality Score: ${qualityColor(perf.qualityScore.toFixed(2))} ${qualityColor('█'.repeat(Math.floor(perf.qualityScore * 10)))}`
      );
    }
    console.log('');
  }

  /**
   * Display time period performance analysis
   */
  private displayTimePeriodPerformance(): void {
    const periodPerformance = this.analytics.calculateTimePeriodPerformance(
      this.result.trades,
      this.result.equitySnapshots,
      'monthly'
    );

    if (periodPerformance.size === 0) return;

    console.log(chalk.cyan.bold('\n  📅 Performance by Time Period (Monthly)'));
    console.log(
      chalk.gray('  ──────────────────────────────────────────────────────────────────────')
    );

    // Sort by period
    const sortedPeriods = Array.from(periodPerformance.values()).sort((a, b) =>
      a.startDate.localeCompare(b.startDate)
    );

    for (const perf of sortedPeriods) {
      const pnlColor = perf.totalPnL >= 0 ? chalk.green : chalk.red;
      console.log(`\n  ${chalk.white.bold(perf.period)} (${perf.startDate} → ${perf.endDate})`);
      console.log(
        `    P&L: ${pnlColor(fmtMoney(perf.totalPnL))} (${pnlColor((perf.totalReturn > 0 ? '+' : '') + perf.totalReturn.toFixed(2) + '%')})`
      );
      console.log(
        `    Trades: ${chalk.white(perf.totalTrades)} | Win Rate: ${chalk.white(perf.winRate.toFixed(1) + '%')} | PF: ${fmtProfitFactor(perf.profitFactor)}`
      );
      console.log(
        `    Sharpe: ${fmtSharpeColor(perf.sharpeRatio)} | MDD: ${chalk.red(perf.maxDrawdown.toFixed(2) + '%')}`
      );
    }
    console.log('');
  }

  /**
   * Display signal quality analysis
   */
  private displaySignalQualityAnalysis(): void {
    const signalAnalysis = this.analytics.analyzeSignalQuality(this.result.trades);

    if (signalAnalysis.size === 0) return;

    console.log(chalk.cyan.bold('\n  🎯 Signal Quality Analysis'));
    console.log(
      chalk.gray('  ──────────────────────────────────────────────────────────────────────')
    );

    const sortedSignals = Array.from(signalAnalysis.values()).sort(
      (a, b) => b.averageQualityScore - a.averageQualityScore
    );

    for (const analysis of sortedSignals) {
      const qualityColor =
        analysis.averageQualityScore >= 0.7
          ? chalk.green
          : analysis.averageQualityScore >= 0.5
            ? chalk.yellow
            : chalk.red;
      const pnlColor = analysis.averagePnL >= 0 ? chalk.green : chalk.red;

      console.log(`\n  ${chalk.white.bold(analysis.signalType)}`);
      console.log(
        `    Signals: ${chalk.white(analysis.totalSignals)} | Executed: ${chalk.white(analysis.executedSignals)}`
      );
      console.log(
        `    Avg Confidence: ${chalk.white((analysis.averageConfidence * 100).toFixed(1) + '%')} | Avg Quality: ${qualityColor((analysis.averageQualityScore * 100).toFixed(1) + '%')}`
      );
      console.log(
        `    Win Rate: ${chalk.white(analysis.winRate.toFixed(1) + '%')} | Avg P&L: ${pnlColor(fmtMoney(analysis.averagePnL))} | PF: ${fmtProfitFactor(analysis.profitFactor)}`
      );
    }
    console.log('');
  }
}

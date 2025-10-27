import { BacktestResult, PerformanceMetrics } from '../types/index.js';
import chalk from 'chalk';
import fs from 'fs';

export class BacktestReport {
  private result: BacktestResult;
  private metrics: PerformanceMetrics;

  constructor(result: BacktestResult) {
    this.result = result;
    this.metrics = result.metrics;
  }

  /**
   * Display the complete backtest report
   */
  displayReport(): void {
    this.displayHeader();
    this.displaySignalStatistics();
    this.displayPerformanceSummary();
    this.displayTradeStatistics();
    this.displayRiskMetrics();
    this.displayEquityCurve();
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
    console.log(`  Duration:       ${chalk.white.bold(this.formatDuration(this.result.duration))}`);
    console.log(`  Coins:          ${chalk.white.bold(this.result.config.coins.join(', '))}`);
    console.log(
      `  Initial:        ${chalk.white.bold('$' + this.result.config.initialBalance.toLocaleString())}`
    );
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
      `  Total P&L:        ${totalReturnColor.bold(`${pnlSign}$${Math.abs(this.metrics.totalPnL).toFixed(2)}`)}`
    );
    console.log(
      `  Final Balance:    ${chalk.white.bold('$' + this.result.finalEquity.toFixed(2))}`
    );
    console.log(chalk.gray('  ' + '─'.repeat(68)));
    console.log(
      `  Annual Return:    ${totalReturnColor(`${pnlSign}${this.metrics.annualizedReturn.toFixed(2)}%`)}`
    );
    console.log(`  Sharpe Ratio:     ${this.formatSharpe(this.metrics.sharpeRatio)}`);
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
    console.log(`  Win Rate:         ${this.formatWinRateWithBar(this.metrics.winRate)}`);
    console.log(`  Profit Factor:    ${this.formatProfitFactor(this.metrics.profitFactor)}`);

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

    console.log(`  Volatility:       ${this.formatVolatility(this.metrics.volatility)}`);
    console.log(`  VaR (95%):        ${chalk.red('$' + Math.abs(this.metrics.var95).toFixed(2))}`);
    console.log(
      `  Max Drawdown:     ${chalk.red.bold('$' + Math.abs(this.metrics.maxDrawdownValue).toFixed(2))}`
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
      console.log(`  Peak Equity:      ${chalk.green.bold('$' + Math.max(...peaks).toFixed(2))}`);
    }
    if (lows.length > 0) {
      console.log(`  Lowest Equity:    ${chalk.red('$' + Math.min(...lows).toFixed(2))}`);
    }

    const returns = [];
    for (let i = 1; i < snapshots.length; i++) {
      const return_ = (snapshots[i].equity - snapshots[i - 1].equity) / snapshots[i - 1].equity;
      returns.push(return_);
    }

    const positiveReturns = returns.filter(r => r > 0).length;
    const positiveDays = ((positiveReturns / returns.length) * 100).toFixed(1);

    console.log(`  Positive Periods: ${this.formatPercentage(parseFloat(positiveDays))}`);

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
        duration: this.formatDuration(this.result.duration),
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

  /**
   * Format duration in a readable format
   */
  private formatDuration(seconds: number): string {
    if (!seconds || seconds <= 0) return 'N/A';

    const days = Math.floor(seconds / (24 * 60 * 60));
    const hours = Math.floor((seconds % (24 * 60 * 60)) / (60 * 60));
    const minutes = Math.floor((seconds % (60 * 60)) / 60);

    if (days > 0) {
      return `${days}d ${hours}h ${minutes}m`;
    } else if (hours > 0) {
      return `${hours}h ${minutes}m`;
    } else if (minutes > 0) {
      return `${minutes}m`;
    } else {
      return `${Math.floor(seconds)}s`;
    }
  }

  /**
   * Format Sharpe ratio with color
   */
  private formatSharpe(ratio: number): string {
    if (ratio > 1) return chalk.green(ratio.toFixed(2));
    if (ratio > 0) return chalk.yellow(ratio.toFixed(2));
    return chalk.red(ratio.toFixed(2));
  }

  /**
   * Format win rate with color
   */
  private formatWinRate(rate: number): string {
    if (rate >= 50) return chalk.green(`${rate.toFixed(1)}%`);
    return chalk.red(`${rate.toFixed(1)}%`);
  }

  /**
   * Format profit factor with color
   */
  private formatProfitFactor(factor: number): string {
    if (factor > 1) return chalk.green(factor.toFixed(2));
    return chalk.red(factor.toFixed(2));
  }

  /**
   * Find peaks in equity curve
   */
  private findPeaks(snapshots: any[]): number[] {
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
  private findLows(snapshots: any[]): number[] {
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

  private formatWinRateWithBar(rate: number): string {
    const barLength = 20;
    const filled = Math.round((rate / 100) * barLength);
    const bar = '█'.repeat(filled) + '░'.repeat(barLength - filled);
    const coloredBar = rate >= 50 ? chalk.green(bar) : chalk.red(bar);
    return `${coloredBar} ${this.formatWinRate(rate)}`;
  }

  private formatHoldingPeriod(hours: number): string {
    if (hours < 1) return chalk.white(`${(hours * 60).toFixed(0)} minutes`);
    if (hours < 24) return chalk.white(`${hours.toFixed(1)} hours`);
    const days = (hours / 24).toFixed(1);
    return chalk.white(`${days} days`);
  }

  private formatVolatility(vol: number): string {
    if (vol > 5) return chalk.red.bold(vol.toFixed(2) + '%');
    if (vol > 2) return chalk.yellow(vol.toFixed(2) + '%');
    return chalk.green(vol.toFixed(2) + '%');
  }

  private formatPercentage(pct: number): string {
    if (pct >= 50) return chalk.green(pct.toFixed(1) + '%');
    if (pct >= 30) return chalk.yellow(pct.toFixed(1) + '%');
    return chalk.red(pct.toFixed(1) + '%');
  }
}

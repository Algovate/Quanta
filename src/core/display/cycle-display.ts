import chalk from 'chalk';
import { Account, Position, TradingSignal } from '../../types/index.js';

/**
 * Handles console display formatting for trading cycles
 * Separated from business logic for better testability
 */
export class CycleDisplay {
  private stripAnsiCodes(str: string): string {
    // Strip ANSI color codes for file logging
    // eslint-disable-next-line no-control-regex
    return str.replace(/\u001b\[[0-9;]*m/g, '');
  }

  /**
   * Format cycle header with emphasis
   */
  formatCycleHeader(cycleCount: number): string {
    const header = chalk.bold.white(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
    const title = chalk.bold.cyan(`  🔄 CYCLE ${cycleCount} - ${new Date().toLocaleTimeString()}`);
    return `${header}\n${title}\n${header}`;
  }

  /**
   * Format cycle summary for console output
   */
  formatCycleSummary(params: {
    runtime: string;
    cycleCount: number;
    signalsCount: number;
    executedTrades: number;
    rejectedSignals: number;
    openPositions: number;
    maxPositions: number;
    efficiency: number;
    account: Account;
    positions: Position[];
    totalMarginUsed: number;
    totalNotional: number;
    totalPnl: number;
    totalPnlPercent: number;
    unrealizedPnl: number;
    unrealizedPnlPercent: number;
    cyclePnl: number;
    cyclePnlPercent: number;
    realizedCyclePnl: number;
    marginUsage: number;
    riskLevel: 'LOW' | 'MEDIUM' | 'HIGH';
    averageLeverage: number;
    divScore?: number;
    corrScore?: number;
    winRate: number;
    countdown: string;
    previousEquity?: number;
  }): string {
    const {
      runtime,
      cycleCount,
      signalsCount,
      executedTrades,
      rejectedSignals,
      openPositions,
      maxPositions,
      efficiency,
      account,
      positions,
      totalMarginUsed,
      totalNotional,
      totalPnl,
      totalPnlPercent,
      unrealizedPnl,
      unrealizedPnlPercent,
      cyclePnl,
      cyclePnlPercent,
      realizedCyclePnl,
      marginUsage,
      riskLevel,
      averageLeverage,
      divScore,
      corrScore,
      winRate,
      countdown,
      previousEquity,
    } = params;

    let output = `\n📊 Cycle Summary:\n`;
    output += `   Runtime: ${runtime} | Total Cycles: ${cycleCount}\n`;

    const efficiencyColor =
      efficiency >= 80 ? chalk.green : efficiency >= 50 ? chalk.yellow : chalk.red;
    output += `   AI Signals: ${signalsCount} | Executed: ${executedTrades} | Rejected: ${rejectedSignals} | Efficiency: ${efficiencyColor(efficiency + '%')}\n`;
    output += `   Open Positions: ${openPositions}/${maxPositions}\n`;

    output += chalk.magenta(`\n💰 Account Status:\n`);

    // Show equity with trend indicator
    let equityDisplay = `$${account.equity.toFixed(2)}`;
    if (previousEquity) {
      const trendArrow =
        cyclePnl > 0 ? chalk.green('↑') : cyclePnl < 0 ? chalk.red('↓') : chalk.gray('→');
      equityDisplay += ` ${trendArrow}`;
    }

    output += `   Equity: ${equityDisplay} | Available: $${account.availableMargin.toFixed(2)} | Used: $${totalMarginUsed.toFixed(2)}\n`;
    output += `   Exposure: $${totalNotional.toFixed(2)} | Leverage: ${(totalNotional / account.equity).toFixed(2)}x\n`;

    const totalPnlColor = totalPnl >= 0 ? chalk.green : chalk.red;
    const unrealizedPnlColor = unrealizedPnl >= 0 ? chalk.green : chalk.red;
    output += `   Total P&L: ${totalPnlColor(`$${totalPnl.toFixed(2)} (${totalPnlPercent.toFixed(2)}%)`)} | Unrealized: ${unrealizedPnlColor(`$${unrealizedPnl.toFixed(2)} (${unrealizedPnlPercent.toFixed(2)}%)`)} | Realized (cycle): $${realizedCyclePnl.toFixed(2)}\n`;

    if (cyclePnl !== 0) {
      const cyclePnlColor = cyclePnl >= 0 ? chalk.green : chalk.red;
      output += `   Cycle P&L: ${cyclePnlColor(`$${cyclePnl.toFixed(2)} (${cyclePnlPercent.toFixed(2)}%)`)}\n`;
    }

    const riskLevelColor =
      riskLevel === 'HIGH' ? chalk.red : riskLevel === 'MEDIUM' ? chalk.yellow : chalk.green;
    output += chalk.magenta(`\n⚠️  Risk Status:\n`);
    output += `   Margin Usage: ${marginUsage.toFixed(2)}% | Limit: ${(params.maxPositions * 20).toFixed(0)}% | Positions: ${openPositions}/${maxPositions}\n`;

    if (positions.length > 0) {
      output += `   Risk Level: ${riskLevelColor(riskLevel)} (margin ${marginUsage.toFixed(2)}%) | Avg Leverage: ${averageLeverage}x\n`;

      if (positions.length > 1 && divScore !== undefined && corrScore !== undefined) {
        const divColor = divScore > 0.7 ? chalk.green : divScore > 0.4 ? chalk.yellow : chalk.red;
        const corrColor =
          corrScore > 0.7 ? chalk.red : corrScore > 0.4 ? chalk.yellow : chalk.green;
        output += `   Diversification: ${divColor((divScore * 100).toFixed(0) + '%')} | Correlation: ${corrColor((corrScore * 100).toFixed(0) + '%')}\n`;
      }

      output += `\n📊 Positions:\n`;
      output += `   ┌──────────┬──────┬──────────┬──────────────┬──────────────┬───────────────┐\n`;
      output += `   │ SIDE     │ COIN │ LEVERAGE │ MARGIN USED  │ ENTRY        │ UNREAL P&L    │\n`;
      output += `   ├──────────┼──────┼──────────┼──────────────┼──────────────┼───────────────┤\n`;

      positions.forEach(position => {
        const sideColor = position.side === 'long' ? chalk.green : chalk.red;
        const sideText = position.side === 'long' ? 'LONG' : 'SHORT';
        const leverageText = `${position.leverage}x`;
        const marginText = `$${position.marginUsed.toFixed(2)}`;
        const entryText = `$${position.entryPrice.toFixed(2)}`;
        const pnlColor = position.unrealizedPnl >= 0 ? chalk.green : chalk.red;
        const positionEntryValue = position.size * position.entryPrice;
        const pnlPercent =
          positionEntryValue !== 0 ? (position.unrealizedPnl / positionEntryValue) * 100 : 0;
        const pnlText = `$${position.unrealizedPnl.toFixed(2)} (${pnlPercent.toFixed(1)}%)`;

        output += `   │ ${sideColor(sideText.padEnd(8))} │ ${position.symbol.replace('/USDT', '').padEnd(4)} │ ${chalk.cyan(leverageText.padEnd(8))} │ ${chalk.white(marginText.padEnd(13))} │ ${chalk.yellow(entryText.padEnd(13))} │ ${pnlColor(pnlText.padEnd(13))} │\n`;
      });
      output += `   └──────────┴──────┴──────────┴──────────────┴──────────────┴───────────────┘\n`;

      output += chalk.gray(`\n   📊 Position Details:\n`);
      positions.forEach(position => {
        const holdingTime = Date.now() - position.timestamp;
        const hours = Math.floor(holdingTime / (1000 * 60 * 60));
        const minutes = Math.floor((holdingTime % (1000 * 60 * 60)) / (1000 * 60));
        const timeText = hours > 0 ? `${hours}h ${minutes}m` : `${minutes}m`;
        output += chalk.gray(
          `      ${position.symbol.replace('/USDT', '')}: Holding ${timeText}\n`
        );
      });

      output += `\n   Win Rate: ${winRate.toFixed(1)}%\n`;
    } else {
      output += `\n   No open positions\n`;
    }

    output += chalk.gray(`\n────────────────────────────────────────────────────────\n`);
    output +=
      chalk.cyan(`⏱️  Next cycle in ${countdown}`) + chalk.gray(` | Press Ctrl+C to stop\n`);

    return output;
  }

  /**
   * Format signals for console output
   */
  formatSignals(signals: TradingSignal[]): string {
    if (signals.length === 0) {
      return '';
    }

    let output = `🤖 Generated ${signals.length} signal${signals.length > 1 ? 's' : ''}:\n`;

    signals.forEach((signal, index) => {
      const actionColor =
        signal.action === 'LONG'
          ? chalk.green
          : signal.action === 'SHORT'
            ? chalk.red
            : signal.action === 'CLOSE'
              ? chalk.yellow
              : chalk.cyan;
      const confidenceColor =
        signal.confidence > 0.7 ? chalk.green : signal.confidence > 0.55 ? chalk.yellow : chalk.red;

      output += `\n   [${index + 1}] ${signal.coin}: ${actionColor(signal.action)} (confidence: ${confidenceColor(signal.confidence.toFixed(2))})\n`;
      output += `       Reasoning: ${signal.reasoning}\n`;
    });

    output += '\n'; // Empty line before execution results
    return output;
  }

  /**
   * Format execution message for a signal
   */
  formatExecutionMessage(params: {
    action: string;
    coin: string;
    price: number;
    leverage?: number;
    notional?: number;
    margin?: number;
    realizedPnl?: number;
    fees?: number;
  }): string {
    const { action, coin, price, leverage, notional, margin, realizedPnl, fees } = params;

    if (action === 'CLOSE') {
      const realizedText =
        realizedPnl !== undefined ? ` | Realized P&L: $${realizedPnl.toFixed(2)}` : '';
      const feesText = fees ? ` | Fees: $${fees.toFixed(2)}` : '';
      return `✅ Executed CLOSE signal for ${coin} @ $${price.toFixed(2)}${realizedText}${feesText}`;
    }

    if (leverage && notional !== undefined && margin !== undefined) {
      return `✅ Executed ${action} signal for ${coin} @ $${price.toFixed(2)} | ${leverage}x leverage | Est. Notional: $${notional.toFixed(2)} | Est. Margin: $${margin.toFixed(2)}`;
    }

    return `✅ Executed ${action} signal for ${coin} @ $${price.toFixed(2)}`;
  }

  /**
   * Get plain text version (without ANSI codes) for logging
   */
  getPlainText(formatted: string): string {
    return this.stripAnsiCodes(formatted);
  }
}

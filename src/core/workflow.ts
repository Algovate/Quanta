import { Exchange } from '../exchange/types.js';
import { MarketDataProvider } from '../data/market.js';
import { OpenRouterClient, AIContext } from '../ai/agent.js';
import { RiskManager } from '../execution/risk.js';
import { OrderExecutor } from '../execution/orders.js';
import { PositionMonitorService } from '../execution/monitor.js';
import { Account, Position, TradingSignal } from '../types/index.js';
import { aggregatePositionMetrics } from '../execution/position-utils.js';
import { Logger } from '../utils/logger.js';
import chalk from 'chalk';

export interface SystemState {
  isRunning: boolean;
  cycleCount: number;
  startTime: number;
  lastUpdate: number;
  totalSignals: number;
  totalTrades: number;
  rejectedSignals: number; // Track rejected signals for efficiency calculation
  totalPnl: number;
  winRate: number;
  lastCountdownTime?: number;
  previousEquity?: number; // Track equity from previous cycle
  cyclePnl?: number; // P&L change in this cycle
}

export interface WorkflowConfig {
  coins: string[];
  cyclePeriod: number; // milliseconds
  maxPositions: number;
  riskParams: {
    maxRiskPerTrade: number;
    maxTotalRisk: number;
    defaultStopLoss: number;
    maxLeverage: number;
    minLeverage: number;
    maxPositions: number;
  };
}

export class TradingWorkflow {
  private exchange: Exchange;
  private marketDataProvider: MarketDataProvider;
  private aiAgent: OpenRouterClient;
  private riskManager: RiskManager;
  private orderExecutor: OrderExecutor;
  private positionMonitor: PositionMonitorService;
  private config: WorkflowConfig;
  private state: SystemState;
  private intervalId?: NodeJS.Timeout;
  private logger: Logger;
  private isBackgroundMode: boolean;

  constructor(
    exchange: Exchange,
    marketDataProvider: MarketDataProvider,
    aiAgent: OpenRouterClient,
    config: WorkflowConfig
  ) {
    this.exchange = exchange;
    this.marketDataProvider = marketDataProvider;
    this.aiAgent = aiAgent;
    this.config = config;

    this.riskManager = new RiskManager(config.riskParams);
    this.orderExecutor = new OrderExecutor(exchange, this.riskManager);
    this.positionMonitor = new PositionMonitorService(this.riskManager, this.orderExecutor);
    this.logger = Logger.getInstance('Workflow');
    this.isBackgroundMode = this.logger.isBackgroundMode();

    this.state = {
      isRunning: false,
      cycleCount: 0,
      startTime: Date.now(),
      lastUpdate: Date.now(),
      totalSignals: 0,
      totalTrades: 0,
      rejectedSignals: 0,
      totalPnl: 0,
      winRate: 0,
      previousEquity: 0,
      cyclePnl: 0,
    };
  }

  private emitLog(level: 'info' | 'warn' | 'error' | 'success', message: string): void {
    // In background mode, strip chalk formatting for file logs but keep for console
    const plainMessage = this.stripAnsiCodes(message);

    if (level === 'error') {
      this.logger.error(message, undefined);
    } else if (level === 'warn') {
      this.logger.warn(plainMessage);
    } else if (level === 'success') {
      this.logger.info(plainMessage);
    } else {
      this.logger.info(plainMessage);
    }
  }

  private stripAnsiCodes(str: string): string {
    // Strip ANSI color codes for file logging
    // eslint-disable-next-line no-control-regex
    return str.replace(/\u001b\[[0-9;]*m/g, '');
  }

  async start(): Promise<void> {
    if (this.state.isRunning) {
      this.emitLog('warn', 'Workflow is already running');
      return;
    }

    // Remove duplicate startup message - already shown in trade.ts
    this.state.isRunning = true;
    this.state.startTime = Date.now();
    this.state.lastUpdate = Date.now();

    // Start the main trading cycle
    this.intervalId = setInterval(async () => {
      await this.executeCycle();
    }, this.config.cyclePeriod);

    // Execute first cycle immediately
    await this.executeCycle();
  }

  async stop(): Promise<void> {
    if (!this.state.isRunning) {
      this.emitLog('warn', 'Workflow is not running');
      return;
    }

    this.emitLog('info', '🛑 Stopping Quanta trading workflow...');
    this.state.isRunning = false;

    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = undefined;
    }

    // Generate final report
    this.generateReport();
  }

  private async executeCycle(): Promise<void> {
    try {
      this.state.cycleCount++;
      this.state.lastUpdate = Date.now();

      // Display cycle header with emphasis
      this.emitLog('info', '');
      this.emitLog(
        'info',
        chalk.bold.white(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`)
      );
      this.emitLog(
        'info',
        chalk.bold.cyan(`  🔄 CYCLE ${this.state.cycleCount} - ${new Date().toLocaleTimeString()}`)
      );
      this.emitLog(
        'info',
        chalk.bold.white(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`)
      );

      this.emitLog('info', chalk.gray('⏳ Fetching account data...'));

      // 1. Get account and positions
      const account = await this.exchange.getAccount();
      const positions = await this.exchange.getPositions();

      this.emitLog(
        'info',
        `💰 Account: $${account.equity.toFixed(2)} | Positions: ${positions.length}`
      );

      // 2. Monitor existing positions
      if (positions.length > 0) {
        await this.positionMonitor.monitorPositions(positions, this.exchange);
      }

      // 3. Get market data for all coins
      this.emitLog('info', chalk.gray('⏳ Fetching market data...'));
      const allMarketData = [];
      for (const coin of this.config.coins) {
        const symbol = `${coin}/USDT`;
        const marketData = await this.marketDataProvider.getMarketData(symbol, ['3m', '4h']);
        allMarketData.push(...marketData);
      }

      // 4. Generate AI signals
      this.emitLog('info', chalk.gray('⏳ Generating AI signals...'));
      const context: AIContext = {
        startTime: this.state.startTime,
        currentTime: Date.now(),
        invokeCount: this.state.cycleCount,
        tradableCoins: this.config.coins,
        maxPositions: this.config.maxPositions,
        maxRiskPerTrade: this.config.riskParams.maxRiskPerTrade,
        maxLeverage: this.config.riskParams.maxLeverage,
        minLeverage: this.config.riskParams.minLeverage,
        defaultStopLoss: this.config.riskParams.defaultStopLoss,
      };

      const signals = await this.aiAgent.generateTradingSignal(
        allMarketData,
        account,
        positions,
        context
      );
      this.state.totalSignals += signals.length;

      // 5. Execute signals
      // Display signal summary in table format
      if (signals.length > 0) {
        const signalSummary = `🤖 Generated ${signals.length} signal${signals.length > 1 ? 's' : ''}:`;
        this.logger.info(signalSummary);

        // Log to structured logger for file output
        this.logger.info('AI Signal Generation', {
          signalCount: signals.length,
          signals: signals.map(s => ({
            coin: s.coin,
            action: s.action,
            confidence: s.confidence,
            reasoning: s.reasoning,
          })),
        });

        // Console output with formatting (only if not background mode)
        if (!this.isBackgroundMode) {
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
              signal.confidence > 0.7
                ? chalk.green
                : signal.confidence > 0.55
                  ? chalk.yellow
                  : chalk.red;

            console.log(
              `\n   [${index + 1}] ${signal.coin}: ${actionColor(signal.action)} (confidence: ${confidenceColor(signal.confidence.toFixed(2))})`
            );
            console.log(`       Reasoning: ${signal.reasoning}`);
          });
          console.log(''); // Empty line before execution results
        }
      }

      // Execute all signals
      for (const signal of signals) {
        await this.executeSignal(signal, account, positions);
      }

      // 5.5. Refresh account and positions after executing signals
      const updatedAccount = await this.exchange.getAccount();
      const updatedPositions = await this.exchange.getPositions();

      // 6. Update performance metrics with latest data
      this.updatePerformanceMetrics(updatedAccount, updatedPositions);

      // 7. Log cycle summary with latest data
      this.logCycleSummary(updatedAccount, updatedPositions, signals);
    } catch (error) {
      this.emitLog('error', `Error in trading cycle: ${error}`);
    }
  }

  /**
   * Execute a single trading signal
   * Extracted from executeCycle for better organization and testability
   */
  private async executeSignal(
    signal: TradingSignal,
    account: Account,
    positions: Position[]
  ): Promise<void> {
    try {
      const symbol = `${signal.coin}/USDT`;
      const ticker = await this.exchange.getTicker(symbol);
      const currentPrice = (ticker as { price: number }).price;

      // Get position sizing info for detailed logging
      const sizing = this.riskManager.calculatePositionSizing(
        signal,
        account,
        positions,
        currentPrice
      );

      // Handle HOLD signals
      if (signal.action === 'HOLD') {
        const hasPosition = positions.some(p => p.symbol === `${signal.coin}/USDT`);
        this.emitLog(
          'info',
          hasPosition
            ? `⏸️  ${signal.coin}: HOLD - monitoring existing position`
            : `⏸️  ${signal.coin}: HOLD - no action`
        );
        return;
      }

      // Check if sizing calculation failed
      if (!sizing) {
        this.state.rejectedSignals++;
        this.emitLog(
          'warn',
          `⚠️  ${signal.coin}: ${signal.action} signal rejected (risk limit or max positions reached)`
        );
        return;
      }

      // Execute the signal
      const result = await this.orderExecutor.executeSignal(
        signal,
        account,
        positions,
        currentPrice
      );

      if (result.success && result.order) {
        this.state.totalTrades++;
        const leverage = sizing.leverage || 1;
        const positionSize = sizing.suggestedSize * currentPrice;
        const notional = positionSize;
        const marginUsed = notional / leverage;
        const detailMsg = `✅ Executed ${signal.action} signal for ${signal.coin} @ $${currentPrice.toFixed(2)} | ${leverage}x leverage | Notional: $${notional.toFixed(2)} | Margin: $${marginUsed.toFixed(2)}`;
        this.emitLog('success', detailMsg);
      } else if (!result.success) {
        this.emitLog(
          'error',
          `❌ Failed to execute ${signal.action} signal for ${signal.coin}: ${result.error}`
        );
      }
    } catch (error) {
      this.emitLog('error', `Error executing signal for ${signal.coin}: ${error}`);
    }
  }

  private updatePerformanceMetrics(_account: Account, positions: Position[]): void {
    // Update total PnL from open positions using optimized aggregation
    const aggregates = aggregatePositionMetrics(positions);
    this.state.totalPnl = aggregates.totalPnl;

    // Calculate win rate from completed trades
    this.state.winRate = this.calculateWinRate();
  }

  /**
   * Calculate win rate from completed trades
   * Win rate should only be based on closed positions, not open positions
   */
  private calculateWinRate(): number {
    // Skip if exchange doesn't support completed trades tracking
    if (!this.exchange.getCompletedTrades) {
      return this.state.winRate;
    }

    const completedTrades = this.exchange.getCompletedTrades();

    // No completed trades yet
    if (completedTrades.length === 0) {
      return this.state.totalTrades === 0 ? 0 : this.state.winRate;
    }

    // Calculate win rate from completed trades
    const winningTrades = completedTrades.filter(trade => trade.pnl > 0).length;
    return (winningTrades / completedTrades.length) * 100;
  }

  private logCycleSummary(account: Account, positions: Position[], signals: TradingSignal[]): void {
    const runtime = Date.now() - this.state.startTime;
    const runtimeMinutes = Math.floor(runtime / (1000 * 60));
    const runtimeSeconds = Math.floor((runtime / 1000) % 60);

    // Use optimized single-pass aggregation instead of multiple reduce() calls
    const aggregates = aggregatePositionMetrics(positions);
    const totalPnl = aggregates.totalPnl;
    const totalNotional = aggregates.totalNotional;
    const totalMarginUsed = aggregates.totalMarginUsed;

    const pnlPercent = (totalPnl / account.equity) * 100;
    const pnlColor = totalPnl >= 0 ? chalk.green : chalk.red;

    // Calculate cycle P&L change
    const cyclePnlChange = this.state.previousEquity
      ? account.equity - this.state.previousEquity
      : 0;
    const cyclePnlPercent = this.state.previousEquity
      ? (cyclePnlChange / this.state.previousEquity) * 100
      : 0;
    const cyclePnlColor = cyclePnlChange >= 0 ? chalk.green : chalk.red;
    this.state.previousEquity = account.equity;
    this.state.cyclePnl = cyclePnlChange;

    // Log structured cycle summary for file logs only (not console)
    // This prevents duplicate "Cycle Summary" text in console output
    if (this.logger.isBackgroundMode()) {
      this.logger.info('Cycle Summary', {
        cycle: this.state.cycleCount,
        runtime: `${runtimeMinutes}m ${runtimeSeconds}s`,
        totalCycles: this.state.cycleCount,
        aiSignals: signals.length,
        executedTrades: this.state.totalTrades,
        openPositions: positions.length,
        account: {
          equity: account.equity,
          availableMargin: account.availableMargin,
          usedMargin: totalMarginUsed,
          exposure: totalNotional,
          leverage: (totalNotional / account.equity).toFixed(2),
          totalPnl,
          pnlPercent,
        },
        positions: positions.map(p => ({
          symbol: p.symbol,
          side: p.side,
          leverage: p.leverage,
          marginUsed: p.marginUsed,
          entryPrice: p.entryPrice,
          unrealizedPnl: p.unrealizedPnl,
        })),
        winRate: this.state.winRate,
      });
    }

    // Console output with formatting (only if not background mode)
    if (!this.isBackgroundMode) {
      console.log(`\n📊 Cycle Summary:`);
      console.log(
        `   Runtime: ${runtimeMinutes}m ${runtimeSeconds}s | Total Cycles: ${this.state.cycleCount}`
      );

      // Calculate signal efficiency
      const totalActionableSignals = this.state.totalTrades + this.state.rejectedSignals;
      const efficiency =
        totalActionableSignals > 0
          ? ((this.state.totalTrades / totalActionableSignals) * 100).toFixed(0)
          : '100';
      const efficiencyColor =
        parseFloat(efficiency) >= 80
          ? chalk.green
          : parseFloat(efficiency) >= 50
            ? chalk.yellow
            : chalk.red;

      console.log(
        `   AI Signals: ${signals.length} | Executed: ${this.state.totalTrades} | Rejected: ${this.state.rejectedSignals} | Efficiency: ${efficiencyColor(efficiency + '%')}`
      );
      console.log(`   Open Positions: ${positions.length}/${this.config.maxPositions}`);

      // Account and exposure summary
      console.log(chalk.magenta(`\n💰 Account Status:`));

      // Show equity with trend indicator
      let equityDisplay = `$${account.equity.toFixed(2)}`;
      if (this.state.cycleCount > 1 && this.state.previousEquity) {
        const trendArrow =
          cyclePnlChange > 0
            ? chalk.green('↑')
            : cyclePnlChange < 0
              ? chalk.red('↓')
              : chalk.gray('→');
        equityDisplay += ` ${trendArrow}`;
      }

      console.log(
        `   Equity: ${equityDisplay} | Available: $${account.availableMargin.toFixed(2)} | Used: $${totalMarginUsed.toFixed(2)}`
      );
      console.log(
        `   Exposure: $${totalNotional.toFixed(2)} | Leverage: ${(totalNotional / account.equity).toFixed(2)}x | Total P&L: ${pnlColor(`$${totalPnl.toFixed(2)} (${pnlPercent.toFixed(2)}%)`)}`
      );

      // Cycle P&L change if applicable
      if (this.state.cycleCount > 1 && cyclePnlChange !== 0) {
        console.log(
          `   Cycle P&L: ${cyclePnlColor(`$${cyclePnlChange.toFixed(2)} (${cyclePnlPercent.toFixed(2)}%)`)}`
        );
      }

      // Risk metrics - comprehensive display
      const maxMarginLimit = this.config.riskParams.maxTotalRisk * 100; // Convert to percentage
      const marginUsage = positions.length > 0 ? (totalMarginUsed / account.equity) * 100 : 0;

      // Get additional risk metrics from position monitor
      const positionSummary = this.positionMonitor.getPositionSummary(positions);
      const averageLeverage = positionSummary.averageLeverage.toFixed(2);
      const riskLevelColor =
        positionSummary.riskLevel === 'high'
          ? chalk.red
          : positionSummary.riskLevel === 'medium'
            ? chalk.yellow
            : chalk.green;

      console.log(chalk.magenta(`\n⚠️  Risk Status:`));
      console.log(
        `   Margin Usage: ${marginUsage.toFixed(2)}% | Limit: ${maxMarginLimit.toFixed(0)}% | Positions: ${positions.length}/${this.config.maxPositions}`
      );

      if (positions.length > 0) {
        console.log(
          `   Risk Level: ${riskLevelColor(positionSummary.riskLevel.toUpperCase())} | Avg Leverage: ${averageLeverage}x`
        );

        // Display diversification metrics
        if (positions.length > 1) {
          const divScore = positionSummary.diversificationScore;
          const corrScore = positionSummary.correlationScore;
          const divColor = divScore > 0.7 ? chalk.green : divScore > 0.4 ? chalk.yellow : chalk.red;
          const corrColor =
            corrScore > 0.7 ? chalk.red : corrScore > 0.4 ? chalk.yellow : chalk.green;

          console.log(
            `   Diversification: ${divColor((divScore * 100).toFixed(0) + '%')} | Correlation: ${corrColor((corrScore * 100).toFixed(0) + '%')}`
          );
        }

        // Display positions table
        console.log(`\n📊 Positions:`);
        console.log(
          `   ┌──────────┬──────┬──────────┬──────────────┬──────────────┬───────────────┐`
        );
        console.log(
          `   │ SIDE     │ COIN │ LEVERAGE │ MARGIN USED  │ ENTRY        │ UNREAL P&L    │`
        );
        console.log(
          `   ├──────────┼──────┼──────────┼──────────────┼──────────────┼───────────────┤`
        );

        positions.forEach(position => {
          const sideColor = position.side === 'long' ? chalk.green : chalk.red;
          const sideText = position.side === 'long' ? 'LONG' : 'SHORT';
          const leverageText = `${position.leverage}x`;
          const marginText = `$${position.marginUsed.toFixed(2)}`;
          const entryText = `$${position.entryPrice.toFixed(2)}`;
          const pnlColor = position.unrealizedPnl >= 0 ? chalk.green : chalk.red;
          // Calculate P&L percentage based on entry value, not current market value
          const positionEntryValue = position.size * position.entryPrice;
          const pnlPercent =
            positionEntryValue !== 0 ? (position.unrealizedPnl / positionEntryValue) * 100 : 0;
          const pnlText = `$${position.unrealizedPnl.toFixed(2)} (${pnlPercent.toFixed(1)}%)`;

          console.log(
            `   │ ${sideColor(sideText.padEnd(8))} │ ${position.symbol.replace('/USDT', '').padEnd(4)} │ ${chalk.cyan(leverageText.padEnd(8))} │ ${chalk.white(marginText.padEnd(13))} │ ${chalk.yellow(entryText.padEnd(13))} │ ${pnlColor(pnlText.padEnd(13))} │`
          );
        });
        console.log(
          `   └──────────┴──────┴──────────┴──────────────┴──────────────┴───────────────┘`
        );

        // Display individual position metrics
        console.log(chalk.gray(`\n   📊 Position Details:`));
        positions.forEach(position => {
          const holdingTime = Date.now() - position.timestamp;
          const hours = Math.floor(holdingTime / (1000 * 60 * 60));
          const minutes = Math.floor((holdingTime % (1000 * 60 * 60)) / (1000 * 60));
          const timeText = hours > 0 ? `${hours}h ${minutes}m` : `${minutes}m`;

          // Calculate stop loss and take profit levels
          const stopLoss = this.riskManager.calculateStopLoss(position, position.entryPrice);
          const takeProfit = this.riskManager.calculateTakeProfit(position, position.entryPrice);
          const stopLossPercent = Math.abs(
            ((stopLoss - position.entryPrice) / position.entryPrice) * 100
          );
          const takeProfitPercent = Math.abs(
            ((takeProfit - position.entryPrice) / position.entryPrice) * 100
          );
          const rrRatio = takeProfitPercent / stopLossPercent;

          console.log(
            chalk.gray(
              `      ${position.symbol.replace('/USDT', '')}: Holding ${timeText} | R/R ${rrRatio.toFixed(1)}x | SL: ${position.side === 'long' ? '-' : '+'}${stopLossPercent.toFixed(1)}% | TP: ${position.side === 'long' ? '+' : '-'}${takeProfitPercent.toFixed(1)}%`
            )
          );
        });

        // Win rate
        console.log(`\n   Win Rate: ${this.state.winRate.toFixed(1)}%`);
      } else {
        console.log(`\n   No open positions`);
      }

      // Add status line with countdown at the end
      const elapsed = Date.now() - this.state.lastUpdate;
      const remaining = Math.max(0, this.config.cyclePeriod - elapsed);
      const remainingSeconds = Math.floor(remaining / 1000);
      const minutes = Math.floor(remainingSeconds / 60);
      const seconds = remainingSeconds % 60;
      const countdownText = minutes > 0 ? `${minutes}m ${seconds}s` : `${remainingSeconds}s`;

      console.log(chalk.gray(`\n────────────────────────────────────────────────────────`));
      console.log(
        chalk.cyan(`⏱️  Next cycle in ${countdownText}`) + chalk.gray(` | Press Ctrl+C to stop`)
      );
    }
  }

  private generateReport(): void {
    const runtime = Date.now() - this.state.startTime;
    const runtimeMinutes = Math.floor(runtime / (1000 * 60));

    const report = {
      runtime: `${runtimeMinutes} minutes`,
      cycles: this.state.cycleCount,
      totalSignals: this.state.totalSignals,
      totalTrades: this.state.totalTrades,
      totalPnl: this.state.totalPnl,
      winRate: this.state.winRate,
    };

    this.logger.info('Final Report', report);

    // Console output (only if not background mode)
    if (!this.isBackgroundMode) {
      console.log('\n📈 FINAL REPORT');
      console.log('='.repeat(50));
      console.log(`Runtime: ${runtimeMinutes} minutes`);
      console.log(`Cycles: ${this.state.cycleCount}`);
      console.log(`Total Signals: ${this.state.totalSignals}`);
      console.log(`Total Trades: ${this.state.totalTrades}`);
      console.log(`Total PnL: $${this.state.totalPnl.toFixed(2)}`);
      console.log(`Win Rate: ${this.state.winRate.toFixed(1)}%`);
      console.log('='.repeat(50));
    }
  }

  getState(): SystemState {
    return { ...this.state };
  }

  async pause(): Promise<void> {
    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = undefined;
    }
  }

  async resume(): Promise<void> {
    if (!this.intervalId) {
      this.intervalId = setInterval(async () => {
        await this.executeCycle();
      }, this.config.cyclePeriod);
    }
  }

  updateConfig(newConfig: Partial<WorkflowConfig>): void {
    this.config = { ...this.config, ...newConfig };
    this.riskManager.updateRiskParams(newConfig.riskParams || {});
  }
}

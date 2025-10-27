import { Exchange } from '../exchange/types.js';
import { MarketDataProvider } from '../data/market.js';
import { OpenRouterClient, AIContext } from '../ai/agent.js';
import { RiskManager } from '../execution/risk.js';
import { OrderExecutor } from '../execution/orders.js';
import { PositionMonitorService } from '../execution/monitor.js';
import { Account, Position, TradingSignal } from '../types/index.js';
import chalk from 'chalk';

export interface WorkflowEventEmitter {
  emit(event: string, ...args: any[]): boolean;
  on(event: string, listener: (...args: any[]) => void): void;
  off(event: string, listener: (...args: any[]) => void): void;
}

export interface SystemState {
  isRunning: boolean;
  cycleCount: number;
  startTime: number;
  lastUpdate: number;
  totalSignals: number;
  totalTrades: number;
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
  private countdownIntervalId?: NodeJS.Timeout;
  private eventEmitter?: WorkflowEventEmitter;

  constructor(
    exchange: Exchange,
    marketDataProvider: MarketDataProvider,
    aiAgent: OpenRouterClient,
    config: WorkflowConfig,
    eventEmitter?: WorkflowEventEmitter
  ) {
    this.exchange = exchange;
    this.marketDataProvider = marketDataProvider;
    this.aiAgent = aiAgent;
    this.config = config;
    this.eventEmitter = eventEmitter;

    this.riskManager = new RiskManager(config.riskParams);
    this.orderExecutor = new OrderExecutor(exchange, this.riskManager);
    this.positionMonitor = new PositionMonitorService(this.riskManager, this.orderExecutor);

    this.state = {
      isRunning: false,
      cycleCount: 0,
      startTime: Date.now(),
      lastUpdate: Date.now(),
      totalSignals: 0,
      totalTrades: 0,
      totalPnl: 0,
      winRate: 0,
      previousEquity: 0,
      cyclePnl: 0,
    };
  }

  private emitLog(level: 'info' | 'warn' | 'error' | 'success', message: string): void {
    // In TUI mode, only send to TUI event emitter, don't log to console
    if (this.eventEmitter) {
      this.eventEmitter.emit('log', { level, message, timestamp: Date.now() });
      return; // Don't also log to console in TUI mode
    }

    // In CLI mode, log to console
    if (level === 'error') {
      console.error(message);
    } else if (level === 'warn') {
      console.warn(message);
    } else {
      console.log(message);
    }
  }

  async start(): Promise<void> {
    if (this.state.isRunning) {
      this.emitLog('warn', 'Workflow is already running');
      return;
    }

    this.emitLog('info', '🚀 Starting Quanta trading workflow...');
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

      // Only show status updates in CLI mode
      if (!this.eventEmitter) {
        this.emitLog('info', chalk.gray('⏳ Fetching account data...'));
      }

      // 1. Get account and positions
      const account = await this.exchange.getAccount();
      const positions = await this.exchange.getPositions();

      // Emit TUI update events
      if (this.eventEmitter) {
        this.eventEmitter.emit('account:update', account);
        this.eventEmitter.emit('positions:update', positions);
        this.eventEmitter.emit('system:status', {
          isRunning: this.state.isRunning,
          cycleCount: this.state.cycleCount,
          startTime: this.state.startTime,
          lastUpdate: this.state.lastUpdate,
          totalSignals: this.state.totalSignals,
          totalTrades: this.state.totalTrades,
          winRate: this.state.winRate,
        });
      }

      // Only log to console if NOT in TUI mode (logs are already in TUI)
      if (!this.eventEmitter) {
        this.emitLog(
          'info',
          `💰 Account: $${account.equity.toFixed(2)} | Positions: ${positions.length}`
        );
      }

      // 2. Monitor existing positions
      if (positions.length > 0) {
        await this.positionMonitor.monitorPositions(positions, this.exchange);
      }

      // 3. Get market data for all coins
      if (!this.eventEmitter) {
        this.emitLog('info', chalk.gray('⏳ Fetching market data...'));
      }
      const allMarketData = [];
      for (const coin of this.config.coins) {
        const symbol = `${coin}/USDT`;
        const marketData = await this.marketDataProvider.getMarketData(symbol, ['3m', '4h']);
        allMarketData.push(...marketData);
      }

      // 4. Generate AI signals
      if (!this.eventEmitter) {
        this.emitLog('info', chalk.gray('⏳ Generating AI signals...'));
      }
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

      // Emit TUI update events
      if (this.eventEmitter) {
        this.eventEmitter.emit('marketdata:update', allMarketData);
        signals.forEach(signal => this.eventEmitter?.emit('signal:new', signal));
      }

      // 5. Execute signals
      // Display signal summary in table format in CLI mode
      if (!this.eventEmitter && signals.length > 0) {
        console.log(`\n🤖 Generated ${signals.length} signal${signals.length > 1 ? 's' : ''}:`);

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

      for (const signal of signals) {
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

          // Log HOLD signal before attempting execution
          if (signal.action === 'HOLD') {
            // Only log HOLD if we have a position, otherwise it's just monitoring
            const hasPosition = positions.some(p => p.symbol === `${signal.coin}/USDT`);
            if (hasPosition) {
              this.emitLog('info', `⏸️  ${signal.coin}: HOLD - monitoring existing position`);
            } else {
              this.emitLog('info', `⏸️  ${signal.coin}: HOLD - no action`);
            }
            continue; // Skip execution for HOLD
          }

          // Check if sizing calculation failed
          if (!sizing) {
            this.emitLog(
              'warn',
              `⚠️  ${signal.coin}: ${signal.action} signal rejected (risk limit or max positions reached)`
            );
            continue;
          }

          const result = await this.orderExecutor.executeSignal(
            signal,
            account,
            positions,
            currentPrice
          );

          if (result.success) {
            // Only count and log if an actual order was placed
            if (result.order) {
              this.state.totalTrades++;

              // Build detailed execution message with actual order info
              const leverage = sizing.leverage || 1;
              const positionSize = sizing.suggestedSize * currentPrice; // Value in USD
              const notional = positionSize; // Notional is just the position value
              const marginUsed = notional / leverage; // Actual margin deducted
              const detailMsg = `✅ Executed ${signal.action} signal for ${signal.coin} @ $${currentPrice.toFixed(2)} | ${leverage}x leverage | Notional: $${notional.toFixed(2)} | Margin: $${marginUsed.toFixed(2)}`;

              this.emitLog('success', detailMsg);

              // Emit order event for TUI
              if (this.eventEmitter) {
                this.eventEmitter.emit('order:new', result.order);
              }
            }
          } else {
            this.emitLog(
              'error',
              `❌ Failed to execute ${signal.action} signal for ${signal.coin}: ${result.error}`
            );
          }
        } catch (error) {
          this.emitLog('error', `Error executing signal for ${signal.coin}: ${error}`);
        }
      }

      // 5.5. Refresh account and positions after executing signals
      const updatedAccount = await this.exchange.getAccount();
      const updatedPositions = await this.exchange.getPositions();

      // Emit updated state for TUI
      if (this.eventEmitter) {
        this.eventEmitter.emit('account:update', updatedAccount);
        this.eventEmitter.emit('positions:update', updatedPositions);
      }

      // 6. Update performance metrics with latest data
      this.updatePerformanceMetrics(updatedAccount, updatedPositions);

      // 7. Log cycle summary with latest data
      this.logCycleSummary(updatedAccount, updatedPositions, signals);
    } catch (error) {
      this.emitLog('error', `Error in trading cycle: ${error}`);
    }
  }

  private updatePerformanceMetrics(account: Account, positions: Position[]): void {
    // Update total PnL
    const currentPnl = positions.reduce((sum, pos) => sum + pos.unrealizedPnl, 0);
    this.state.totalPnl = currentPnl;

    // Calculate win rate only if we have positions
    if (positions.length > 0) {
      const winningTrades = positions.filter(pos => pos.unrealizedPnl > 0).length;
      this.state.winRate = (winningTrades / positions.length) * 100;
    } else if (this.state.totalTrades === 0) {
      // No trades yet
      this.state.winRate = 0;
    }
    // If totalTrades > 0 but no open positions, keep the previous win rate
  }

  private logCycleSummary(account: Account, positions: Position[], signals: TradingSignal[]): void {
    // Only log to console if NOT in TUI mode
    if (!this.eventEmitter) {
      const runtime = Date.now() - this.state.startTime;
      const runtimeMinutes = Math.floor(runtime / (1000 * 60));
      const runtimeSeconds = Math.floor((runtime / 1000) % 60);

      const totalPnl = positions.reduce((sum, pos) => sum + pos.unrealizedPnl, 0);
      const pnlPercent = (totalPnl / account.equity) * 100;
      const pnlColor = totalPnl >= 0 ? chalk.green : chalk.red;
      const totalNotional = positions.reduce((sum, pos) => sum + pos.notional, 0);
      const totalMarginUsed = positions.reduce((sum, pos) => sum + pos.marginUsed, 0);

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

      console.log(`\n📊 Cycle Summary:`);
      console.log(
        `   Runtime: ${runtimeMinutes}m ${runtimeSeconds}s | Total Cycles: ${this.state.cycleCount}`
      );
      console.log(
        `   AI Signals: ${signals.length} | Executed Trades: ${this.state.totalTrades} | Open Positions: ${positions.length}`
      );

      // Account and exposure summary
      console.log(chalk.magenta(`\n💰 Account Status:`));
      console.log(
        `   Equity: $${account.equity.toFixed(2)} | Available: $${account.availableMargin.toFixed(2)} | Used: $${totalMarginUsed.toFixed(2)}`
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

      // Risk metrics
      const maxMarginLimit = this.config.riskParams.maxTotalRisk * 100; // Convert to percentage
      const marginUsage = positions.length > 0 ? (totalMarginUsed / account.equity) * 100 : 0;
      console.log(chalk.magenta(`\n⚠️  Risk Status:`));
      console.log(
        `   Margin Usage: ${marginUsage.toFixed(2)}% | Limit: ${maxMarginLimit.toFixed(0)}% | Positions: ${positions.length}/${this.config.maxPositions}`
      );

      if (positions.length > 0) {
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
          const pnlPercent = (position.unrealizedPnl / position.notional) * 100;
          const pnlText = `$${position.unrealizedPnl.toFixed(2)} (${pnlPercent.toFixed(1)}%)`;

          console.log(
            `   │ ${sideColor(sideText.padEnd(8))} │ ${position.symbol.replace('/USDT', '').padEnd(4)} │ ${chalk.cyan(leverageText.padEnd(8))} │ ${chalk.white(marginText.padEnd(13))} │ ${chalk.yellow(entryText.padEnd(13))} │ ${pnlColor(pnlText.padEnd(13))} │`
          );
        });
        console.log(
          `   └──────────┴──────┴──────────┴──────────────┴──────────────┴───────────────┘`
        );

        // Win rate only if we have positions
        console.log(`   Win Rate: ${this.state.winRate.toFixed(1)}%`);
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

  getState(): SystemState {
    return { ...this.state };
  }

  setEventEmitter(emitter: WorkflowEventEmitter): void {
    this.eventEmitter = emitter;
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

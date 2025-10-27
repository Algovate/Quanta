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
    };
  }

  private emitLog(level: 'info' | 'warn' | 'error' | 'success', message: string): void {
    if (this.eventEmitter) {
      this.eventEmitter.emit('log', { level, message, timestamp: Date.now() });
    }
    // Still log to console in CLI mode
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

      this.emitLog(
        'info',
        `🔄 Cycle ${this.state.cycleCount} - ${new Date().toLocaleTimeString()}`
      );

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

      this.emitLog(
        'info',
        `💰 Account: $${account.equity.toFixed(2)} | Positions: ${positions.length}`
      );

      // 2. Monitor existing positions
      if (positions.length > 0) {
        await this.positionMonitor.monitorPositions(positions, this.exchange);
      }

      // 3. Get market data for all coins
      const allMarketData = [];
      for (const coin of this.config.coins) {
        const symbol = `${coin}/USDT`;
        const marketData = await this.marketDataProvider.getMarketData(symbol, ['3m', '4h']);
        allMarketData.push(...marketData);
      }

      // 4. Generate AI signals
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

      this.emitLog('info', `🤖 Generated ${signals.length} signals`);

      // 5. Execute signals
      for (const signal of signals) {
        try {
          const symbol = `${signal.coin}/USDT`;
          const ticker = await this.exchange.getTicker(symbol);
          const currentPrice = (ticker as { price: number }).price;

          const result = await this.orderExecutor.executeSignal(
            signal,
            account,
            positions,
            currentPrice
          );

          if (result.success) {
            this.state.totalTrades++;
            this.emitLog('success', `✅ Executed ${signal.action} signal for ${signal.coin}`);

            // Emit TUI update events
            if (this.eventEmitter && result.order) {
              this.eventEmitter.emit('order:new', result.order);
            }
          } else {
            this.emitLog(
              'error',
              `❌ Failed to execute signal for ${signal.coin}: ${result.error}`
            );
          }
        } catch (error) {
          this.emitLog('error', `Error executing signal for ${signal.coin}: ${error}`);
        }
      }

      // 6. Update performance metrics
      this.updatePerformanceMetrics(account, positions);

      // 7. Log cycle summary
      this.logCycleSummary(account, positions, signals);
    } catch (error) {
      this.emitLog('error', `Error in trading cycle: ${error}`);
    }
  }

  private updatePerformanceMetrics(account: Account, positions: Position[]): void {
    // Update total PnL
    const currentPnl = positions.reduce((sum, pos) => sum + pos.unrealizedPnl, 0);
    this.state.totalPnl = currentPnl;

    // Calculate win rate (simplified)
    if (this.state.totalTrades > 0) {
      const winningTrades = positions.filter(pos => pos.unrealizedPnl > 0).length;
      this.state.winRate = (winningTrades / positions.length) * 100;
    }
  }

  private logCycleSummary(account: Account, positions: Position[], signals: TradingSignal[]): void {
    const runtime = Date.now() - this.state.startTime;
    const runtimeMinutes = Math.floor(runtime / (1000 * 60));

    console.log(`\n📊 Cycle Summary:`);
    console.log(`   Runtime: ${runtimeMinutes}m`);
    console.log(`   Signals: ${signals.length}`);
    console.log(`   Trades: ${this.state.totalTrades}`);
    console.log(`   Positions: ${positions.length}`);

    // Display portfolio details
    if (positions.length > 0) {
      console.log(`\n📊 Portfolio Overview:`);
      console.log(chalk.magenta(`   TOTAL ACCOUNT VALUE: $${account.equity.toFixed(2)}`));
      console.log(`   Available Cash: $${account.availableMargin.toFixed(2)}`);
      console.log(`   Total P&L: $${this.state.totalPnl.toFixed(2)}`);

      // Display positions table
      console.log(`\n   Positions:`);
      console.log(`   │ SIDE     │ COIN │ LEVERAGE │ NOTIONAL    │ UNREAL P&L`);
      console.log(`   ├──────────┼──────┼──────────┼──────────────┼────────────`);

      positions.forEach(position => {
        const sideColor = position.side === 'long' ? chalk.green : chalk.red;
        const sideText = position.side === 'long' ? 'LONG' : 'SHORT';
        const leverageText = `${position.leverage}X`;
        const notionalText = `$${position.notional.toFixed(2)}`;
        const pnlColor = position.unrealizedPnl >= 0 ? chalk.green : chalk.red;
        const pnlText = `$${position.unrealizedPnl.toFixed(2)}`;

        console.log(
          `   │ ${sideColor(sideText.padEnd(8))} │ ${position.symbol.replace('/USDT', '').padEnd(4)} │ ${chalk.cyan(leverageText.padEnd(8))} │ ${chalk.cyan(notionalText.padEnd(13))} │ ${pnlColor(pnlText.padEnd(11))}`
        );
      });
    }

    console.log(`   Win Rate: ${this.state.winRate.toFixed(1)}%`);
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

import { Exchange } from '../exchange/types';
import { MarketDataProvider } from '../data/market';
import { OpenRouterClient } from '../ai/agent';
import { RiskManager } from '../execution/risk';
import { OrderExecutor } from '../execution/orders';
import { PositionMonitorService } from '../execution/monitor';
import { Account, Position, TradingSignal } from '../types';

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

  async start(): Promise<void> {
    if (this.state.isRunning) {
      console.log('Workflow is already running');
      return;
    }

    console.log('🚀 Starting BetaArena trading workflow...');
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
      console.log('Workflow is not running');
      return;
    }

    console.log('🛑 Stopping BetaArena trading workflow...');
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

      console.log(`\n🔄 Cycle ${this.state.cycleCount} - ${new Date().toLocaleTimeString()}`);

      // 1. Get account and positions
      const account = await this.exchange.getAccount();
      const positions = await this.exchange.getPositions();

      console.log(`💰 Account: $${account.equity.toFixed(2)} | Positions: ${positions.length}`);

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
      const signals = await this.aiAgent.generateTradingSignal(allMarketData, account, positions);
      this.state.totalSignals += signals.length;

      console.log(`🤖 Generated ${signals.length} signals`);

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
            console.log(`✅ Executed ${signal.action} signal for ${signal.coin}`);
          } else {
            console.log(`❌ Failed to execute signal for ${signal.coin}: ${result.error}`);
          }
        } catch (error) {
          console.error(`Error executing signal for ${signal.coin}:`, error);
        }
      }

      // 6. Update performance metrics
      this.updatePerformanceMetrics(account, positions);

      // 7. Log cycle summary
      this.logCycleSummary(account, positions, signals);
    } catch (error) {
      console.error('Error in trading cycle:', error);
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

    console.log(`📊 Cycle Summary:`);
    console.log(`   Runtime: ${runtimeMinutes}m`);
    console.log(`   Signals: ${signals.length}`);
    console.log(`   Trades: ${this.state.totalTrades}`);
    console.log(`   PnL: $${this.state.totalPnl.toFixed(2)}`);
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

  updateConfig(newConfig: Partial<WorkflowConfig>): void {
    this.config = { ...this.config, ...newConfig };
    this.riskManager.updateRiskParams(newConfig.riskParams || {});
  }
}

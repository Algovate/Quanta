import { Command } from 'commander';
import chalk from 'chalk';
import ora from 'ora';
import { SimulatorExchange } from '../../exchange/simulator';
import { MarketDataProvider } from '../../data/market';
import { MockAIAgent } from '../../ai/mock-agent';
import { RiskManager } from '../../execution/risk';
import { OrderExecutor } from '../../execution/orders';
import { PositionMonitorService } from '../../execution/monitor';
import { handleAsync } from '../../utils/error-handler';

export class SimulateCommands {
  static register(program: Command): void {
    program
      .command('cycle')
      .description('Simulate a complete trade cycle')
      .option('-c, --coins <coins>', 'Comma-separated list of coins (e.g., BTC,ETH,SOL)', 'BTC')
      .option('-b, --initial-balance <amount>', 'Initial balance in USD', '10000')
      .option('-v, --verbose', 'Show detailed logging', false)
      .option('-p, --max-positions <number>', 'Maximum number of concurrent positions', '3')
      .action(async (options) => {
        await handleAsync(async () => {
          await SimulateCommands.simulateCycle(options);
        }, 'SimulateCommands.cycle');
      });
  }

  private static async simulateCycle(options: {
    coins: string;
    initialBalance: string;
    verbose: boolean;
    maxPositions: string;
  }): Promise<void> {
    const coins = options.coins.split(',').map((c: string) => c.trim().toUpperCase());
    const initialBalance = parseFloat(options.initialBalance);
    const verbose = options.verbose;
    const maxPositions = parseInt(options.maxPositions);

    console.log(chalk.cyan('🎯 BetaArena - Multi-Coin Trade Cycle Simulation'));
    console.log(chalk.gray('='.repeat(60)));
    console.log(`Coins: ${coins.join(', ')} | Initial Balance: $${initialBalance.toLocaleString()}`);
    console.log(`Max Positions: ${maxPositions}`);
    console.log('');

    const spinner = ora('Initializing simulation...').start();

    try {
      // Initialize components
      const exchange = new SimulatorExchange(initialBalance);
      const marketProvider = new MarketDataProvider(exchange);
      const mockAI = new MockAIAgent();

      const riskParams = {
        maxRiskPerTrade: 0.05,
        maxTotalRisk: 0.30,
        maxPositions: maxPositions,
        defaultStopLoss: 0.03,
        maxLeverage: 40,
        minLeverage: 5,
      };

      const riskManager = new RiskManager(riskParams);
      const orderExecutor = new OrderExecutor(exchange, riskManager);
      const positionMonitor = new PositionMonitorService(riskManager, orderExecutor);

      spinner.succeed('Simulation initialized');

      // Execute the complete trade cycle
      await SimulateCommands.executeTradeCycle(
        exchange,
        marketProvider,
        mockAI,
        orderExecutor,
        positionMonitor,
        coins,
        verbose,
        initialBalance
      );

    } catch (error) {
      spinner.fail('Simulation failed');
      console.error('Error during simulation:', error);
      throw error;
    }
  }

  private static async executeTradeCycle(
    exchange: SimulatorExchange,
    marketProvider: MarketDataProvider,
    mockAI: MockAIAgent,
    orderExecutor: OrderExecutor,
    positionMonitor: PositionMonitorService,
    coins: string[],
    verbose: boolean,
    initialBalance: number
  ): Promise<void> {
    let cycleStartTime = Date.now();

    console.log(chalk.blue('\n📊 PHASE 1: PERCEPTION (Market Data Collection)'));
    console.log(chalk.gray('-'.repeat(60)));

    // Phase 1: Perception - Fetch market data for all coins
    const spinner1 = ora(`Fetching market data for ${coins.length} coin(s)...`).start();

    const allMarketData = [];
    for (const coin of coins) {
      const symbol = `${coin}/USDT`;
      const marketData = await marketProvider.getMarketData(symbol, ['3m', '4h']);
      allMarketData.push(...marketData);
    }

    if (allMarketData.length === 0) {
      spinner1.fail('Failed to fetch market data');
      throw new Error('No market data available');
    }

    spinner1.succeed(`Fetched ${allMarketData.length} dataset(s) for ${coins.length} coin(s)`);

    if (verbose) {
      // Group market data by coin for better display
      const marketDataByCoin = allMarketData.reduce((acc, data) => {
        if (!acc[data.coin]) acc[data.coin] = [];
        acc[data.coin].push(data);
        return acc;
      }, {} as Record<string, any[]>);

      Object.entries(marketDataByCoin).forEach(([coin, dataArray]) => {
        console.log(chalk.gray(`\n  📈 ${coin} Analysis:`));
        (dataArray as any[]).forEach(data => {
          console.log(chalk.gray(`    ✓ ${data.timeframe}: ${data.candlesticks.length} candles`));
          console.log(chalk.gray(`      - Current Price: $${data.currentPrice.toFixed(2)}`));
          console.log(chalk.gray(`      - Trend: ${data.trend} | Volatility: ${data.volatility}`));
          console.log(chalk.gray(`      - EMA20: $${data.indicators.ema20.toFixed(2)} | EMA50: $${data.indicators.ema50.toFixed(2)}`));
          console.log(chalk.gray(`      - MACD: ${data.indicators.macd.macd.toFixed(4)} | Signal: ${data.indicators.macd.signal.toFixed(4)}`));
          console.log(chalk.gray(`      - RSI(14): ${data.indicators.rsi14.toFixed(2)} | ATR(14): $${data.indicators.atr14.toFixed(2)}`));
        });
      });
    }

    // Phase 2: Decision - AI Analysis
    console.log(chalk.blue('\n🤖 PHASE 2: DECISION (AI Analysis)'));
    console.log(chalk.gray('-'.repeat(60)));

    const spinner2 = ora('Analyzing market conditions for all coins...').start();

    const account = await exchange.getAccount();
    const positions = await exchange.getPositions();

    const signals = await mockAI.generateTradingSignal(allMarketData, account, positions);

    spinner2.succeed(`Generated ${signals.length} signal(s) across ${coins.length} coin(s)`);

    if (signals.length === 0) {
      console.log(chalk.yellow('  No trading signals generated'));
    } else {
      // Group signals by coin for better display
      const signalsByCoin = signals.reduce((acc, signal) => {
        if (!acc[signal.coin]) acc[signal.coin] = [];
        acc[signal.coin].push(signal);
        return acc;
      }, {} as Record<string, any[]>);

      Object.entries(signalsByCoin).forEach(([coin, coinSignals]) => {
        console.log(chalk.green(`\n  📊 ${coin} Signals:`));
        (coinSignals as any[]).forEach(signal => {
          console.log(chalk.green(`    ✓ ${signal.action} ${signal.coin}`));
          if (verbose) {
            console.log(chalk.gray(`      - Confidence: ${(signal.confidence * 100).toFixed(1)}%`));
            if (signal.entry_price) {
              console.log(chalk.gray(`      - Entry Price: $${signal.entry_price.toFixed(2)}`));
            }
            if (signal.position_size) {
              console.log(chalk.gray(`      - Position Size: ${signal.position_size}`));
            }
            if (signal.stop_loss) {
              console.log(chalk.gray(`      - Stop Loss: ${(signal.stop_loss * 100).toFixed(1)}%`));
            }
            if (signal.profit_target) {
              console.log(chalk.gray(`      - Take Profit: ${(signal.profit_target * 100).toFixed(1)}%`));
            }
            console.log(chalk.gray(`      - Reasoning: ${signal.reasoning}`));
          }
        });
      });
    }

    // Phase 3: Execution - Risk Management & Order Placement
    console.log(chalk.blue('\n⚡ PHASE 3: EXECUTION (Risk Management & Order Placement)'));
    console.log(chalk.gray('-'.repeat(60)));

    let executedOrders = 0;
    let totalPnl = 0;

    for (const signal of signals) {
      if (signal.action === 'HOLD') {
        console.log(chalk.yellow(`  ⏸️  HOLD signal for ${signal.coin} - no action taken`));
        continue;
      }

      const spinner3 = ora(`Executing ${signal.action} signal for ${signal.coin}...`).start();

      try {
        const symbol = `${signal.coin}/USDT`;
        const ticker = await exchange.getTicker(symbol);
        const currentPrice = (ticker as { price: number }).price;

        const result = await orderExecutor.executeSignal(signal, account, positions, currentPrice);

        if (result.success && result.order) {
          spinner3.succeed(`${signal.action} order executed for ${signal.coin}`);
          executedOrders++;

          if (verbose) {
            console.log(chalk.gray(`    - Order ID: ${result.order.id}`));
            console.log(chalk.gray(`    - Amount: ${result.order.amount} ${signal.coin}`));
            console.log(chalk.gray(`    - Price: $${result.order.price?.toFixed(2)}`));
            console.log(chalk.gray(`    - Status: ${result.order.status}`));
          }
        } else {
          spinner3.fail(`Failed to execute ${signal.action} signal for ${signal.coin}`);
          if (verbose && result.error) {
            console.log(chalk.red(`    - Error: ${result.error}`));
          }
        }
      } catch (error) {
        spinner3.fail(`Error executing signal for ${signal.coin}: ${error}`);
      }
    }

    // Phase 4: Monitoring - Position Management
    console.log(chalk.blue('\n🔍 PHASE 4: MONITORING (Position Management)'));
    console.log(chalk.gray('-'.repeat(60)));

    const spinner4 = ora('Monitoring all positions...').start();

    // Get updated positions
    const updatedPositions = await exchange.getPositions();
    const updatedAccount = await exchange.getAccount();

    if (updatedPositions.length > 0) {
      spinner4.succeed(`Monitoring ${updatedPositions.length} position(s) across ${coins.length} coin(s)`);

      // Simulate price movement for all coins
      console.log(chalk.gray('  ✓ Simulating market movements...'));
      for (const coin of coins) {
        const symbol = `${coin}/USDT`;
        await SimulateCommands.simulatePriceMovement(exchange, symbol);
      }

      // Check positions
      await positionMonitor.monitorPositions(updatedPositions, exchange);

      // Get final positions and portfolio metrics
      const finalPositions = await exchange.getPositions();
      const finalAccount = await exchange.getAccount();
      const portfolioMetrics = await exchange.getPortfolioMetrics();

      totalPnl = finalAccount.equity - initialBalance;

      if (verbose) {
        console.log(chalk.gray('\n  📊 Portfolio Overview:'));
        console.log(chalk.gray(`    - Total Exposure: $${portfolioMetrics.totalExposure.toFixed(2)}`));
        console.log(chalk.gray(`    - Total Leverage: ${portfolioMetrics.leverage.toFixed(2)}x`));
        console.log(chalk.gray(`    - Total Unrealized P&L: $${portfolioMetrics.totalUnrealizedPnl.toFixed(2)}`));

        console.log(chalk.gray('\n  📊 Position Details by Symbol:'));
        Object.entries(portfolioMetrics.exposureBySymbol).forEach(([symbol, exposure]) => {
          const pnl = portfolioMetrics.pnlBySymbol[symbol] || 0;
          const pnlPercent = exposure > 0 ? (pnl / exposure) * 100 : 0;
          console.log(chalk.gray(`    📈 ${symbol}:`));
          console.log(chalk.gray(`      - Exposure: $${exposure.toFixed(2)}`));
          console.log(chalk.gray(`      - P&L: $${pnl.toFixed(2)} (${pnlPercent.toFixed(2)}%)`));
        });

        console.log(chalk.gray('\n  📊 Individual Positions:'));
        finalPositions.forEach(position => {
          const pnlPercent = (position.unrealizedPnl / (position.size * position.entryPrice)) * 100;
          console.log(chalk.gray(`    ✓ ${position.symbol}: ${position.side} ${position.size} @ $${position.entryPrice.toFixed(2)}`));
          console.log(chalk.gray(`      - Current Price: $${position.markPrice.toFixed(2)}`));
          console.log(chalk.gray(`      - Unrealized P&L: $${position.unrealizedPnl.toFixed(2)} (${pnlPercent.toFixed(2)}%)`));
          console.log(chalk.gray(`      - Margin Used: $${position.marginUsed.toFixed(2)}`));
        });
      }
    } else {
      spinner4.succeed('No positions to monitor');
    }

    // Generate Summary
    SimulateCommands.generateSummary(initialBalance, updatedAccount.equity, executedOrders, updatedPositions.length, totalPnl, coins.length);
  }

  private static async simulatePriceMovement(exchange: SimulatorExchange, symbol: string): Promise<void> {
    // This is a simple simulation - in a real scenario, you'd get live price updates
    console.log(chalk.gray('  ✓ Simulating market movement...'));

    // Add a small random price movement for demonstration
    const ticker = await exchange.getTicker(symbol);
    const currentPrice = (ticker as { price: number }).price;
    const movement = (Math.random() - 0.5) * 0.02; // ±1% movement
    const newPrice = currentPrice * (1 + movement);

    console.log(chalk.gray(`  ✓ Price movement: $${currentPrice.toFixed(2)} → $${newPrice.toFixed(2)} (${(movement * 100).toFixed(2)}%)`));
  }

  private static generateSummary(
    initialBalance: number,
    finalEquity: number,
    executedOrders: number,
    openPositions: number,
    totalPnl: number,
    coinsAnalyzed: number
  ): void {
    console.log(chalk.blue('\n📈 PORTFOLIO SUMMARY'));
    console.log(chalk.gray('='.repeat(60)));

    const pnlPercent = (totalPnl / initialBalance) * 100;
    const pnlColor = totalPnl >= 0 ? chalk.green : chalk.red;
    const pnlSign = totalPnl >= 0 ? '+' : '';

    console.log(`Initial Balance:    $${initialBalance.toLocaleString()}`);
    console.log(`Final Equity:       $${finalEquity.toLocaleString()}`);
    console.log(`Total P&L:          ${pnlColor(`${pnlSign}$${totalPnl.toFixed(2)} (${pnlSign}${pnlPercent.toFixed(2)}%)`)}`);
    console.log(`Coins Analyzed:     ${coinsAnalyzed}`);
    console.log(`Orders Executed:    ${executedOrders}`);
    console.log(`Open Positions:     ${openPositions}`);
    console.log(`Risk Level:         ${SimulateCommands.getRiskLevel(Math.abs(pnlPercent))}`);

    // Portfolio diversification info
    if (coinsAnalyzed > 1) {
      console.log(`Diversification:    ${coinsAnalyzed} coins`);
    }

    console.log(chalk.gray('\n' + '='.repeat(60)));
    console.log(chalk.green('✅ Multi-coin multi-position simulation completed successfully!'));
  }

  private static getRiskLevel(pnlPercent: number): string {
    if (pnlPercent < 1) return chalk.green('LOW');
    if (pnlPercent < 3) return chalk.yellow('MEDIUM');
    return chalk.red('HIGH');
  }
}

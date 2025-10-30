import { Command } from 'commander';
import chalk from 'chalk';
import ora from 'ora';
import fs from 'fs';
import path from 'path';
import { SimulatorExchange } from '../../exchange/simulator.js';
import { MarketDataProvider } from '../../data/market.js';
import { MockAIAgent } from '../../ai/mock-agent.js';
import { OpenRouterClient } from '../../ai/agent.js';
import { RiskManager } from '../../execution/risk.js';
import { OrderExecutor } from '../../execution/orders.js';
import { PositionMonitorService } from '../../execution/monitor.js';
import { handleAsync } from '../../utils/error-handler.js';

interface SimulateConfig {
  simulation: {
    enabled: boolean;
    defaultInitialBalance: number;
    defaultMaxPositions: number;
    defaultAI: string;
    autoRun: boolean;
    confirmBeforeExecute: boolean;
  };
  scenarios: {
    defaultCoins: string[];
    testScenarios: string[];
  };
  risk: {
    minConfidence: number;
    maxRiskPerTrade: number;
    maxTotalRisk: number;
    stopLoss: number;
    takeProfit: number;
  };
  logging: {
    verbose: boolean;
    logTrades: boolean;
    logPositions: boolean;
    logRiskMetrics: boolean;
    saveResults: boolean;
    resultsDir: string;
  };
  performance: {
    trackPnL: boolean;
    trackDrawdown: boolean;
    calculateSharpeRatio: boolean;
    benchmark: string;
  };
  ai: {
    mock: {
      signalInterval: number;
      confidenceRange: {
        min: number;
        max: number;
      };
    };
    real: {
      apiKey: string;
      model: string;
      temperature: number;
      maxRetries: number;
      timeout: number;
    };
  };
}

export class SimulateCommands {
  private static isRunning = false;

  private static loadSimulateConfig(): Partial<SimulateConfig> {
    try {
      const configPath = path.join(process.cwd(), 'config', 'simulate.json');
      if (fs.existsSync(configPath)) {
        const configData = fs.readFileSync(configPath, 'utf8');
        return JSON.parse(configData);
      }
    } catch {
      console.warn(chalk.yellow('Warning: Could not load simulate.json, using defaults'));
    }
    return {};
  }

  static register(program: Command): void {
    program
      .command('cycle')
      .description(
        'Simulate a complete trade cycle (Perception → Decision → Execution → Monitoring)'
      )
      .option('-c, --coins <coins>', 'Comma-separated list of coins (e.g., BTC,ETH,SOL)', 'BTC')
      .option('-b, --initial-balance <amount>', 'Initial balance in USD', '10000')
      .option('-v, --verbose', 'Show detailed logging', false)
      .option('-p, --max-positions <number>', 'Maximum number of concurrent positions', '3')
      .option(
        '-a, --ai <type>',
        'AI type: mock or real (requires API key in config/simulate.json)',
        'mock'
      )
      .action(async options => {
        if (SimulateCommands.isRunning) {
          return;
        }

        SimulateCommands.isRunning = true;

        try {
          await handleAsync(async () => {
            await SimulateCommands.simulateCycle(options);
          }, 'SimulateCommands.cycle');
        } finally {
          SimulateCommands.isRunning = false;
        }
      });
  }

  private static async simulateCycle(options: {
    coins: string;
    initialBalance: string;
    verbose: boolean;
    maxPositions: string;
    ai: string;
  }): Promise<void> {
    // Load simulation-specific configuration only
    const simulateConfig = SimulateCommands.loadSimulateConfig();

    // Parse and validate options with simulation config as base
    const coins = options.coins.split(',').map((c: string) => c.trim().toUpperCase());
    const initialBalance =
      parseFloat(options.initialBalance) ||
      simulateConfig.simulation?.defaultInitialBalance ||
      10000;
    const verbose = options.verbose || simulateConfig.logging?.verbose || false;
    const maxPositions =
      parseInt(options.maxPositions) || simulateConfig.simulation?.defaultMaxPositions || 6;

    // Validate options
    const aiType = options.ai.toLowerCase();
    if (aiType !== 'mock' && aiType !== 'real') {
      console.error(chalk.red('❌ Error: Invalid AI type. Use "mock" or "real"'));
      console.log(chalk.yellow('   Example: --ai mock (or --ai real)'));
      process.exit(1);
    }

    const useRealAI = aiType === 'real';

    // Validate coins
    if (coins.length === 0) {
      console.error(chalk.red('❌ Error: At least one coin is required'));
      process.exit(1);
    }

    // Validate balance
    if (initialBalance <= 0) {
      console.error(chalk.red('❌ Error: Initial balance must be greater than 0'));
      process.exit(1);
    }

    // Validate max positions
    if (maxPositions <= 0) {
      console.error(chalk.red('❌ Error: Max positions must be greater than 0'));
      process.exit(1);
    }

    console.log(chalk.cyan('🎯 Quanta - Multi-Coin Trade Cycle Simulation'));
    console.log(chalk.gray('='.repeat(60)));
    console.log(
      `Coins: ${coins.join(', ')} | Initial Balance: $${initialBalance.toLocaleString()}`
    );
    console.log(`Max Positions: ${maxPositions}`);
    console.log(`AI Type: ${useRealAI ? 'Real AI (OpenRouter)' : 'Mock AI'}`);
    if (useRealAI && simulateConfig.ai?.real?.model) {
      console.log(`AI Model: ${simulateConfig.ai.real.model}`);
    }
    console.log('');

    const spinner = ora('Initializing simulation...').start();

    try {
      // Initialize components
      const exchange = new SimulatorExchange(initialBalance);
      const marketProvider = new MarketDataProvider(exchange);

      // Initialize AI agent based on selection
      let aiAgent;
      if (useRealAI) {
        // Try environment variable first, then simulation config
        const apiKey = process.env.OPENROUTER_API_KEY || simulateConfig.ai?.real?.apiKey;
        if (!apiKey) {
          spinner.fail('Real AI requires OPENROUTER_API_KEY');
          console.error(chalk.red('\n❌ Error: Real AI mode requires API key'));
          console.log(chalk.yellow('\n💡 To use real AI:'));
          console.log(chalk.yellow('  1. Get API key from https://openrouter.ai'));
          console.log(
            chalk.yellow('  2. Set environment variable or update config/simulate.json:')
          );
          console.log(chalk.gray('     export OPENROUTER_API_KEY="your_api_key_here"'));
          console.log(chalk.gray('     or edit config/simulate.json: ai.real.apiKey'));
          console.log(chalk.yellow('  3. Or use Mock AI (default):'));
          console.log(chalk.gray('     quanta simulate cycle --coins BTC --ai mock'));
          process.exit(1);
        }
        aiAgent = new OpenRouterClient(apiKey);
        console.log(chalk.green('✓ Real AI initialized'));
      } else {
        aiAgent = new MockAIAgent();
        console.log(chalk.green('✓ Mock AI initialized'));
      }

      const riskParams = {
        maxRiskPerTrade: simulateConfig.risk?.maxRiskPerTrade || 0.05,
        maxTotalRisk: simulateConfig.risk?.maxTotalRisk || 0.3,
        maxPositions: maxPositions,
        defaultStopLoss: simulateConfig.risk?.stopLoss || 0.03,
        maxLeverage: 1, // No leverage for simulations
        minLeverage: 1, // No leverage for simulations
      };

      const riskManager = new RiskManager(riskParams);
      const orderExecutor = new OrderExecutor(exchange, riskManager);
      const positionMonitor = new PositionMonitorService(riskManager, orderExecutor);

      spinner.succeed('Simulation initialized');

      // Execute the complete trade cycle
      await SimulateCommands.executeTradeCycle(
        exchange,
        marketProvider,
        aiAgent,
        orderExecutor,
        positionMonitor,
        coins,
        verbose,
        initialBalance,
        useRealAI,
        maxPositions
      );
    } catch (error) {
      spinner.fail('Simulation failed');

      // Don't show duplicate error messages
      if (!(error instanceof Error && error.message.includes('OPENROUTER_API_KEY not found'))) {
        console.error(chalk.red('\n❌ Simulation Error:'));
        console.error(chalk.red(`   ${error instanceof Error ? error.message : String(error)}`));

        console.log(chalk.yellow('\n💡 Common Issues:'));
        console.log(chalk.yellow('  1. Check if all required parameters are valid'));
        console.log(chalk.yellow('  2. Verify network connection (for market data)'));
        console.log(chalk.yellow('  3. Check API credentials (for Real AI mode)'));
        console.log(chalk.yellow('  4. Review verbose output with --verbose flag'));

        console.log(chalk.yellow('\n📚 For help:'));
        console.log(chalk.gray('     quanta simulate cycle --help'));
      }

      throw error;
    }
  }

  private static async executeTradeCycle(
    exchange: SimulatorExchange,
    marketProvider: MarketDataProvider,
    aiAgent: any,
    orderExecutor: OrderExecutor,
    positionMonitor: PositionMonitorService,
    coins: string[],
    verbose: boolean,
    initialBalance: number,
    useRealAI: boolean,
    maxPositions: number
  ): Promise<void> {
    const cycleStartTime = Date.now();

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
      console.error(chalk.red('\n❌ Error: No market data available'));
      console.log(chalk.yellow('\n💡 Possible solutions:'));
      console.log(chalk.yellow(`  1. Check network connection`));
      console.log(chalk.yellow(`  2. Verify coins are valid: ${coins.join(', ')}`));
      console.log(chalk.yellow(`  3. Try different coins: --coins BTC,ETH`));
      throw new Error('No market data available');
    }

    spinner1.succeed(`Fetched ${allMarketData.length} dataset(s) for ${coins.length} coin(s)`);

    if (verbose) {
      // Group market data by coin for better display
      const marketDataByCoin = allMarketData.reduce(
        (acc, data) => {
          if (!acc[data.coin]) acc[data.coin] = [];
          acc[data.coin].push(data);
          return acc;
        },
        {} as Record<string, any[]>
      );

      Object.entries(marketDataByCoin).forEach(([coin, dataArray]) => {
        console.log(chalk.gray(`\n  📈 ${coin} Analysis:`));
        (dataArray as any[]).forEach(data => {
          console.log(chalk.gray(`    ✓ ${data.timeframe}: ${data.candlesticks.length} candles`));
          console.log(chalk.gray(`      - Current Price: $${data.currentPrice.toFixed(2)}`));
          console.log(chalk.gray(`      - Trend: ${data.trend} | Volatility: ${data.volatility}`));
          console.log(
            chalk.gray(
              `      - EMA20: $${data.indicators.ema20.toFixed(2)} | EMA50: $${data.indicators.ema50.toFixed(2)}`
            )
          );
          console.log(
            chalk.gray(
              `      - MACD: ${data.indicators.macd.macd.toFixed(4)} | Signal: ${data.indicators.macd.signal.toFixed(4)}`
            )
          );
          console.log(
            chalk.gray(
              `      - RSI(14): ${data.indicators.rsi14.toFixed(2)} | ATR(14): $${data.indicators.atr14.toFixed(2)}`
            )
          );
          if (data.indicators.bollinger) {
            const b = data.indicators.bollinger;
            console.log(
              chalk.gray(
                `      - Bollinger: pos=${b.position} | %B=${b.percentB.toFixed(2)} | BW=${b.bandwidth.toFixed(3)}`
              )
            );
          }
          if (data.indicators.volume) {
            console.log(
              chalk.gray(
                `      - Volume: SMA20=${data.indicators.volume.sma20.toFixed(0)} | Ratio=${data.indicators.volume.ratio.toFixed(2)}`
              )
            );
          }
          if (data.indicators.supportResistance) {
            const sr = data.indicators.supportResistance;
            const ds = sr.distToSupport != null ? (sr.distToSupport * 100).toFixed(2) + '%' : 'n/a';
            const dr =
              sr.distToResistance != null ? (sr.distToResistance * 100).toFixed(2) + '%' : 'n/a';
            console.log(
              chalk.gray(
                `      - S/R: S=${sr.support ?? 'n/a'} | R=${sr.resistance ?? 'n/a'} | dS=${ds} | dR=${dr}`
              )
            );
          }
        });
      });
    }

    // Phase 2: Decision - AI Analysis
    console.log(chalk.blue('\n🤖 PHASE 2: DECISION (AI Analysis)'));
    console.log(chalk.gray('-'.repeat(60)));

    const spinner2 = ora('Analyzing market conditions for all coins...').start();

    const account = await exchange.getAccount();
    const positions = await exchange.getPositions();

    // Create context for AI
    const context = {
      startTime: cycleStartTime,
      currentTime: Date.now(),
      invokeCount: 1,
      tradableCoins: coins,
      maxPositions: maxPositions,
      maxRiskPerTrade: 0.05,
      maxLeverage: 1,
      minLeverage: 1,
      defaultStopLoss: 0.03,
    };

    let signals;
    try {
      signals = await aiAgent.generateTradingSignal(allMarketData, account, positions, context);
    } catch (error) {
      spinner2.fail('AI analysis failed');
      console.error(chalk.red(`\n❌ Error: Failed to generate trading signals`));
      console.error(chalk.red(`   ${error instanceof Error ? error.message : String(error)}`));

      if (useRealAI) {
        console.log(chalk.yellow('\n💡 Troubleshooting tips for Real AI:'));
        console.log(chalk.yellow('  1. Verify OPENROUTER_API_KEY is set correctly'));
        console.log(chalk.yellow('  2. Check API key is valid and has credits'));
        console.log(chalk.yellow('  3. Review error message above for details'));
        console.log(chalk.yellow('\n   Or use Mock AI instead:'));
        console.log(chalk.gray('     quanta simulate cycle --coins BTC --ai mock'));
      }
      throw error;
    }

    spinner2.succeed(`Generated ${signals.length} signal(s) across ${coins.length} coin(s)`);

    if (signals.length === 0) {
      console.log(chalk.yellow('  No trading signals generated'));
    } else {
      // Group signals by coin for better display
      const signalsByCoin = signals.reduce(
        (acc, signal) => {
          if (!acc[signal.coin]) acc[signal.coin] = [];
          acc[signal.coin].push(signal);
          return acc;
        },
        {} as Record<string, any[]>
      );

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
              console.log(
                chalk.gray(`      - Take Profit: ${(signal.profit_target * 100).toFixed(1)}%`)
              );
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
    await exchange.getAccount();

    if (updatedPositions.length > 0) {
      spinner4.succeed(
        `Monitoring ${updatedPositions.length} position(s) across ${coins.length} coin(s)`
      );

      // Simulate price movement for all coins
      console.log(chalk.gray('  ✓ Simulating market movements...'));
      for (const coin of coins) {
        const symbol = `${coin}/USDT`;
        await SimulateCommands.simulatePriceMovement(exchange, symbol);
      }

      // Check positions
      await positionMonitor.monitorPositions(updatedPositions, exchange);
    } else {
      spinner4.succeed('No positions to monitor');
    }

    // Get final positions and portfolio metrics
    const finalPositions = await exchange.getPositions();
    const finalAccount = await exchange.getAccount();
    const portfolioMetrics = await exchange.getPortfolioMetrics();

    totalPnl = finalAccount.equity - initialBalance;

    if (finalPositions.length > 0 && verbose) {
      console.log(chalk.gray('\n  📊 Portfolio Overview:'));
      console.log(
        chalk.gray(`    - Total Exposure: $${portfolioMetrics.totalExposure.toFixed(2)}`)
      );
      console.log(chalk.gray(`    - Total Leverage: ${portfolioMetrics.leverage.toFixed(2)}x`));
      console.log(
        chalk.gray(`    - Total Unrealized P&L: $${portfolioMetrics.totalUnrealizedPnl.toFixed(2)}`)
      );

      console.log(chalk.gray('\n  📊 Position Details by Symbol:'));
      Object.entries(portfolioMetrics.exposureBySymbol).forEach(([symbol, exposure]) => {
        const pnl = portfolioMetrics.pnlBySymbol[symbol] || 0;
        // Calculate P&L percentage as ROI on invested capital (exposure)
        // For accurate ROI: P&L / exposure * 100
        const pnlPercent = exposure > 0 ? (pnl / exposure) * 100 : 0;
        console.log(chalk.gray(`    📈 ${symbol}:`));
        console.log(chalk.gray(`      - Exposure: $${exposure.toFixed(2)}`));
        console.log(chalk.gray(`      - P&L: $${pnl.toFixed(2)} (${pnlPercent.toFixed(2)}% ROI)`));
      });

      console.log(chalk.gray('\n  📊 Individual Positions:'));

      // Header
      console.log(chalk.gray('\n    │ SIDE     │ COIN │ LEVERAGE │ NOTIONAL    │ UNREAL P&L'));
      console.log(chalk.gray('    ├──────────┼──────┼──────────┼──────────────┼────────────'));

      // Position rows
      finalPositions.forEach(position => {
        const sideColor = position.side === 'long' ? chalk.green : chalk.red;
        const sideText = position.side === 'long' ? 'LONG' : 'SHORT';
        const leverageText = `${position.leverage}X`;
        const notionalText = `$${position.notional.toFixed(2)}`;
        const pnlColor = position.unrealizedPnl >= 0 ? chalk.green : chalk.red;
        const pnlText = `$${position.unrealizedPnl.toFixed(2)}`;

        console.log(
          chalk.gray(
            `    │ ${sideColor(sideText.padEnd(8))} │ ${position.symbol.replace('/USDT', '').padEnd(4)} │ ${chalk.cyan(leverageText.padEnd(8))} │ ${chalk.cyan(notionalText.padEnd(13))} │ ${pnlColor(pnlText.padEnd(11))}`
          )
        );
      });
    }

    // Generate Summary
    SimulateCommands.generateSummary(
      initialBalance,
      finalAccount,
      executedOrders,
      finalPositions.length,
      totalPnl,
      coins.length
    );
  }

  private static async simulatePriceMovement(
    exchange: SimulatorExchange,
    symbol: string
  ): Promise<void> {
    // This is a simple simulation - in a real scenario, you'd get live price updates
    console.log(chalk.gray('  ✓ Simulating market movement...'));

    // Add a small random price movement for demonstration
    const ticker = await exchange.getTicker(symbol);
    const currentPrice = (ticker as { price: number }).price;
    const movement = (Math.random() - 0.5) * 0.02; // ±1% movement
    const newPrice = currentPrice * (1 + movement);

    console.log(
      chalk.gray(
        `  ✓ Price movement: $${currentPrice.toFixed(2)} → $${newPrice.toFixed(2)} (${(movement * 100).toFixed(2)}%)`
      )
    );
  }

  private static generateSummary(
    initialBalance: number,
    finalAccount: any,
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

    // Available cash is the available margin (free to use)
    const availableCash = finalAccount.availableMargin || 0;

    console.log(chalk.magenta(`TOTAL ACCOUNT VALUE: $${finalAccount.equity.toFixed(2)}`));
    console.log(`Initial Balance:    $${initialBalance.toLocaleString()}`);
    console.log(`Available Cash:    $${availableCash.toFixed(2)}`);
    console.log(
      `Total P&L:          ${pnlColor(`${pnlSign}$${totalPnl.toFixed(2)} (${pnlSign}${pnlPercent.toFixed(2)}%)`)}`
    );
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

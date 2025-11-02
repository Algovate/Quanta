import { Command } from 'commander';
import chalk from 'chalk';
import { getConfig } from '../../config/settings.js';
import { handleAsync } from '../../utils/error-handler.js';

export class TestCommands {
  static register(program: Command): void {
    program
      .command('exchange')
      .description('Test exchange connectivity and data retrieval')
      .option('-e, --exchange <exchange>', 'Exchange to test', 'simulator')
      .option('-a, --all', 'Test all supported exchanges', false)
      .option('-c, --coin <coin>', 'Coin to test', 'BTC')
      .option('-t, --timeframe <timeframe>', 'Timeframe to test', '3m')
      .option('-l, --limit <limit>', 'Number of candles to fetch', '20')
      .option('-v, --verbose', 'Show detailed output when testing all exchanges', false)
      .action(async options => {
        try {
          await TestCommands.testExchange(options);
        } catch {
          // Error already displayed in testExchange, just exit
          process.exit(1);
        }
      });

    program
      .command('ai')
      .description('Test AI integration (Mock and Real AI)')
      .option('-t, --type <type>', 'AI type to test: mock, real, or both', 'both')
      .option('-c, --coin <coin>', 'Coin to test', 'BTC')
      .option('-v, --verbose', 'Show detailed output', false)
      .action(async options => {
        await handleAsync(async () => {
          await TestCommands.testAI(options);
        }, 'TestCommands.ai');
      });
  }

  private static async createExchangeInstance(
    exchangeName: string,
    apiKey?: string,
    apiSecret?: string,
    testnet: boolean = true
  ): Promise<any> {
    const name = exchangeName.toLowerCase();

    if (name === 'simulator') {
      const { SimulatorExchange } = await import('../../exchange/simulator.js');
      return new SimulatorExchange(10000);
    } else if (name === 'okx') {
      const { OKXExchange } = await import('../../exchange/okx.js');
      return new OKXExchange(apiKey, apiSecret, testnet);
    } else if (name === 'coinbase' || name === 'cb') {
      const { CoinbaseExchange } = await import('../../exchange/coinbase.js');
      return new CoinbaseExchange(apiKey, apiSecret, testnet);
    } else if (name === 'binance' || name === 'bin') {
      const { BinanceExchange } = await import('../../exchange/binance.js');
      return new BinanceExchange(apiKey, apiSecret, testnet);
    } else if (name === 'hyperliquid' || name === 'hliq') {
      const { HyperliquidExchange } = await import('../../exchange/hyperliquid.js');
      return new HyperliquidExchange(apiKey, apiSecret, testnet);
    } else {
      throw new Error(`Unsupported exchange: ${exchangeName}`);
    }
  }

  private static async testExchange(options: {
    exchange?: string;
    all?: boolean;
    coin: string;
    timeframe: string;
    limit: string;
    verbose?: boolean;
  }): Promise<void> {
    if (options.all) {
      if (options.verbose) {
        await TestCommands.testAllExchangesDetailed(options);
      } else {
        await TestCommands.testAllExchangesQuick(options);
      }
    } else {
      const exchange = options.exchange || 'simulator';
      await TestCommands.testSingleExchangeDetailed({
        exchange,
        coin: options.coin,
        timeframe: options.timeframe,
        limit: options.limit,
      });
    }
  }

  private static async testSingleExchangeDetailed(options: {
    exchange: string;
    coin: string;
    timeframe: string;
    limit: string;
  }): Promise<void> {
    console.log(chalk.cyan('📊 Testing Exchange Data Retrieval'));
    console.log(
      chalk.gray(
        `Exchange: ${options.exchange}, Coin: ${options.coin}, Timeframe: ${options.timeframe}, Limit: ${options.limit}\n`
      )
    );

    const symbol = `${options.coin}/USDT`;

    const { MarketDataProvider } = await import('../../data/market.js');

    const apiKey = process.env[`${options.exchange.toUpperCase()}_API_KEY`];
    const apiSecret = process.env[`${options.exchange.toUpperCase()}_API_SECRET`];

    const exchange = await TestCommands.createExchangeInstance(
      options.exchange,
      apiKey,
      apiSecret,
      true
    );

    if (options.exchange !== 'simulator' && (!apiKey || !apiSecret)) {
      console.log(chalk.yellow(`⚠️  No API credentials found for ${options.exchange}`));
      console.log(chalk.gray(`   Using public data access (K-line data, market info)`));
      console.log(chalk.gray(`   Trading operations will require API credentials\n`));
    }

    const provider = new MarketDataProvider(exchange);

    // Test 1: Ticker data (real-time)
    console.log(chalk.yellow('🔍 Test 1: Real-time Ticker Data'));
    let latestPrice = 0;
    try {
      const ticker = await exchange.getTicker(symbol);
      latestPrice = ticker.price;
      console.log(chalk.green('✅ Ticker data retrieved:'));
      console.log(`   Current Price: $${latestPrice.toFixed(2)}`);
      const { formatUTCTime } = await import('../../utils/time.js');
      console.log(`   Timestamp: ${formatUTCTime(ticker.timestamp ?? Date.now())}`);
    } catch (error: any) {
      console.log(chalk.yellow(`⚠️  Ticker data unavailable: ${error?.message || String(error)}`));
    }

    // Test 2: Basic K-line data
    console.log(chalk.yellow('\n🔍 Test 2: Historical K-line Data'));
    let klines;
    try {
      klines = await exchange.getCandlesticks(symbol, options.timeframe, parseInt(options.limit));
      console.log(chalk.green(`✅ Retrieved ${klines.length} K-lines`));

      // Show latest candles
      const { formatUTCTimeCompact } = await import('../../utils/time.js');
      if (klines.length >= 3) {
        console.log(chalk.gray('\n📈 Latest 3 candles:'));
        klines.slice(-3).forEach((kline, index) => {
          const time = formatUTCTimeCompact(kline.timestamp);
          console.log(
            `   ${index + 1}. ${time}: O:$${kline.open.toFixed(2)} H:$${kline.high.toFixed(2)} L:$${kline.low.toFixed(2)} C:$${kline.close.toFixed(2)} V:${kline.volume.toFixed(2)}`
          );
        });
      } else if (klines.length > 0) {
        console.log(chalk.gray('\n📈 Latest candle:'));
        const kline = klines[klines.length - 1];
        const time = formatUTCTimeCompact(kline.timestamp);
        console.log(
          `   ${time}: O:$${kline.open.toFixed(2)} H:$${kline.high.toFixed(2)} L:$${kline.low.toFixed(2)} C:$${kline.close.toFixed(2)} V:${kline.volume.toFixed(2)}`
        );
      }
    } catch (error: any) {
      console.log(chalk.red(`❌ Failed to retrieve K-line data\n`));

      // Clean up error message
      let errorMsg = error.message || String(error);

      // Extract key message from long error messages
      if (errorMsg.length > 200) {
        // Try to extract JSON message
        const jsonMatch = errorMsg.match(/"msg":\s*"([^"]+)"/);
        if (jsonMatch && jsonMatch[1]) {
          errorMsg = jsonMatch[1];
        } else {
          // Get first 200 chars
          errorMsg = errorMsg.substring(0, 200) + '...';
        }
      }

      console.log(chalk.red(`   Error: ${errorMsg}`));

      // Provide helpful suggestions
      if (errorMsg.includes('restricted location') || errorMsg.includes('451')) {
        console.log(chalk.yellow('\n💡 Suggestion: Binance may be restricted in your location'));
        console.log(chalk.gray('   Try using OKX or Coinbase instead'));
      } else if (errorMsg.includes('network') || errorMsg.includes('timeout')) {
        console.log(chalk.yellow('\n💡 Suggestion: Network issue detected'));
        console.log(chalk.gray('   Check your internet connection and try again'));
      } else if (errorMsg.includes('rate limit')) {
        console.log(chalk.yellow('\n💡 Suggestion: Rate limit exceeded'));
        console.log(chalk.gray('   Wait a moment and try again'));
      }

      console.log(''); // Empty line before stack trace
      throw error;
    }

    // Test 3: Market data with indicators
    console.log(chalk.yellow('\n🔍 Test 3: Technical Analysis with Indicators'));
    const marketData = await provider.getMarketData(symbol, [options.timeframe]);

    if (marketData.length > 0) {
      const data = marketData[0];
      console.log(chalk.green('✅ Market data retrieved:'));
      console.log(chalk.blue('📊 Market Analysis:'));
      const dataSource =
        exchange.constructor.name === 'SimulatorExchange'
          ? 'Simulated Market'
          : exchange.getExchangeName
            ? exchange.getExchangeName()
            : 'Unknown Exchange';
      console.log(`   Data Source: ${dataSource}`);
      console.log(`   Analysis Method: Technical Indicators (100-period)`);
      console.log(`   Current Price: $${data.currentPrice.toFixed(2)}`);
      console.log(`   Trend: ${data.trend}`);
      console.log(`   Volatility: ${data.volatility}`);

      // Moving Averages
      console.log(chalk.gray('\n   Moving Averages:'));
      if (data.indicators.sma5) {
        console.log(`   SMA5:  $${data.indicators.sma5.toFixed(2)}`);
      }
      if (data.indicators.sma20) {
        console.log(`   SMA20: $${data.indicators.sma20.toFixed(2)}`);
      }
      if (data.indicators.sma50) {
        console.log(`   SMA50: $${data.indicators.sma50.toFixed(2)}`);
      }
      if (data.indicators.ema5) {
        console.log(`   EMA5:  $${data.indicators.ema5.toFixed(2)}`);
      }
      console.log(`   EMA20: $${data.indicators.ema20.toFixed(2)}`);
      console.log(`   EMA50: $${data.indicators.ema50.toFixed(2)}`);

      // Momentum & Volatility
      console.log(chalk.gray('\n   Momentum & Volatility:'));
      console.log(`   RSI14: ${data.indicators.rsi14.toFixed(2)}`);
      console.log(`   ATR14: $${data.indicators.atr14.toFixed(2)}`);

      // MACD
      console.log(chalk.gray('\n   MACD:'));
      console.log(`   Line:     ${data.indicators.macd.macd.toFixed(4)}`);
      console.log(`   Signal:   ${data.indicators.macd.signal.toFixed(4)}`);
      console.log(`   Histogram: ${data.indicators.macd.histogram.toFixed(4)}`);

      // Bollinger Bands
      if (data.indicators.bollinger) {
        console.log(chalk.gray('\n   Bollinger Bands:'));
        console.log(`   Upper:   $${data.indicators.bollinger.upper.toFixed(2)}`);
        console.log(`   Middle:  $${data.indicators.bollinger.middle.toFixed(2)}`);
        console.log(`   Lower:   $${data.indicators.bollinger.lower.toFixed(2)}`);
        console.log(`   %B:      ${data.indicators.bollinger.percentB.toFixed(4)}`);
        console.log(`   Position: ${data.indicators.bollinger.position}`);
      }

      // Support & Resistance
      if (data.indicators.supportResistance) {
        console.log(chalk.gray('\n   Support & Resistance:'));
        if (data.indicators.supportResistance.support) {
          console.log(`   Support:  $${data.indicators.supportResistance.support.toFixed(2)}`);
        } else {
          console.log(`   Support:  N/A`);
        }
        if (data.indicators.supportResistance.resistance) {
          console.log(`   Resistance: $${data.indicators.supportResistance.resistance.toFixed(2)}`);
        } else {
          console.log(`   Resistance: N/A`);
        }
      }

      // Volume Metrics
      if (data.indicators.volume) {
        console.log(chalk.gray('\n   Volume Metrics:'));
        console.log(`   SMA20: $${data.indicators.volume.sma20.toFixed(2)}`);
        console.log(`   Ratio:  ${data.indicators.volume.ratio.toFixed(2)}`);
        if (data.indicators.volume.obv !== undefined) {
          console.log(`   OBV:    ${data.indicators.volume.obv.toFixed(2)}`);
        }
      }
    }

    // Test 4: Account info (skip if no API credentials for non-simulator exchanges)
    console.log(chalk.yellow('\n🔍 Test 4: Account Information'));
    const isSimulator = exchange.constructor.name === 'SimulatorExchange';
    const hasApiKey = !!(
      options.exchange === 'simulator' || process.env[`${options.exchange.toUpperCase()}_API_KEY`]
    );

    if (isSimulator || hasApiKey) {
      try {
        const account = await exchange.getAccount();
        console.log(chalk.green('✅ Account info retrieved:'));
        console.log(chalk.blue('💰 Account Details:'));
        console.log(
          `   Account Type: ${isSimulator ? 'Simulation Account' : 'Live Trading Account'}`
        );
        console.log(
          `   Exchange: ${exchange.getExchangeName ? exchange.getExchangeName() : 'Simulator'}`
        );
        console.log(`   Balance: $${account.balance.toFixed(2)}`);
        console.log(`   Equity: $${account.equity.toFixed(2)}`);
        console.log(`   Available Margin: $${account.availableMargin.toFixed(2)}`);
        console.log(`   Used Margin: $${account.usedMargin.toFixed(2)}`);
        console.log(`   Margin Ratio: ${account.marginRatio.toFixed(2)}%`);
      } catch (error: any) {
        console.log(chalk.yellow('⚠️  Account info not available without API credentials'));
        console.log(chalk.gray(`   ${error.message}`));
      }
    } else {
      console.log(chalk.yellow('⚠️  Account info skipped (requires API credentials)'));
      console.log(
        chalk.gray(
          `   Set ${options.exchange.toUpperCase()}_API_KEY and ${options.exchange.toUpperCase()}_API_SECRET to test account data`
        )
      );
    }

    // Summary
    console.log(
      chalk.green('\n🎯 All tests passed! Exchange data retrieval is working correctly.')
    );
  }

  private static async testAllExchangesQuick(options: {
    coin: string;
    timeframe: string;
    limit: string;
  }): Promise<void> {
    console.log(chalk.cyan('📊 Testing All Exchanges (Quick Mode)'));
    console.log(
      chalk.gray(
        `Coin: ${options.coin}, Timeframe: ${options.timeframe}, Limit: ${options.limit}\n`
      )
    );

    const symbol = `${options.coin}/USDT`;
    const exchanges = ['simulator', 'okx', 'coinbase', 'hyperliquid'];

    for (const exchangeName of exchanges) {
      console.log(chalk.yellow(`🔍 Testing ${exchangeName.toUpperCase()} Exchange:`));
      console.log('='.repeat(50));

      try {
        const { MarketDataProvider } = await import('../../data/market.js');

        const apiKey = process.env[`${exchangeName.toUpperCase()}_API_KEY`];
        const apiSecret = process.env[`${exchangeName.toUpperCase()}_API_SECRET`];

        const exchange = await TestCommands.createExchangeInstance(
          exchangeName,
          apiKey,
          apiSecret,
          true
        );

        if (exchangeName !== 'simulator' && (!apiKey || !apiSecret)) {
          console.log(chalk.yellow(`⚠️  No API credentials found for ${exchangeName}`));
          console.log(chalk.gray(`   Using public data access\n`));
        }

        const provider = new MarketDataProvider(exchange);

        // Test K-line data
        const klines = await exchange.getCandlesticks(
          symbol,
          options.timeframe,
          parseInt(options.limit)
        );
        console.log(chalk.green(`✅ K-line data: ${klines.length} candles`));

        if (klines.length > 0) {
          const latest = klines[klines.length - 1];
          console.log(`   📈 Latest price: $${latest.close.toFixed(2)}`);
          console.log(`   📊 Volume: ${latest.volume.toFixed(2)}`);
        }

        // Test ticker (spot check)
        try {
          const ticker = await exchange.getTicker(symbol);
          const { formatUTCTimeCompact: formatTickerTime } = await import('../../utils/time.js');
          console.log(
            chalk.green(
              `✅ Ticker: $${(ticker.price ?? 0).toFixed(2)} @ ${formatTickerTime(
                ticker.timestamp ?? Date.now()
              )}`
            )
          );
        } catch (e: any) {
          console.log(chalk.yellow(`⚠️  Ticker unavailable: ${e?.message || String(e)}`));
        }

        // Test market data
        const marketData = await provider.getMarketData(symbol, [options.timeframe]);
        if (marketData.length > 0) {
          console.log(chalk.green(`✅ Market analysis: ${marketData[0].trend} trend`));
        }

        // Test account
        try {
          const account = await exchange.getAccount();
          console.log(chalk.green(`✅ Account: $${account.balance.toFixed(2)}`));
        } catch (e: any) {
          console.log(chalk.yellow(`⚠️  Account unavailable: ${e?.message || String(e)}`));
        }

        console.log(chalk.green(`🎯 ${exchangeName.toUpperCase()} test passed!\n`));
      } catch (error: any) {
        console.log(chalk.red(`❌ ${exchangeName.toUpperCase()} test failed:`));

        // Clean error message without stack trace
        let errorMsg = error.message || String(error);
        if (errorMsg.includes('fetch failed')) {
          console.log(
            chalk.gray(`   Network error - exchange may be unreachable or require credentials`)
          );
        } else if (errorMsg.length > 100) {
          errorMsg = errorMsg.substring(0, 100) + '...';
          console.log(chalk.gray(`   ${errorMsg}\n`));
        } else {
          console.log(chalk.gray(`   ${errorMsg}\n`));
        }
      }
    }
  }

  private static async testAllExchangesDetailed(options: {
    coin: string;
    timeframe: string;
    limit: string;
  }): Promise<void> {
    console.log(chalk.cyan('📊 Testing All Exchanges (Detailed Mode)'));
    console.log(chalk.gray(`Coin: ${options.coin}, Timeframe: ${options.timeframe}\n`));

    const exchanges = ['simulator', 'okx', 'coinbase', 'hyperliquid'];
    let successCount = 0;
    let failCount = 0;

    for (const exchangeName of exchanges) {
      console.log(chalk.yellow(`\n${'='.repeat(60)}`));
      console.log(chalk.yellow(`Testing ${exchangeName.toUpperCase()}`));
      console.log(chalk.yellow('='.repeat(60)));

      try {
        await TestCommands.testSingleExchangeDetailed({
          exchange: exchangeName,
          coin: options.coin,
          timeframe: options.timeframe,
          limit: options.limit,
        });
        successCount++;
      } catch {
        console.log(chalk.red(`\n❌ ${exchangeName.toUpperCase()} test failed\n`));
        failCount++;
      }
    }

    // Summary
    console.log(chalk.cyan(`\n${'='.repeat(60)}`));
    console.log(chalk.cyan('📊 Overall Summary'));
    console.log(chalk.cyan('='.repeat(60)));
    console.log(chalk.green(`✅ Passed: ${successCount}/${exchanges.length}`));
    if (failCount > 0) {
      console.log(chalk.red(`❌ Failed: ${failCount}/${exchanges.length}`));
    }
  }

  private static async testAI(options: {
    type: string;
    coin: string;
    verbose: boolean;
  }): Promise<void> {
    console.log(chalk.cyan('🤖 Testing AI Integration'));
    console.log(chalk.gray('='.repeat(60)));
    console.log(`AI Type: ${options.type} | Coin: ${options.coin}\n`);

    const config = getConfig();
    const symbol = `${options.coin}/USDT`;

    // Test Mock AI
    if (options.type === 'mock' || options.type === 'both') {
      console.log(chalk.yellow('📝 Testing Mock AI...'));
      try {
        const { MockAIAgent } = await import('../../ai/mock-agent.js');
        const { SimulatorExchange } = await import('../../exchange/simulator.js');
        const { MarketDataProvider } = await import('../../data/market.js');

        const exchange = new SimulatorExchange(10000);
        const marketProvider = new MarketDataProvider(exchange);
        const mockAI = new MockAIAgent();

        const marketData = await marketProvider.getMarketData(symbol, ['3m', '4h']);
        const account = await exchange.getAccount();
        const positions = await exchange.getPositions();

        // Create minimal context for testing
        const context = {
          startTime: Date.now(),
          currentTime: Date.now(),
          invokeCount: 1,
          tradableCoins: [options.coin],
          maxPositions: 6,
          maxRiskPerTrade: 0.05,
          maxLeverage: 40,
          minLeverage: 5,
          defaultStopLoss: 0.03,
        };

        const signals = await mockAI.generateTradingSignal(marketData, account, positions, context);

        console.log(chalk.green(`✅ Mock AI generated ${signals.length} signal(s)`));

        if (options.verbose) {
          signals.forEach((signal, index) => {
            console.log(chalk.gray(`  Signal ${index + 1}:`));
            console.log(chalk.gray(`    - Action: ${signal.action}`));
            console.log(chalk.gray(`    - Confidence: ${(signal.confidence * 100).toFixed(1)}%`));
            console.log(chalk.gray(`    - Reasoning: ${signal.reasoning}`));
          });
        }
        console.log('');
      } catch (error) {
        console.log(chalk.red(`❌ Mock AI test failed: ${error}`));
        console.log('');
      }
    }

    // Test Real AI
    if (options.type === 'real' || options.type === 'both') {
      console.log(chalk.yellow('🤖 Testing Real AI (OpenRouter)...'));
      try {
        const apiKey = process.env.OPENROUTER_API_KEY || config.ai.apiKey;

        if (!apiKey) {
          console.log(chalk.yellow('⚠️  OPENROUTER_API_KEY not found'));
          console.log(chalk.gray('   Skipping real AI test'));
          console.log(chalk.gray('   Set OPENROUTER_API_KEY to test real AI\n'));
        } else {
          const { OpenRouterClient } = await import('../../ai/agent.js');
          const { SimulatorExchange } = await import('../../exchange/simulator.js');
          const { MarketDataProvider } = await import('../../data/market.js');

          const exchange = new SimulatorExchange(10000);
          const marketProvider = new MarketDataProvider(exchange);
          const realAI = new OpenRouterClient(apiKey);

          const marketData = await marketProvider.getMarketData(symbol, ['3m', '4h']);
          const account = await exchange.getAccount();
          const positions = await exchange.getPositions();

          // Create minimal context for testing
          const context = {
            startTime: Date.now(),
            currentTime: Date.now(),
            invokeCount: 1,
            tradableCoins: [options.coin],
            maxPositions: 6,
            maxRiskPerTrade: 0.05,
            maxLeverage: 40,
            minLeverage: 5,
            defaultStopLoss: 0.03,
          };

          const signals = await realAI.generateTradingSignal(
            marketData,
            account,
            positions,
            context
          );

          console.log(chalk.green(`✅ Real AI generated ${signals.length} signal(s)`));

          if (options.verbose) {
            signals.forEach((signal, index) => {
              console.log(chalk.gray(`  Signal ${index + 1}:`));
              console.log(chalk.gray(`    - Action: ${signal.action}`));
              console.log(chalk.gray(`    - Confidence: ${(signal.confidence * 100).toFixed(1)}%`));
              console.log(chalk.gray(`    - Reasoning: ${signal.reasoning}`));
            });
          }
          console.log('');
        }
      } catch (error) {
        console.log(chalk.red(`❌ Real AI test failed: ${error}`));
        console.log('');
      }
    }

    console.log(chalk.green('✅ AI Integration Test Complete'));
    console.log('');
    console.log(chalk.yellow('💡 Available AI Types:'));
    console.log('   - mock: Fast testing without API key');
    console.log('   - real: Actual AI analysis (requires OPENROUTER_API_KEY)');
  }
}

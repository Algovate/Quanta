import { Command } from 'commander';
import chalk from 'chalk';
import { getConfig } from '../../config/settings';
import { handleAsync } from '../../utils/error-handler';

export class TestCommands {
  static register(program: Command): void {
    program
      .command('kline')
      .description('Test K-line data retrieval')
      .option('-e, --exchange <exchange>', 'Exchange to test', 'simulator')
      .option('-c, --coin <coin>', 'Coin to test', 'BTC')
      .option('-t, --timeframe <timeframe>', 'Timeframe to test', '3m')
      .option('-l, --limit <limit>', 'Number of candles to fetch', '20')
      .action(async (options) => {
        try {
          await TestCommands.testKline(options);
        } catch (error) {
          // Error already displayed in testKline, just exit
          process.exit(1);
        }
      });

    program
      .command('exchanges')
      .description('Test multiple exchanges')
      .option('-c, --coin <coin>', 'Coin to test', 'BTC')
      .option('-t, --timeframe <timeframe>', 'Timeframe to test', '3m')
      .option('-l, --limit <limit>', 'Number of candles to fetch', '10')
      .action(async (options) => {
        await handleAsync(async () => {
          await TestCommands.testExchanges(options);
        }, 'TestCommands.exchanges');
      });

    program
      .command('data-sources')
      .description('Test multi-data source configuration')
      .option('-c, --coin <coin>', 'Coin to test', 'BTC')
      .option('-t, --timeframe <timeframe>', 'Timeframe to test', '3m')
      .option('-l, --limit <limit>', 'Number of candles to fetch', '5')
      .action(async (options) => {
        await handleAsync(async () => {
          await TestCommands.testDataSources(options);
        }, 'TestCommands.data-sources');
      });

    program
      .command('ai')
      .description('Test AI integration (Mock and Real AI)')
      .option('-t, --type <type>', 'AI type to test: mock, real, or both', 'both')
      .option('-c, --coin <coin>', 'Coin to test', 'BTC')
      .option('-v, --verbose', 'Show detailed output', false)
      .action(async (options) => {
        await handleAsync(async () => {
          await TestCommands.testAI(options);
        }, 'TestCommands.ai');
      });
  }

  private static async testKline(options: {
    exchange: string;
    coin: string;
    timeframe: string;
    limit: string;
  }): Promise<void> {
    console.log(chalk.cyan('📊 Testing K-line Data Retrieval'));
    console.log(chalk.gray(`Exchange: ${options.exchange}, Coin: ${options.coin}, Timeframe: ${options.timeframe}, Limit: ${options.limit}\n`));

    const config = getConfig();
    const symbol = `${options.coin}/USDT`;

    let exchange: any;
    const { MarketDataProvider } = await import('../../data/market');

    const apiKey = process.env[`${options.exchange.toUpperCase()}_API_KEY`];
    const apiSecret = process.env[`${options.exchange.toUpperCase()}_API_SECRET`];

    if (options.exchange === 'simulator') {
      const { SimulatorExchange } = await import('../../exchange/simulator');
      exchange = new SimulatorExchange(10000);
    } else if (options.exchange === 'okx') {
      const { OKXExchange } = await import('../../exchange/okx');
      exchange = new OKXExchange(apiKey, apiSecret, true);
    } else if (options.exchange === 'coinbase') {
      const { CoinbaseExchange } = await import('../../exchange/coinbase');
      exchange = new CoinbaseExchange(apiKey, apiSecret, true);
    } else if (options.exchange === 'binance') {
      const { BinanceExchange } = await import('../../exchange/binance');
      exchange = new BinanceExchange(apiKey, apiSecret, true);
    } else {
      throw new Error(`Unsupported exchange: ${options.exchange}`);
    }

    if (options.exchange !== 'simulator' && (!apiKey || !apiSecret)) {
      console.log(chalk.yellow(`⚠️  No API credentials found for ${options.exchange}`));
      console.log(chalk.gray(`   Using public data access (K-line data, market info)`));
      console.log(chalk.gray(`   Trading operations will require API credentials\n`));
    }

    const provider = new MarketDataProvider(exchange);

    // Test 1: Basic K-line data
    console.log(chalk.yellow('🔍 Test 1: Basic K-line Data'));
    let klines;
    try {
      klines = await exchange.getCandlesticks(symbol, options.timeframe, parseInt(options.limit));
      console.log(chalk.green(`✅ Retrieved ${klines.length} K-lines`));
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

    // Show data source information
    console.log(chalk.blue('📊 Data Source Information:'));
    console.log(`   Exchange: ${exchange.constructor.name}`);
    console.log(`   Exchange Name: ${exchange.getExchangeName ? exchange.getExchangeName() : 'Simulator'}`);
    console.log(`   Mode: ${exchange.constructor.name === 'SimulatorExchange' ? 'Simulation (Mock Data)' : 'Live Trading (Real Data)'}`);
    console.log(`   Testnet: ${exchange.isTestnetMode ? exchange.isTestnetMode() : 'N/A'}`);
    console.log(`   Symbol: ${symbol}`);
    console.log(`   Timeframe: ${options.timeframe}`);
    console.log(`   Data Range: ${new Date(klines[0].timestamp).toLocaleString()} - ${new Date(klines[klines.length - 1].timestamp).toLocaleString()}`);

    // Show latest 3 candles
    console.log(chalk.gray('\n📈 Latest 3 candles:'));
    klines.slice(-3).forEach((kline, index) => {
      const time = new Date(kline.timestamp).toLocaleTimeString();
      console.log(`   ${index + 1}. ${time}: O:$${kline.open.toFixed(2)} H:$${kline.high.toFixed(2)} L:$${kline.low.toFixed(2)} C:$${kline.close.toFixed(2)} V:${kline.volume.toFixed(2)}`);
    });

    // Test 2: Market data with indicators
    console.log(chalk.yellow('\n🔍 Test 2: Market Data with Indicators'));
    const marketData = await provider.getMarketData(symbol, [options.timeframe]);

    if (marketData.length > 0) {
      const data = marketData[0];
      console.log(chalk.green('✅ Market data retrieved:'));
      console.log(chalk.blue('📊 Market Analysis:'));
      const dataSource = exchange.constructor.name === 'SimulatorExchange'
        ? 'Simulated Market'
        : exchange.getExchangeName ? exchange.getExchangeName() : 'Unknown Exchange';
      console.log(`   Data Source: ${dataSource}`);
      console.log(`   Analysis Method: Technical Indicators (100-period)`);
      console.log(`   Current Price: $${data.currentPrice.toFixed(2)}`);
      console.log(`   Trend: ${data.trend}`);
      console.log(`   Volatility: ${data.volatility}`);
      console.log(`   EMA20: $${data.indicators.ema20.toFixed(2)}`);
      console.log(`   EMA50: $${data.indicators.ema50.toFixed(2)}`);
      console.log(`   RSI14: ${data.indicators.rsi14.toFixed(2)}`);
      console.log(`   MACD: ${data.indicators.macd.macd.toFixed(4)}`);
      console.log(`   ATR14: $${data.indicators.atr14.toFixed(2)}`);
    }

    // Test 3: Account info (skip if no API credentials for non-simulator exchanges)
    console.log(chalk.yellow('\n🔍 Test 3: Account Information'));
    const isSimulator = exchange.constructor.name === 'SimulatorExchange';
    const hasApiKey = !!(options.exchange === 'simulator' ||
                       process.env[`${options.exchange.toUpperCase()}_API_KEY`]);

    if (isSimulator || hasApiKey) {
      try {
        const account = await exchange.getAccount();
        console.log(chalk.green('✅ Account info retrieved:'));
        console.log(chalk.blue('💰 Account Details:'));
        console.log(`   Account Type: ${isSimulator ? 'Simulation Account' : 'Live Trading Account'}`);
        console.log(`   Exchange: ${exchange.getExchangeName ? exchange.getExchangeName() : 'Simulator'}`);
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
      console.log(chalk.gray(`   Set ${options.exchange.toUpperCase()}_API_KEY and ${options.exchange.toUpperCase()}_API_SECRET to test account data`));
    }

    // Summary
    console.log(chalk.green('\n🎯 All tests passed! K-line data retrieval is working correctly.'));
  }

  private static async testExchanges(options: {
    coin: string;
    timeframe: string;
    limit: string;
  }): Promise<void> {
    console.log(chalk.cyan('🏦 Testing Multiple Exchanges'));
    console.log(chalk.gray(`Coin: ${options.coin}, Timeframe: ${options.timeframe}, Limit: ${options.limit}\n`));

    const symbol = `${options.coin}/USDT`;
    const exchanges = ['simulator', 'okx', 'coinbase'];

    for (const exchangeName of exchanges) {
      console.log(chalk.yellow(`🔍 Testing ${exchangeName.toUpperCase()} Exchange:`));
      console.log('='.repeat(50));

      try {
        let exchange: any;
        const { MarketDataProvider } = await import('../../data/market');

        const apiKey = process.env[`${exchangeName.toUpperCase()}_API_KEY`];
        const apiSecret = process.env[`${exchangeName.toUpperCase()}_API_SECRET`];

        if (exchangeName === 'simulator') {
          const { SimulatorExchange } = await import('../../exchange/simulator');
          exchange = new SimulatorExchange(10000);
        } else if (exchangeName === 'okx') {
          const { OKXExchange } = await import('../../exchange/okx');
          exchange = new OKXExchange(apiKey, apiSecret, true);
          if (!apiKey || !apiSecret) {
            console.log(chalk.yellow(`⚠️  No API credentials found for ${exchangeName}`));
            console.log(chalk.gray(`   Using public data access\n`));
          }
        } else if (exchangeName === 'coinbase') {
          const { CoinbaseExchange } = await import('../../exchange/coinbase');
          exchange = new CoinbaseExchange(apiKey, apiSecret, true);
          if (!apiKey || !apiSecret) {
            console.log(chalk.yellow(`⚠️  No API credentials found for ${exchangeName}`));
            console.log(chalk.gray(`   Using public data access\n`));
          }
        } else if (exchangeName === 'binance') {
          const { BinanceExchange } = await import('../../exchange/binance');
          exchange = new BinanceExchange(apiKey, apiSecret, true);
          if (!apiKey || !apiSecret) {
            console.log(chalk.yellow(`⚠️  No API credentials found for ${exchangeName}`));
            console.log(chalk.gray(`   Using public data access\n`));
          }
        } else {
          throw new Error(`Unsupported exchange: ${exchangeName}`);
        }

        const provider = new MarketDataProvider(exchange);

        // Test K-line data
        const klines = await exchange.getCandlesticks(symbol, options.timeframe, parseInt(options.limit));
        console.log(chalk.green(`✅ K-line data: ${klines.length} candles`));

        if (klines.length > 0) {
          const latest = klines[klines.length - 1];
          console.log(`   📈 Latest price: $${latest.close.toFixed(2)}`);
          console.log(`   📊 Volume: ${latest.volume.toFixed(2)}`);
        }

        // Test market data
        const marketData = await provider.getMarketData(symbol, [options.timeframe]);
        if (marketData.length > 0) {
          console.log(chalk.green(`✅ Market analysis: ${marketData[0].trend} trend`));
        }

        // Test account
        const account = await exchange.getAccount();
        console.log(chalk.green(`✅ Account: $${account.balance.toFixed(2)}`));

        console.log(chalk.green(`🎯 ${exchangeName.toUpperCase()} test passed!\n`));

      } catch (error: any) {
        console.log(chalk.red(`❌ ${exchangeName.toUpperCase()} test failed:`));
        console.log(chalk.red(`   ${error.message}\n`));
      }
    }
  }

  private static async testDataSources(options: {
    coin: string;
    timeframe: string;
    limit: string;
  }): Promise<void> {
    console.log(chalk.cyan('🔄 Testing Multi-Data Sources'));
    console.log(chalk.gray(`Coin: ${options.coin}, Timeframe: ${options.timeframe}, Limit: ${options.limit}\n`));

    const config = getConfig();
    const symbol = `${options.coin}/USDT`;

    const { createDataSourceManager } = await import('../../core/data-source-manager');
    const manager = createDataSourceManager(config);

    const exchangeInfo = (manager as any).getExchangeInfo();
    console.log(chalk.blue('📊 Data Source Configuration:'));
    console.log(`   Name: ${exchangeInfo.name}`);
    console.log(`   Type: ${exchangeInfo.type}`);
    console.log(`   Testnet: ${exchangeInfo.testnet}`);
    console.log('');

    const exchange = manager.getExchange();

    console.log(chalk.yellow(`🔍 Testing Exchange:`));
    console.log('='.repeat(50));

    try {
      const klines = await exchange.getCandlesticks(symbol, options.timeframe, parseInt(options.limit));
      console.log(chalk.green(`   ✅ K-line data: ${klines.length} candles`));

      if (klines.length > 0) {
        const latest = klines[klines.length - 1];
        console.log(`   📈 Latest price: $${latest.close.toFixed(2)}`);
        console.log(`   📊 Volume: ${latest.volume.toFixed(2)}`);
      }

      const account = await exchange.getAccount();
      console.log(chalk.green(`   ✅ Account data: $${account.balance.toFixed(2)}`));

      const positions = await exchange.getPositions();
      console.log(chalk.green(`   ✅ Positions: ${positions.length} active`));

      console.log(chalk.green(`   🎯 Exchange test passed!\n`));

    } catch (error: any) {
      console.log(chalk.red(`   ❌ Exchange test failed:`));
      console.log(chalk.red(`      ${error.message}\n`));
    }

    console.log(chalk.cyan('🔍 Validating All Exchanges:'));
    console.log('='.repeat(50));

    const validationResult = await (manager as any).validateExchange();
    if (validationResult.valid) {
      console.log(chalk.green(`   ✅ Exchange: Valid`));
    } else {
      console.log(chalk.red(`   ❌ Exchange: ${validationResult.error}`));
    }

    console.log('');
    console.log(chalk.cyan('📋 Multi-Data Source Summary:'));
    console.log('='.repeat(50));
    console.log('🎯 Configuration:');
    console.log(`   Exchange: ${config.exchange.name} (testnet: ${config.exchange.testnet})`);
    console.log('');
    console.log('💡 Benefits:');
    console.log('   - Flexible data source selection');
    console.log('   - Risk diversification');
    console.log('   - Performance optimization');
    console.log('   - Cost control');
    console.log('   - Security isolation');
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
        const { MockAIAgent } = await import('../../ai/mock-agent');
        const { SimulatorExchange } = await import('../../exchange/simulator');
        const { MarketDataProvider } = await import('../../data/market');

        const exchange = new SimulatorExchange(10000);
        const marketProvider = new MarketDataProvider(exchange);
        const mockAI = new MockAIAgent();

        const marketData = await marketProvider.getMarketData(symbol, ['3m', '4h']);
        const account = await exchange.getAccount();
        const positions = await exchange.getPositions();

        const signals = await mockAI.generateTradingSignal(marketData, account, positions);

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
          const { OpenRouterClient } = await import('../../ai/agent');
          const { SimulatorExchange } = await import('../../exchange/simulator');
          const { MarketDataProvider } = await import('../../data/market');

          const exchange = new SimulatorExchange(10000);
          const marketProvider = new MarketDataProvider(exchange);
          const realAI = new OpenRouterClient(apiKey);

          const marketData = await marketProvider.getMarketData(symbol, ['3m', '4h']);
          const account = await exchange.getAccount();
          const positions = await exchange.getPositions();

          const signals = await realAI.generateTradingSignal(marketData, account, positions);

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

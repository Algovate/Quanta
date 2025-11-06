import { Command } from 'commander';
import chalk from 'chalk';
import ora from 'ora';
import { getConfig } from '../../config/settings.js';
import { MarketDataProvider } from '../../data/index.js';
import { TradingManager } from '../../core/index.js';
import { handleAsync } from '../../utils/index.js';
import { safeAction } from '../shared/command-utils.js';
import { formatExchangeFriendlyName } from '../utils.js';
import { UnifiedLogger } from '../../logging/index.js';
import { checkSessionConflict } from '../shared/session-guard.js';
import { validateEnv, validateCoins } from '../shared/validation.js';
import { createExchangeForMode, validateModeConfiguration } from '../shared/exchange-factory.js';
import { setupGracefulShutdown } from '../shared/shutdown-handler.js';
import type { Config } from '../../config/settings.js';
import type { WorkflowConfig } from '../../types/index.js';
import { UserFriendlyError } from '../../types/index.js';

export class TradeCommands {
  /**
   * Build a workflow configuration from loaded settings and selected coins.
   * Keeps the startTrading path concise and improves readability.
   */
  private static buildWorkflowConfig(config: Config, coins: string[]): WorkflowConfig {
    return {
      coins,
      cyclePeriod: config.trading.cyclePeriod,
      maxPositions: config.trading.maxPositions,
      marketFetchParallel: (config as any)?.trading?.marketFetchParallel,
      riskParams: {
        maxRiskPerTrade: config.trading.maxRisk,
        maxTotalRisk: 0.3,
        defaultStopLoss: config.trading.stopLoss,
        maxLeverage: config.trading.leverageRange[1],
        minLeverage: config.trading.leverageRange[0],
        maxPositions: config.trading.maxPositions,
      },
    };
  }

  /**
   * Print effective exchange name with UnifiedLogger
   */
  private static printEffectiveExchangeWithLogger(
    logger: UnifiedLogger,
    exchange: unknown,
    testnet: boolean
  ): void {
    try {
      const reported = (exchange as { getExchangeName?: () => string })?.getExchangeName?.();
      const friendly = formatExchangeFriendlyName(reported, testnet) || 'unknown';
      logger.info(`   Exchange: ${friendly}`, {}, 'TradeStart');
    } catch {
      // best-effort display only
    }
  }

  /**
   * Display trading mode configuration with UnifiedLogger
   */
  private static displayModeConfigurationWithLogger(
    logger: UnifiedLogger,
    mode: string,
    exchangeName: string,
    exchangeTestnet: boolean,
    exchangeApiKey?: string,
    exchangeApiSecret?: string,
    marketType?: string
  ): void {
    logger.info(chalk.blue('📊 Configuration:'), {}, 'TradeStart');
    logger.info(`   Mode: ${mode}`, {}, 'TradeStart');

    if (mode === 'simulation') {
      logger.info(`   Data Source: mock data (simulator only)`, {}, 'TradeStart');
      logger.info(
        chalk.gray(`   Note: Config exchange '${exchangeName}' ignored in simulation mode`),
        {},
        'TradeStart'
      );
    } else if (mode === 'paper') {
      // Data Source and Network are summarized below as a single consolidated Exchange line
      if (!exchangeApiKey || !exchangeApiSecret) {
        logger.info(
          chalk.yellow(`   Note: Running without API keys (public data only, rate limited)`),
          {},
          'TradeStart'
        );
      }
    } else if (mode === 'live') {
      const exchangeStatus = exchangeName !== 'simulator' ? 'real' : 'simulator';
      const networkStatus = exchangeTestnet ? 'testnet' : 'production';
      logger.info(`   Exchange: ${exchangeName} (${exchangeStatus})`, {}, 'TradeStart');
      if (exchangeName !== 'simulator') {
        logger.info(`   Network: ${networkStatus}`, {}, 'TradeStart');
      }
    }
    if (marketType) {
      logger.info(`   Market Type: ${marketType}`, {}, 'TradeStart');
    }
  }

  static register(program: Command): void {
    program
      .command('start')
      .description('Start AI trading system')
      .option('-e, --env <env>', 'Environment: live, paper, simulate')
      .option('-c, --coins <coins>', 'Comma-separated list of coins (overrides config)')
      .action(
        safeAction(async options => {
          await handleAsync(async () => {
            await TradeCommands.startTrading(options);
          }, 'TradeCommands.start');
        }, 'TradeCommands.start')
      );

    program
      .command('backtest')
      .description('Run backtest with historical data')
      .option('-c, --coins <coins>', 'Comma-separated list of coins (overrides config)')
      .option('-s, --start <date>', 'Start date (YYYY-MM-DD)')
      .option('-e, --end <date>', 'End date (YYYY-MM-DD)')
      .option('--initial-balance <amount>', 'Initial balance', '10000')
      .option('--seed <number>', 'Deterministic seed', '')
      .option('--verbose', 'Verbose output (per-signal details)', false)
      .option('--quiet', 'Minimal output', false)
      .option('--json', 'JSON summary output', false)
      .option('--no-progress', 'Disable progress bar', false)
      .option('--update-interval <ms>', 'Progress update interval (ms)', '750')
      .option('--cycle-sample <n>', 'Print every N cycles (noise control)', '10')
      .option('--summary-only', 'Show only executive summary line', false)
      .option('--no-risks', 'Hide Risk Metrics section', false)
      .option('--no-signals', 'Hide Signal Statistics section', false)
      .option('--no-equity', 'Hide Equity Curve section', false)
      .option(
        '--equity-delta-pct <p>',
        'Print when equity changes by >= p (e.g., 0.001 = 0.1%)',
        '0.001'
      )
      .option('--upnl-delta <usd>', 'Print when UPNL changes by >= USD', '10')
      .option('--exposure-delta-pct <p>', 'Print when exposure changes by >= p', '0.1')
      .option('--leverage-delta <x>', 'Print when leverage changes by >= x', '0.2')
      .option('--dd-steps <list>', 'Drawdown alert steps (comma, e.g., 5,10,15)', '')
      .action(
        safeAction(async options => {
          await handleAsync(async () => {
            await TradeCommands.runBacktest(options);
          }, 'TradeCommands.backtest');
        }, 'TradeCommands.backtest')
      );
  }

  private static async startTrading(options: { env?: string; coins?: string }): Promise<void> {
    // Get config and resolve environment
    const config = getConfig();
    // Trade start only supports single workflow mode (use 'arena start' for multi-drone arena)
    const runtimeMode = 'single' as const;

    // Validate and parse environment
    const env = validateEnv(options.env || config.env || 'simulate');

    // Validate and parse coins
    const coins = options.coins ? validateCoins(options.coins) : config.trading.coins;

    // Session guard: check for active execution sessions
    checkSessionConflict();

    const configUpdates = {
      mode: runtimeMode,
      env,
      trading: { coins },
    };

    const updatedConfig = { ...config, ...configUpdates };

    // Initialize UnifiedLogger for detailed logging
    const unifiedLogger = UnifiedLogger.getInstance();
    unifiedLogger.initialize();

    // Extract exchange configuration for display
    const exchangeName = updatedConfig.exchange?.name || 'simulator';
    const exchangeTestnet = updatedConfig.exchange?.testnet ?? true;
    const exchangeApiKey = updatedConfig.exchange?.apiKey;
    const exchangeApiSecret = updatedConfig.exchange?.apiSecret;
    const marketType = updatedConfig.exchange?.marketType;

    // Format exchange display name
    let exchangeDisplay = exchangeName;
    if (env === 'paper' && exchangeName !== 'simulator') {
      exchangeDisplay = `Paper (${exchangeName.toUpperCase()}${exchangeTestnet ? ', testnet' : ''})`;
    } else if (exchangeName === 'simulator') {
      exchangeDisplay = 'Simulator';
    } else {
      exchangeDisplay = `${exchangeName}${exchangeTestnet ? ' (testnet)' : ''}`;
    }

    // Console: Minimal essential info only
    unifiedLogger.info(chalk.cyan('🏆 Quanta Trading System\n'), {}, 'TradeStart');
    unifiedLogger.info(
      chalk.gray(`Env: ${env} | Exchange: ${exchangeDisplay} | Coins: ${coins.join(', ')}\n`),
      {},
      'TradeStart'
    );

    // UnifiedLogger: Full detailed output
    unifiedLogger.info(chalk.cyan('🏆 Quanta Trading System'), {}, 'TradeStart');
    unifiedLogger.info(
      chalk.gray('AI-powered quantitative trading with real-time decision making\n'),
      {},
      'TradeStart'
    );

    // UnifiedLogger: Log configuration details
    this.displayModeConfigurationWithLogger(
      unifiedLogger,
      env,
      exchangeName,
      exchangeTestnet,
      exchangeApiKey,
      exchangeApiSecret,
      marketType
    );

    // Validate prerequisites based on mode
    validateModeConfiguration(env, exchangeName, exchangeApiKey, exchangeApiSecret);
    this.validateAIConfiguration(updatedConfig);

    // Initialize components and construct exchange only once
    const spinner = ora('Initializing trading system...').start();
    unifiedLogger.info('Initializing trading system...', {}, 'TradeStart');
    const exchange = await createExchangeForMode({
      mode: env as 'simulation' | 'paper' | 'live',
      config: {
        exchangeName,
        apiKey: exchangeApiKey,
        apiSecret: exchangeApiSecret,
        testnet: updatedConfig.exchange?.testnet ?? true,
      },
      logToConsole: true,
    });

    // UnifiedLogger: Display effective exchange implementation
    this.printEffectiveExchangeWithLogger(unifiedLogger, exchange, exchangeTestnet);

    // UnifiedLogger: Log configuration details
    unifiedLogger.info(`   Coins: ${coins.join(', ')}`, {}, 'TradeStart');
    const mt = (config.exchange?.marketType || 'spot').toLowerCase();
    unifiedLogger.info(
      chalk.gray(
        `   MarketType: ${mt || 'spot'} | Effective risk → lev: ${config.trading.leverageRange[0]}-${config.trading.leverageRange[1]}x, SL: ${(config.trading.stopLoss * 100).toFixed(1)}%, risk/trade: ${(config.trading.maxRisk * 100).toFixed(1)}%, maxPos: ${config.trading.maxPositions}`
      ),
      {},
      'TradeStart'
    );
    unifiedLogger.info('', {}, 'TradeStart');

    const marketProvider = new MarketDataProvider(exchange);
    const { createAIClient } = await import('../../ai/factory.js');
    const { getAIProviderInfo } = await import('../../config/ai-config-utils.js');
    const aiClient = createAIClient(updatedConfig);
    const aiInfo = getAIProviderInfo(updatedConfig);
    unifiedLogger.info(
      chalk.gray(`   AI Provider: ${aiInfo.provider} | Model: ${aiInfo.model}`),
      {},
      'TradeStart'
    );
    const workflowConfig = this.buildWorkflowConfig(config, coins);
    const manager = TradingManager.getInstance();

    spinner.succeed('Trading system initialized');

    // Console: Minimal status
    unifiedLogger.info(
      chalk.green('🚀 Trading started. Use "quanta log view" to view detailed output.\n'),
      {},
      'TradeStart'
    );

    // UnifiedLogger: Full startup message
    unifiedLogger.info(chalk.green('🚀 Starting trading workflow...'), {}, 'TradeStart');
    unifiedLogger.info(chalk.gray('Press Ctrl+C to stop\n'), {}, 'TradeStart');

    // Set up signal handlers for graceful shutdown (core manages session)
    setupGracefulShutdown({
      logger: unifiedLogger,
      loggerContext: 'TradeStart',
      onShutdown: async () => {
        try {
          await manager.stop();
        } catch {
          // ignore if not running
        }
      },
    });

    await manager.start(exchange, marketProvider, aiClient, workflowConfig);
  }

  private static async runBacktest(options: {
    coins?: string;
    start: string;
    end: string;
    initialBalance: string;
    seed?: string;
    verbose?: boolean;
    quiet?: boolean;
    json?: boolean;
    progress?: boolean;
    updateInterval?: string;
    cycleSample?: string;
    equityDeltaPct?: string;
    upnlDelta?: string;
    exposureDeltaPct?: string;
    leverageDelta?: string;
    ddSteps?: string;
    summaryOnly?: boolean;
    noRisks?: boolean;
    noSignals?: boolean;
    noEquity?: boolean;
  }): Promise<void> {
    const { BacktestEngine } = await import('../../core/backtest-engine.js');
    const { BacktestReport } = await import('../../analytics/report.js');
    const { BacktestRenderer } = await import('../../utils/cli-render.js');
    const { format, addMonths, subMonths } = await import('date-fns');
    const logger = UnifiedLogger.getInstance();
    logger.info(chalk.cyan('📈 Quanta Backtest'), {}, 'TradeCommands');
    logger.info(chalk.gray('Historical strategy validation\n'), {}, 'TradeCommands');

    // Get config for default coins
    const config = getConfig();
    const coins = options.coins
      ? options.coins.split(',').map((c: string) => c.trim().toUpperCase())
      : config.trading.coins;

    // Derive default 4-month span when dates are missing
    const now = new Date();
    let startStr = options.start;
    let endStr = options.end;

    if (!startStr && !endStr) {
      const endD = now;
      const startD = subMonths(endD, 4);
      startStr = format(startD, 'yyyy-MM-dd');
      endStr = format(endD, 'yyyy-MM-dd');
    }

    // Import UTC date parser for consistent timezone handling
    const { parseUTCDateString } = await import('../../utils/time.js');

    try {
      if (startStr && !endStr) {
        // Validate start date using UTC parser
        parseUTCDateString(startStr);
        // Calculate end date from start (using date-fns which handles calendar months correctly)
        const s = new Date(startStr + 'T00:00:00Z'); // Parse as UTC for date-fns
        endStr = format(addMonths(s, 4), 'yyyy-MM-dd');
      } else if (!startStr && endStr) {
        // Validate end date using UTC parser
        parseUTCDateString(endStr);
        // Calculate start date from end (using date-fns which handles calendar months correctly)
        const e = new Date(endStr + 'T00:00:00Z'); // Parse as UTC for date-fns
        startStr = format(subMonths(e, 4), 'yyyy-MM-dd');
      }

      // Validate dates using UTC parser to ensure consistent timezone handling
      const startTimestamp = parseUTCDateString(startStr as string);
      const endTimestamp = parseUTCDateString(endStr as string);

      if (startTimestamp >= endTimestamp) {
        throw new Error('Start date must be before end date');
      }
    } catch (error) {
      if (error instanceof Error && error.message.includes('Invalid')) {
        throw error; // Re-throw validation errors as-is
      }
      throw new Error(
        `Invalid date format. Use YYYY-MM-DD. ${error instanceof Error ? error.message : String(error)}`
      );
    }

    const initialBalance = parseFloat(options.initialBalance);

    if (initialBalance <= 0 || isNaN(initialBalance)) {
      throw new Error(`Invalid initial balance: ${options.initialBalance}`);
    }

    const backtestConfig = {
      startDate: startStr as string,
      endDate: endStr as string,
      initialBalance,
      coins,
      cyclePeriod: 180000, // 3 minutes
      maxPositions: 6,
      leverage: 1,
      seed: options.seed ? Number(options.seed) : undefined,
    };

    logger.info(chalk.blue('📊 Backtest Configuration:'), {}, 'TradeCommands');
    logger.info(
      `   Period: ${backtestConfig.startDate} to ${backtestConfig.endDate}`,
      {},
      'TradeCommands'
    );
    logger.info(`   Coins: ${coins.join(', ')}`, {}, 'TradeCommands');
    logger.info(`   Initial Balance: $${initialBalance.toLocaleString()}`, {}, 'TradeCommands');
    logger.info(`   Max Positions: ${backtestConfig.maxPositions}`, {}, 'TradeCommands');
    logger.info(
      `   Cycle Period: ${backtestConfig.cyclePeriod / 1000 / 60} minutes`,
      {},
      'TradeCommands'
    );
    logger.info('', {}, 'TradeCommands');

    // Configuration will be printed after dates are resolved below

    try {
      const mode: 'verbose' | 'normal' | 'quiet' = options.quiet
        ? 'quiet'
        : options.verbose
          ? 'verbose'
          : 'normal';
      const renderer = new BacktestRenderer({
        mode,
        showProgress: options.progress !== false,
        updateIntervalMs: Number(options.updateInterval || '750') || 750,
        sampleEveryCycles: Number(options.cycleSample || '10') || 10,
        equityDeltaPctToPrint: Number(options.equityDeltaPct || '0.001') || 0.001,
        upnlDeltaAbsToPrint: Number(options.upnlDelta || '10') || 10,
        exposureDeltaPctToPrint: Number(options.exposureDeltaPct || '0.1') || 0.1,
        leverageDeltaAbsToPrint: Number(options.leverageDelta || '0.2') || 0.2,
        drawdownSteps:
          (options.ddSteps
            ? options.ddSteps.split(',').map((s: string) => Number(s))
            : undefined) || undefined,
      });

      // Note: UnifiedLogger doesn't use configurable log levels
      // Log level filtering can be done via query filters in log view command

      const engine = new BacktestEngine(backtestConfig, {
        onPhase: phase => renderer.startPhase(phase),
        onProgress: (p, elapsed) => renderer.updateProgress(p, elapsed),
        onCycle: info => renderer.updateCycleLine(info),
        onSnapshot: () => renderer.heartbeat('Still running'),
      });

      const result = await engine.runBacktest();

      if (options.json) {
        logger.info(JSON.stringify(result, null, 2), {}, 'TradeCommands');
      } else {
        // Generate and display compact report
        const report = new BacktestReport(result, {
          summaryOnly: options.summaryOnly === true,
          showRisks: options.noRisks !== true,
          showSignals: options.noSignals !== true,
          showEquity: options.noEquity !== true,
        });
        report.displayReport();
        logger.info(chalk.green('✅ Backtest completed successfully!'), {}, 'TradeCommands');
      }
    } catch (error) {
      if (error instanceof Error) {
        logger.error(chalk.red(`\n❌ Error: ${error.message}`), error, 'TradeCommands');
      } else {
        logger.error(chalk.red(`\n❌ Error: ${String(error)}`), undefined, 'TradeCommands');
      }

      logger.info(chalk.yellow('\n💡 Troubleshooting:'), {}, 'TradeCommands');
      logger.info(chalk.gray('  1. Verify date format is YYYY-MM-DD'), {}, 'TradeCommands');
      logger.info(chalk.gray('  2. Ensure start date is before end date'), {}, 'TradeCommands');
      logger.info(chalk.gray('  3. Check coin symbols are valid'), {}, 'TradeCommands');

      throw error;
    }
  }

  /**
   * Validate AI configuration
   * Checks provider-specific API key with fallback to legacy config
   */
  private static validateAIConfiguration(config: Config): void {
    const provider = (config.ai.provider || 'openrouter') as
      | 'openrouter'
      | 'openai'
      | 'dashscope'
      | 'deepseek';

    const providerConfig = (config.ai as any)[provider];

    // Resolve API key with same logic as AI client factory
    const apiKey = providerConfig?.apiKey || config.ai.apiKey;

    if (!apiKey) {
      const formatError = (
        title: string,
        issue: string,
        solution: string,
        tip?: string
      ): string => {
        let message = chalk.red(`❌ ${title}`) + chalk.white('\n\n');
        message += chalk.yellow('📝 Issue:') + chalk.gray(` ${issue}\n`);
        message += chalk.white('\n');
        message += chalk.yellow('🔧 Solution:') + chalk.white(` ${solution}`);
        if (tip) {
          message += chalk.white('\n\n') + chalk.yellow('💡 Tip:') + chalk.gray(` ${tip}`);
        }
        return message;
      };

      const providerName = provider === 'openrouter' ? 'OpenRouter' : provider.toUpperCase();
      const keyLocation =
        provider === 'openrouter' ? `ai.openrouter.apiKey` : `ai.${provider}.apiKey`;
      const urlMap: Record<string, string> = {
        openrouter: 'https://openrouter.ai/keys',
        openai: 'https://platform.openai.com/api-keys',
        dashscope: 'https://dashscope.console.aliyun.com/',
        deepseek: 'https://platform.deepseek.com/',
      };

      throw new UserFriendlyError(
        formatError(
          'Missing AI API key',
          `AI signal generation requires an API key from ${providerName}.`,
          `Add your ${providerName} API key to ${chalk.cyan('config.json')} as ${chalk.cyan(keyLocation)}`,
          `Get API Key: ${chalk.blue(urlMap[provider] || 'https://openrouter.ai/keys')}`
        ),
        {
          provider,
          keyLocation,
          url: urlMap[provider] || 'https://openrouter.ai/keys',
        }
      );
    }
  }
}

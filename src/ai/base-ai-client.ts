/**
 * Base AI Client
 * Provides shared prompt building logic and common functionality for all AI providers
 */

import { MarketData } from '../data/market.js';
import { Account, Position, TradingSignal } from '../types/index.js';
import type { TechnicalIndicators, MarketData as TMarketData } from '../types/index.js';
import { loadPromptGroup, renderTemplate, type PromptGroup } from './prompt-loader.js';
import { getConfig } from '../config/settings.js';
import type { AIContext, EnrichedPositionInfo, IAIClient } from './types.js';
import {
  initLangSmithTracing,
  traceable,
  getTracingConfig,
  buildTraceInputs,
  buildTraceOutputs,
} from './tracing.js';
import { parseAiResponseWithDetails } from './prompt-parser.js';
import { UnifiedLogger } from '../logging/index.js';

export abstract class BaseAIClient implements IAIClient {
  protected promptGroupName: string;
  protected promptGroup: PromptGroup | null = null;
  protected logger: UnifiedLogger;
  protected abstract readonly providerName: string;
  protected abstract readonly defaultBaseUrl: string;

  constructor(promptGroupName?: string) {
    this.promptGroupName = promptGroupName ?? getConfig().ai.prompt.activeGroup;
    this.logger = UnifiedLogger.getInstance();
    initLangSmithTracing();
  }

  /**
   * Build the complete prompt from system and user prompts
   */
  protected buildPrompt(
    marketData: MarketData[],
    account: Account,
    existingPositions: Position[],
    context: AIContext,
    enrichedPositions?: EnrichedPositionInfo[]
  ): string {
    const systemPrompt = this.buildSystemPrompt(context);
    const userPrompt = this.buildUserPrompt(
      marketData,
      account,
      existingPositions,
      context,
      enrichedPositions
    );
    return `${systemPrompt}\n\n---USER---\n${userPrompt}`;
  }

  /**
   * Generate trading signals - common implementation for all providers
   */
  async generateTradingSignal(
    marketData: MarketData[],
    account: Account,
    existingPositions: Position[],
    context: AIContext,
    enrichedPositions?: EnrichedPositionInfo[]
  ): Promise<TradingSignal[]> {
    const tracingConfig = getTracingConfig();
    const prompt = this.buildPrompt(
      marketData,
      account,
      existingPositions,
      context,
      enrichedPositions
    );

    const traceableInputs = buildTraceInputs(
      {
        coins: context.tradableCoins,
        model: this.getModel(),
        temperature: this.getTemperature(),
        mode: context.invokeCount > 0 ? 'live' : 'initial',
      },
      prompt,
      tracingConfig
    );

    const tracedWithPrompt = traceable(
      async (_inputs: typeof traceableInputs) => {
        const response = await this.callAPI(prompt);
        const parsed = this.parseResponse(response);
        return buildTraceOutputs({ signals: parsed }, response, tracingConfig);
      },
      {
        name: 'generateTradingSignal',
        run_type: 'chain',
      }
    );

    const result = await tracedWithPrompt(traceableInputs);
    return Array.isArray(result.signals) ? result.signals : [];
  }

  /**
   * Parse API response - common implementation
   */
  protected parseResponse(response: string): TradingSignal[] {
    const result = parseAiResponseWithDetails(response);

    if (result.signals.length === 0 && response.trim().length > 0) {
      const truncatedResponse =
        response.length > 500 ? response.substring(0, 500) + '...' : response;

      const errorMessage = result.error
        ? `Failed to parse AI response at ${result.error.step} step: ${result.error.message}`
        : 'Failed to parse AI response: No valid signals extracted';

      const error = result.error?.originalError || new Error('No valid signals extracted');
      (error as any).responsePreview = truncatedResponse;
      (error as any).responseLength = response.length;
      (error as any).parsingStep = result.error?.step;

      this.logger.error(errorMessage, error, this.providerName);
    }

    return result.signals;
  }

  /**
   * Abstract methods that must be implemented by subclasses
   */
  protected abstract getModel(): string;
  protected abstract getTemperature(): number;
  protected abstract callAPI(prompt: string): Promise<string>;

  /**
   * Load the prompt group if not already loaded
   */
  protected ensurePromptGroupLoaded(): void {
    if (!this.promptGroup) {
      try {
        this.promptGroup = loadPromptGroup(this.promptGroupName);
      } catch (error) {
        throw new Error(
          `Cannot load prompt group "${this.promptGroupName}". ` +
            `Please ensure the prompt configuration file exists at config/prompts/${this.promptGroupName}.json`
        );
      }
    }
  }

  protected buildSystemPrompt(context: AIContext): string {
    this.ensurePromptGroupLoaded();
    if (!this.promptGroup) {
      throw new Error('Prompt group not loaded');
    }

    const templateContext = {
      tradableCoins: context.tradableCoins.join(', '),
      maxPositions: context.maxPositions,
      maxRiskPerTrade: (context.maxRiskPerTrade * 100).toFixed(0),
      minLeverage: context.minLeverage,
      maxLeverage: context.maxLeverage,
      defaultStopLoss: (context.defaultStopLoss * 100).toFixed(1),
    };

    return renderTemplate(this.promptGroup.system, templateContext);
  }

  protected buildUserPrompt(
    marketData: MarketData[],
    account: Account,
    existingPositions: Position[],
    context: AIContext,
    enrichedPositions?: EnrichedPositionInfo[]
  ): string {
    this.ensurePromptGroupLoaded();
    if (!this.promptGroup) {
      throw new Error('Prompt group not loaded');
    }

    const elapsedMinutes = Math.floor((context.currentTime - context.startTime) / 60000);
    const currentTime = new Date(context.currentTime).toISOString();

    // Group market data by coin for derived sections
    const grouped: Record<string, MarketData[]> = {};
    marketData.forEach(d => {
      if (!grouped[d.coin]) grouped[d.coin] = [];
      grouped[d.coin].push(d);
    });

    const candles3m = context.promptOptions?.candles3m ?? 10;
    const candles1h = context.promptOptions?.candles1h ?? 8;
    const candles4h = context.promptOptions?.candles4h ?? 5;
    const sections = context.promptOptions?.sections ?? {
      candlesTA: true,
      sentiment: true,
      technicalState: true,
    };

    // Build formatted sections
    const candlesTA = sections.candlesTA
      ? `CANDLES & TECHNICAL ANALYSIS (per coin):\n${this.formatMarketDataDetailed(marketData, candles3m, candles1h, candles4h)}`
      : '';

    const accountInfo = this.formatAccountDataDetailed(account);
    const positionsInfo = this.formatPositionDataDetailed(existingPositions, enrichedPositions);

    const sentimentSection = sections.sentiment ? this.formatDerivedSentiment(grouped) : '';
    const sentimentInfo = sections.sentiment
      ? `MARKET SENTIMENT (DERIVED):\n${sentimentSection}`
      : '';

    const techStateSection = sections.technicalState ? this.formatTechnicalState(grouped) : '';
    const technicalState = sections.technicalState
      ? `CURRENT TECHNICAL STATE (SUMMARY):\n${techStateSection}`
      : '';

    const templateContext = {
      elapsedMinutes,
      currentTime,
      invokeCount: context.invokeCount,
      candlesTA,
      accountInfo,
      positionsInfo,
      sentimentInfo,
      technicalState,
    };

    return renderTemplate(this.promptGroup.user, templateContext);
  }

  protected formatMarketDataDetailed(
    marketData: MarketData[],
    candles3m: number = 10,
    candles1h: number = 8,
    candles4h: number = 5
  ): string {
    // Group market data by coin
    const dataByCoin: Record<string, MarketData[]> = {};

    marketData.forEach(data => {
      if (!dataByCoin[data.coin]) {
        dataByCoin[data.coin] = [];
      }
      dataByCoin[data.coin].push(data);
    });

    let formatted = '';

    type ExtendedIndicators = TechnicalIndicators & { rsi7?: number };
    for (const [coin, coinData] of Object.entries(dataByCoin)) {
      const indicators = coinData[0].indicators as ExtendedIndicators;
      formatted += `${coin}:\n`;
      formatted += `  current_price: ${coinData[0].currentPrice.toFixed(2)}\n`;
      formatted += `  current_ema20: ${indicators.ema20.toFixed(2)}\n`;
      formatted += `  current_macd: ${indicators.macd.macd.toFixed(4)}\n`;
      if (indicators.rsi7 !== undefined) {
        formatted += `  current_rsi_7: ${indicators.rsi7.toFixed(2)}\n`;
      }
      formatted += `  current_rsi_14: ${indicators.rsi14.toFixed(2)}\n`;
      formatted += `  current_atr_14: ${indicators.atr14.toFixed(2)}\n`;
      formatted += `  ema_alignment: ${indicators.ema20 >= indicators.ema50 ? 'bullish' : 'bearish'}\n`;
      if (indicators.bollinger) {
        formatted += `  bollinger: { position: ${indicators.bollinger.position}, percentB: ${indicators.bollinger.percentB.toFixed(2)}, bandwidth: ${indicators.bollinger.bandwidth.toFixed(3)} }\n`;
      }
      if (indicators.volume) {
        formatted += `  volume: { sma20: ${indicators.volume.sma20.toFixed(0)}, ratio: ${indicators.volume.ratio.toFixed(2)} }\n`;
      }
      formatted += `  trend: ${coinData[0].trend}\n`;
      formatted += `  volatility: ${coinData[0].volatility}\n`;

      // Add recent K-line data with multi-timeframe analysis
      const recent3m = coinData.find(d => d.timeframe === '3m');
      const recent1h = coinData.find(d => d.timeframe === '1h');
      const recent4h = coinData.find(d => d.timeframe === '4h');

      // Multi-timeframe trend consistency check
      const trends: Array<{ timeframe: string; trend: string }> = [];
      if (recent3m) trends.push({ timeframe: '3m', trend: recent3m.trend });
      if (recent1h) trends.push({ timeframe: '1h', trend: recent1h.trend });
      if (recent4h) trends.push({ timeframe: '4h', trend: recent4h.trend });

      const bullishCount = trends.filter(t => t.trend === 'bullish').length;
      const bearishCount = trends.filter(t => t.trend === 'bearish').length;
      const trendConsistency =
        trends.length > 0 ? Math.max(bullishCount, bearishCount) / trends.length : 0;
      const hasConflict = bullishCount > 0 && bearishCount > 0;

      if (trends.length > 1) {
        formatted += `  multi_timeframe_analysis: {\n`;
        formatted += `    trends: ${JSON.stringify(trends)},\n`;
        formatted += `    consistency: ${(trendConsistency * 100).toFixed(1)}%,\n`;
        formatted += `    conflict: ${hasConflict},\n`;
        formatted += `    alignment: ${trendConsistency >= 0.67 ? 'strong' : trendConsistency >= 0.5 ? 'moderate' : 'weak'}\n`;
        formatted += `  }\n`;
      }

      if (recent3m && recent3m.candlesticks.length > 0) {
        const recent3mCandles = recent3m.candlesticks.slice(-candles3m);
        formatted += `  intraday_3min: [\n`;
        recent3mCandles.forEach(c => {
          formatted += `    {timestamp: ${c.timestamp}, open: ${c.open.toFixed(2)}, high: ${c.high.toFixed(2)}, low: ${c.low.toFixed(2)}, close: ${c.close.toFixed(2)}, volume: ${c.volume.toFixed(2)}},\n`;
        });
        formatted += `  ]\n`;
      }

      if (recent1h && recent1h.candlesticks.length > 0) {
        const recent1hCandles = recent1h.candlesticks.slice(-candles1h);
        formatted += `  medium_term_1hour: [\n`;
        recent1hCandles.forEach(c => {
          formatted += `    {timestamp: ${c.timestamp}, open: ${c.open.toFixed(2)}, high: ${c.high.toFixed(2)}, low: ${c.low.toFixed(2)}, close: ${c.close.toFixed(2)}, volume: ${c.volume.toFixed(2)}},\n`;
        });
        formatted += `  ]\n`;
      }

      if (recent4h && recent4h.candlesticks.length > 0) {
        const recent4hCandles = recent4h.candlesticks.slice(-candles4h);
        formatted += `  longer_term_4hour: [\n`;
        recent4hCandles.forEach(c => {
          formatted += `    {timestamp: ${c.timestamp}, open: ${c.open.toFixed(2)}, high: ${c.high.toFixed(2)}, low: ${c.low.toFixed(2)}, close: ${c.close.toFixed(2)}, volume: ${c.volume.toFixed(2)}},\n`;
        });
        formatted += `  ]\n`;
      }
      formatted += '\n';
    }

    return formatted;
  }

  private deriveSentiment(
    indicators: TechnicalIndicators,
    trend: TMarketData['trend'],
    volatility: TMarketData['volatility']
  ): { sentiment: 'bullish' | 'bearish' | 'neutral'; score: number; drivers: string[] } {
    let score = 0;
    const drivers: string[] = [];

    // EMA alignment
    if (indicators.ema20 !== undefined && indicators.ema50 !== undefined) {
      if (indicators.ema20 > indicators.ema50) {
        score += 1;
        drivers.push('EMA20>EMA50');
      } else if (indicators.ema20 < indicators.ema50) {
        score -= 1;
        drivers.push('EMA20<EMA50');
      }
    }

    // MACD vs signal
    if (
      indicators.macd &&
      typeof indicators.macd.macd === 'number' &&
      typeof indicators.macd.signal === 'number'
    ) {
      if (indicators.macd.macd > indicators.macd.signal) {
        score += 1;
        drivers.push('MACD>Signal');
      } else if (indicators.macd.macd < indicators.macd.signal) {
        score -= 1;
        drivers.push('MACD<Signal');
      }
    }

    // RSI14 zones
    if (typeof indicators.rsi14 === 'number') {
      if (indicators.rsi14 >= 55 && indicators.rsi14 <= 70) {
        score += 0.5;
        drivers.push('RSI14 bullish zone');
      } else if (indicators.rsi14 <= 45 && indicators.rsi14 >= 30) {
        score -= 0.5;
        drivers.push('RSI14 bearish zone');
      }
    }

    // Bollinger position
    if (indicators.bollinger && typeof indicators.bollinger.percentB === 'number') {
      if (indicators.bollinger.percentB > 0.6) {
        score += 0.25;
        drivers.push('BB %B high');
      } else if (indicators.bollinger.percentB < 0.4) {
        score -= 0.25;
        drivers.push('BB %B low');
      }
    }

    // Trend direction
    if (trend === 'bullish') {
      score += 0.75;
      drivers.push('Trend up');
    }
    if (trend === 'bearish') {
      score -= 0.75;
      drivers.push('Trend down');
    }

    // Volatility caution
    if (volatility === 'high') {
      drivers.push('High vol');
    }

    const sentiment = score > 0.25 ? 'bullish' : score < -0.25 ? 'bearish' : 'neutral';
    // Normalize to 0..1 for readability
    const normalized = Math.max(0, Math.min(1, (score + 3) / 6));
    return { sentiment, score: Number(normalized.toFixed(2)), drivers };
  }

  protected formatDerivedSentiment(grouped: Record<string, MarketData[]>): string {
    let out = '';
    for (const [coin, arr] of Object.entries(grouped)) {
      const base = arr[0];
      const s = this.deriveSentiment(
        base.indicators as TechnicalIndicators,
        base.trend as TMarketData['trend'],
        base.volatility as TMarketData['volatility']
      );
      out += `${coin}: sentiment=${s.sentiment}, score=${s.score} drivers=[${s.drivers.join(', ')}]\n`;
    }
    return out;
  }

  private summarizeTechnicalState(data: MarketData[]): string {
    const base = data[0];
    const ind = base.indicators as TechnicalIndicators;
    const emaAlign =
      ind.ema20 !== undefined && ind.ema50 !== undefined
        ? ind.ema20 > ind.ema50
          ? 'EMA20>EMA50'
          : 'EMA20<EMA50'
        : 'EMA n/a';
    const macdRel = ind.macd
      ? ind.macd.macd > ind.macd.signal
        ? 'MACD>Signal'
        : 'MACD<Signal'
      : 'MACD n/a';
    const rsiZone =
      typeof ind.rsi14 === 'number'
        ? ind.rsi14 > 70
          ? 'overbought'
          : ind.rsi14 < 30
            ? 'oversold'
            : ind.rsi14 >= 50
              ? 'bullish'
              : 'bearish'
        : 'RSI n/a';
    return `${base.trend} trend | ${emaAlign} | ${macdRel} | RSI14 ${rsiZone} | vol ${base.volatility}`;
  }

  protected formatTechnicalState(grouped: Record<string, MarketData[]>): string {
    let out = '';
    for (const [coin, arr] of Object.entries(grouped)) {
      out += `${coin}: ${this.summarizeTechnicalState(arr)}\n`;
    }
    return out;
  }

  protected formatAccountDataDetailed(account: Account): string {
    const totalReturnPercent = ((account.equity - 10000) / 10000) * 100; // Assuming initial balance of $10k
    const availableCash = account.availableMargin;
    const currentAccountValue = account.equity;

    return `Current Total Return (percent): ${totalReturnPercent.toFixed(2)}%
Available Cash: ${availableCash.toFixed(2)}
Current Account Value: ${currentAccountValue.toFixed(2)}
Balance: ${account.balance.toFixed(2)}
Used Margin: ${account.usedMargin.toFixed(2)}`;
  }

  protected formatPositionDataDetailed(
    positions: Position[],
    enrichedPositions?: EnrichedPositionInfo[]
  ): string {
    if (positions.length === 0) {
      return 'No existing positions.';
    }

    // Create a map of enriched positions by symbol for quick lookup
    const enrichedMap = new Map<string, EnrichedPositionInfo>();
    if (enrichedPositions) {
      enrichedPositions.forEach(ep => {
        enrichedMap.set(ep.position.symbol, ep);
      });
    }

    const positionsJson = positions.map(pos => {
      const enriched = enrichedMap.get(pos.symbol);
      const entryPrice = pos.entryPrice;
      const pnlPercent = (pos.unrealizedPnl / (pos.size * entryPrice)) * 100;

      // Use enriched data if available, otherwise fall back to estimates
      if (enriched) {
        // Determine stop loss/take profit status
        const stopLossStatus =
          enriched.distanceToStopLoss < 0
            ? 'TRIGGERED'
            : enriched.distanceToStopLoss < 1
              ? 'CLOSE'
              : enriched.distanceToStopLoss < 3
                ? 'NEAR'
                : 'SAFE';
        const takeProfitStatus =
          enriched.distanceToTakeProfit < 0
            ? 'EXCEEDED'
            : enriched.distanceToTakeProfit < 1
              ? 'CLOSE'
              : enriched.distanceToTakeProfit < 3
                ? 'NEAR'
                : 'FAR';

        return {
          symbol: pos.symbol,
          quantity: pos.size,
          entry_price: entryPrice,
          current_price: enriched.currentPrice,
          unrealized_pnl: pos.unrealizedPnl,
          pnl_percent: pnlPercent,
          r_multiple: enriched.rMultiple,
          exit_plan: {
            stop_loss: enriched.effectiveStopLoss,
            take_profit: enriched.effectiveTakeProfit,
            stop_loss_distance: `${enriched.distanceToStopLoss.toFixed(2)}%`,
            stop_loss_status: stopLossStatus,
            take_profit_distance: `${enriched.distanceToTakeProfit.toFixed(2)}%`,
            take_profit_status: takeProfitStatus,
          },
          exit_features: {
            has_trailing_stop: enriched.hasTrailingStop,
            has_custom_stop_loss: enriched.hasCustomStopLoss,
            has_custom_take_profit: enriched.hasCustomTakeProfit,
            tp1_executed: enriched.tp1Executed,
          },
        };
      } else {
        // Fallback to estimated values when enriched data is not available
        const stopLossPercent = 0.03; // 3%
        const profitTargetPercent = 0.06; // 6%

        const stopLoss =
          pos.side === 'long'
            ? entryPrice * (1 - stopLossPercent)
            : entryPrice * (1 + stopLossPercent);

        const profitTarget =
          pos.side === 'long'
            ? entryPrice * (1 + profitTargetPercent)
            : entryPrice * (1 - profitTargetPercent);

        return {
          symbol: pos.symbol,
          quantity: pos.size,
          entry_price: entryPrice,
          unrealized_pnl: pos.unrealizedPnl,
          pnl_percent: pnlPercent,
          exit_plan: {
            stop_loss: stopLoss,
            take_profit: profitTarget,
            note: 'Estimated values (enriched data not available)',
          },
        };
      }
    });

    return JSON.stringify(positionsJson, null, 2);
  }
}

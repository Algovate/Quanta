import axios from 'axios';
import { MarketData } from '../data/market.js';
import { Account, Position, TradingSignal } from '../types/index.js';
import type { TechnicalIndicators, MarketData as TMarketData } from '../types/index.js';
import { Logger } from '../utils/logger.js';
import { withRetry, createRetryConfig } from '../utils/retry.js';
import { CircuitBreaker, createCircuitBreaker } from '../utils/circuit-breaker.js';
import {
  initLangSmithTracing,
  traceable,
  getTracingConfig,
  buildTraceInputs,
  buildTraceOutputs,
} from './tracing.js';
import { loadPromptGroup, renderTemplate, type PromptGroup } from './prompt-loader.js';
import { getConfig } from '../config/settings.js';

export interface AIResponse {
  coin: string;
  action: 'LONG' | 'SHORT' | 'CLOSE' | 'HOLD';
  confidence: number;
  reasoning: string;
  entry_price?: number;
  position_size?: number;
  stop_loss?: number;
  profit_target?: number;
  invalidation_condition?: string;
}

export interface EnrichedPositionInfo {
  position: Position;
  effectiveStopLoss: number;
  effectiveTakeProfit: number;
  currentPrice: number;
  distanceToStopLoss: number; // Percentage: positive = safe, negative = triggered
  distanceToTakeProfit: number; // Percentage: positive = not reached, negative = exceeded
  hasTrailingStop: boolean;
  hasCustomStopLoss: boolean;
  hasCustomTakeProfit: boolean;
  tp1Executed: boolean; // Whether TP1 (partial close) has been executed
  rMultiple: number; // Current R-multiple relative to initial risk
}

export interface AIContext {
  startTime: number;
  currentTime: number;
  invokeCount: number;
  tradableCoins: string[];
  maxPositions: number;
  maxRiskPerTrade: number;
  maxLeverage: number;
  minLeverage: number;
  defaultStopLoss: number;
  promptOptions?: {
    candles3m: number;
    candles4h: number;
    sections: {
      candlesTA: boolean;
      sentiment: boolean;
      technicalState: boolean;
    };
  };
}

export class OpenRouterClient {
  private apiKey: string;
  private model: string;
  private temperature: number;
  private logger: Logger;
  private circuitBreaker: CircuitBreaker;
  private promptGroupName: string;
  private promptGroup: PromptGroup | null = null;

  constructor(
    apiKey: string,
    model: string = 'deepseek/deepseek-chat',
    temperature: number = 0.7,
    promptGroupName?: string
  ) {
    this.apiKey = apiKey;
    this.model = model;
    this.temperature = temperature;
    this.logger = Logger.getInstance('OpenRouter');
    this.circuitBreaker = createCircuitBreaker('OpenRouter', {
      failureThreshold: 5,
      resetTimeout: 60000, // 1 minute
      halfOpenMaxAttempts: 2,
    });
    // Get prompt group name from parameter or config
    this.promptGroupName = promptGroupName ?? getConfig().ai.prompt.activeGroup;
    // Initialize LangChain tracing from config
    initLangSmithTracing();
  }

  /**
   * Load the prompt group if not already loaded
   * @throws Error if the prompt group cannot be loaded
   */
  private ensurePromptGroupLoaded(): void {
    if (!this.promptGroup) {
      try {
        this.promptGroup = loadPromptGroup(this.promptGroupName);
        this.logger.info(`Loaded prompt group: ${this.promptGroupName}`);
      } catch (error) {
        const errorMessage =
          error instanceof Error
            ? error.message
            : `Failed to load prompt group "${this.promptGroupName}"`;
        this.logger.error(`Failed to load prompt group: ${errorMessage}`, error);
        throw new Error(
          `Cannot load prompt group "${this.promptGroupName}". ` +
            `Please ensure the prompt configuration file exists at config/prompts/${this.promptGroupName}.json`
        );
      }
    }
  }

  async generateTradingSignal(
    marketData: MarketData[],
    account: Account,
    existingPositions: Position[],
    context: AIContext,
    enrichedPositions?: EnrichedPositionInfo[]
  ): Promise<TradingSignal[]> {
    const tracingConfig = getTracingConfig();

    // Build prompt before tracing so it can be included in trace inputs
    const prompt = this.buildPrompt(
      marketData,
      account,
      existingPositions,
      context,
      enrichedPositions
    );

    // Prepare inputs for traceable to capture (includes system/user/full prompt when enabled)
    const traceableInputs = buildTraceInputs(
      {
        coins: context.tradableCoins,
        model: this.model,
        temperature: this.temperature,
        mode: context.invokeCount > 0 ? 'live' : 'initial',
      },
      prompt,
      tracingConfig
    );

    // Create a traced version that includes the prompt in inputs
    const tracedWithPrompt = traceable(
      async (_inputs: typeof traceableInputs) => {
        // Inputs parameter is here so traceable captures it in the trace
        // Use the prompt from closure (it's already in inputs for trace viewing)
        const response = await this.callOpenRouterAPI(prompt);
        const parsed = this.parseResponse(response);

        // Attach raw API response when enabled
        return buildTraceOutputs({ signals: parsed }, response, tracingConfig);
      },
      {
        name: 'generateTradingSignal',
        run_type: 'chain',
      }
    );

    const result = await tracedWithPrompt(traceableInputs);

    // Extract signals from result (which may include api_response)
    return Array.isArray(result.signals) ? result.signals : [];
  }

  private buildPrompt(
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

    // Use explicit separator to avoid brittle substring splits later
    return `${systemPrompt}\n\n---USER---\n${userPrompt}`;
  }

  private buildSystemPrompt(context: AIContext): string {
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

  private buildUserPrompt(
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
    const candles4h = context.promptOptions?.candles4h ?? 5;
    const sections = context.promptOptions?.sections ?? {
      candlesTA: true,
      sentiment: true,
      technicalState: true,
    };

    // Build formatted sections
    const candlesTA = sections.candlesTA
      ? `CANDLES & TECHNICAL ANALYSIS (per coin):\n${this.formatMarketDataDetailed(marketData, candles3m, candles4h)}`
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

  private formatMarketDataDetailed(
    marketData: MarketData[],
    candles3m: number = 10,
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

      // Add recent K-line data
      const recent3m = coinData.find(d => d.timeframe === '3m');
      const recent4h = coinData.find(d => d.timeframe === '4h');

      if (recent3m && recent3m.candlesticks.length > 0) {
        const recent3mCandles = recent3m.candlesticks.slice(-candles3m);
        formatted += `  intraday_3min: [\n`;
        recent3mCandles.forEach(c => {
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

  private formatDerivedSentiment(grouped: Record<string, MarketData[]>): string {
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

  private formatTechnicalState(grouped: Record<string, MarketData[]>): string {
    let out = '';
    for (const [coin, arr] of Object.entries(grouped)) {
      out += `${coin}: ${this.summarizeTechnicalState(arr)}\n`;
    }
    return out;
  }

  private formatAccountDataDetailed(account: Account): string {
    const totalReturnPercent = ((account.equity - 10000) / 10000) * 100; // Assuming initial balance of $10k
    const availableCash = account.availableMargin;
    const currentAccountValue = account.equity;

    return `Current Total Return (percent): ${totalReturnPercent.toFixed(2)}%
Available Cash: ${availableCash.toFixed(2)}
Current Account Value: ${currentAccountValue.toFixed(2)}
Balance: ${account.balance.toFixed(2)}
Used Margin: ${account.usedMargin.toFixed(2)}`;
  }

  private formatPositionDataDetailed(
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

  private async callOpenRouterAPI(prompt: string): Promise<string> {
    // Use circuit breaker with fallback to empty response
    return await this.circuitBreaker.execute(
      async () => {
        // Use retry logic for the actual API call
        return await withRetry(
          async () => {
            // Extract system prompt and user prompt using explicit separator
            const separator = '\n---USER---\n';
            const sepIdx = prompt.indexOf(separator);
            const systemPrompt = sepIdx >= 0 ? prompt.substring(0, sepIdx).trim() : prompt;
            const userPrompt =
              sepIdx >= 0 ? prompt.substring(sepIdx + separator.length).trim() : '';

            const response = await axios.post(
              'https://openrouter.ai/api/v1/chat/completions',
              {
                model: this.model,
                messages: [
                  {
                    role: 'system',
                    content: systemPrompt,
                  },
                  {
                    role: 'user',
                    content: userPrompt,
                  },
                ],
                temperature: this.temperature,
                max_tokens: 4000,
              },
              {
                headers: {
                  Authorization: `Bearer ${this.apiKey}`,
                  'Content-Type': 'application/json',
                  'HTTP-Referer': 'https://quanta-cli.com',
                  'X-Title': 'Quanta CLI',
                },
                timeout: 30000, // 30 second timeout
              }
            );

            return response.data.choices[0].message.content;
          },
          createRetryConfig({
            maxRetries: 3,
            baseDelay: 2000, // Start with 2 second delay
            maxDelay: 15000, // Max 15 seconds between retries
            timeout: 30000, // Overall timeout per attempt
            shouldRetry: (error: any) => {
              // Don't retry on 4xx errors (client errors, likely API key or quota issues)
              if (
                error.response?.status &&
                error.response.status >= 400 &&
                error.response.status < 500 &&
                error.response.status !== 429
              ) {
                this.logger.warn('Not retrying OpenRouter API call due to client error', {
                  status: error.response.status,
                  message: error.message,
                });
                return false;
              }
              // Retry on network errors, timeouts, 5xx errors, and rate limits (429)
              return true;
            },
            onRetry: (attempt: number, error: any) => {
              this.logger.warn('Retrying OpenRouter API call', {
                attempt,
                error: error instanceof Error ? error.message : String(error),
                status: error.response?.status,
              });
            },
          })
        );
      },
      async () => {
        // Fallback when circuit is open - return empty response
        this.logger.error(
          'OpenRouter circuit breaker is OPEN, returning empty response',
          new Error('Circuit breaker open')
        );
        return '{"signals": []}';
      }
    );
  }

  private parseResponse(response: string): TradingSignal[] {
    try {
      // Clean the response to extract JSON
      const jsonMatch = response.match(/\{[\s\S]*\}/);
      if (!jsonMatch) {
        throw new Error('No JSON found in response');
      }

      const parsed = JSON.parse(jsonMatch[0]);

      if (!parsed.signals || !Array.isArray(parsed.signals)) {
        throw new Error('Invalid response format');
      }

      return parsed.signals.map((signal: AIResponse) => ({
        coin: signal.coin,
        action: signal.action,
        confidence: signal.confidence,
        reasoning: signal.reasoning,
        entryPrice: signal.entry_price,
        positionSize: signal.position_size,
        stopLoss: signal.stop_loss,
        profitTarget: signal.profit_target,
        invalidationCondition: signal.invalidation_condition,
        timestamp: Date.now(),
      }));
    } catch (error) {
      this.logger.error('Error parsing AI response', error, { rawResponse: response });
      return [];
    }
  }
}

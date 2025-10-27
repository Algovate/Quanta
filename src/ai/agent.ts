import axios from 'axios';
import { MarketData } from '../data/market.js';
import { Account, Position, TradingSignal } from '../types/index.js';

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

export class OpenRouterClient {
  private apiKey: string;
  private model: string;
  private temperature: number;

  constructor(apiKey: string, model: string = 'deepseek/deepseek-chat', temperature: number = 0.7) {
    this.apiKey = apiKey;
    this.model = model;
    this.temperature = temperature;
  }

  async generateTradingSignal(
    marketData: MarketData[],
    account: Account,
    existingPositions: Position[]
  ): Promise<TradingSignal[]> {
    try {
      const prompt = this.buildPrompt(marketData, account, existingPositions);
      const response = await this.callOpenRouterAPI(prompt);
      return this.parseResponse(response);
    } catch (error) {
      console.error('Error generating trading signal:', error);
      return [];
    }
  }

  private buildPrompt(
    marketData: MarketData[],
    account: Account,
    existingPositions: Position[]
  ): string {
    const systemPrompt = `You are an expert quantitative trader analyzing cryptocurrency markets.
Your task is to generate trading signals based on technical analysis and market conditions.

IMPORTANT: Respond ONLY with valid JSON in the exact format specified below. Do not include any other text.

Response Format:
{
  "signals": [
    {
      "coin": "BTC",
      "action": "LONG|SHORT|CLOSE|HOLD",
      "confidence": 0.85,
      "reasoning": "Brief explanation of the trade rationale",
      "entry_price": 45000,
      "position_size": 0.1,
      "stop_loss": 0.03,
      "profit_target": 0.06,
      "invalidation_condition": "Price breaks below EMA20"
    }
  ]
}

Guidelines:
- Only generate signals for coins with strong technical setups
- Confidence should be 0.0-1.0 (higher for stronger setups)
- Position size should be conservative (0.01-0.2)
- Stop loss should be 0.02-0.05 (2-5%)
- Profit target should be 1.5-3x the stop loss
- Consider risk management and portfolio balance`;

    const marketContext = this.formatMarketData(marketData);
    const accountContext = this.formatAccountData(account);
    const positionContext = this.formatPositionData(existingPositions);

    return `${systemPrompt}

CURRENT MARKET DATA:
${marketContext}

ACCOUNT STATUS:
${accountContext}

EXISTING POSITIONS:
${positionContext}

Generate trading signals based on this data. Respond with JSON only.`;
  }

  private formatMarketData(marketData: MarketData[]): string {
    return marketData
      .map(data => {
        return `
${data.coin} (${data.timeframe}):
  Price: $${data.currentPrice.toFixed(2)}
  Trend: ${data.trend}
  Volatility: ${data.volatility}
  EMA20: $${data.indicators.ema20.toFixed(2)}
  EMA50: $${data.indicators.ema50.toFixed(2)}
  MACD: ${data.indicators.macd.macd.toFixed(4)}
  RSI(14): ${data.indicators.rsi14.toFixed(2)}
  ATR(14): $${data.indicators.atr14.toFixed(2)}`;
      })
      .join('\n');
  }

  private formatAccountData(account: Account): string {
    return `
Balance: $${account.balance.toFixed(2)}
Equity: $${account.equity.toFixed(2)}
Available Margin: $${account.availableMargin.toFixed(2)}
Used Margin: $${account.usedMargin.toFixed(2)}`;
  }

  private formatPositionData(positions: Position[]): string {
    if (positions.length === 0) return 'No existing positions';

    return positions
      .map(
        pos => `
${pos.symbol}: ${pos.side} ${pos.size} @ $${pos.entryPrice}
  PnL: $${pos.unrealizedPnl.toFixed(2)}
  Margin: $${pos.marginUsed.toFixed(2)}`
      )
      .join('\n');
  }

  private async callOpenRouterAPI(prompt: string): Promise<string> {
    try {
      const response = await axios.post(
        'https://openrouter.ai/api/v1/chat/completions',
        {
          model: this.model,
          messages: [
            {
              role: 'system',
              content: 'You are a quantitative trading AI that generates JSON trading signals.',
            },
            {
              role: 'user',
              content: prompt,
            },
          ],
          temperature: this.temperature,
          max_tokens: 2000,
        },
        {
          headers: {
            Authorization: `Bearer ${this.apiKey}`,
            'Content-Type': 'application/json',
            'HTTP-Referer': 'https://quanta-cli.com',
            'X-Title': 'Quanta CLI',
          },
        }
      );

      return response.data.choices[0].message.content;
    } catch (error) {
      console.error('OpenRouter API Error:', error);
      throw error;
    }
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
      console.error('Error parsing AI response:', error);
      console.error('Raw response:', response);
      return [];
    }
  }
}

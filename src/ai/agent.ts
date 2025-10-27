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
    existingPositions: Position[],
    context: AIContext
  ): Promise<TradingSignal[]> {
    try {
      const prompt = this.buildPrompt(marketData, account, existingPositions, context);
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
    existingPositions: Position[],
    context: AIContext
  ): string {
    const systemPrompt = this.buildSystemPrompt(context);
    const userPrompt = this.buildUserPrompt(marketData, account, existingPositions, context);

    return `${systemPrompt}

${userPrompt}`;
  }

  private buildSystemPrompt(context: AIContext): string {
    return `You are an expert cryptocurrency trader managing a live perpetual futures portfolio.

## HARD CONSTRAINTS

- Tradable coins: ${context.tradableCoins.join(', ')}
- Maximum ${context.maxPositions} concurrent positions
- Maximum risk per trade: ${(context.maxRiskPerTrade * 100).toFixed(0)}% of account value
- Leverage range: ${context.minLeverage}x to ${context.maxLeverage}x
- Default stop loss: ${(context.defaultStopLoss * 100).toFixed(1)}%

## DECISION FRAMEWORK

CRITICAL: Your actions depend on whether a position exists for each coin:

1. **For coins WITH positions**: You can only choose:
   - "CLOSE" - Close the position immediately (use when stop loss hit, profit target reached, or trend reversal)
   - "HOLD" - Continue holding the position

2. **For coins WITHOUT positions**: You can only choose:
   - "LONG" - Open a long position
   - "SHORT" - Open a short position

NEVER try to open a LONG when already holding LONG, or SHORT when holding SHORT.

## OUTPUT FORMAT

You MUST respond with ONLY valid JSON in this exact format:

{
  "signals": [
    {
      "coin": "BTC",
      "action": "LONG|SHORT|CLOSE|HOLD",
      "confidence": 0.85,
      "reasoning": "Brief explanation of your trading rationale",
      "entry_price": 45000,
      "position_size": 0.1,
      "stop_loss": 0.03,
      "profit_target": 0.06,
      "invalidation_condition": "Price breaks below key support at $44000",
      "leverage": 10
    }
  ]
}

Field Guidelines:
- confidence: 0.0-1.0 (higher for stronger setups, use >0.6 for entries)
- position_size: Coin quantity (e.g., 0.1 BTC, 5 ETH)
- stop_loss: Decimal (e.g., 0.03 = 3% stop loss from entry)
- profit_target: Decimal (e.g., 0.06 = 6% profit target from entry, should be 1.5-3x stop loss)
- invalidation_condition: Clear technical condition that invalidates the trade

## THINKING PROCESS

Before outputting JSON, analyze each coin step by step:

1. For coins WITH positions:
   - Review current PnL and exit plan
   - Assess if stop loss or profit target is hit
   - Check if trend has reversed
   - Decide: CLOSE now or HOLD

2. For coins WITHOUT positions:
   - Analyze technical indicators (RSI, MACD, EMA trends)
   - Check market structure and price action
   - Assess entry timing and risk/reward
   - Decide: LONG, SHORT, or skip

IMPORTANT: You must respond with ONLY the JSON object. No other text before or after.`;
  }

  private buildUserPrompt(
    marketData: MarketData[],
    account: Account,
    existingPositions: Position[],
    context: AIContext
  ): string {
    const elapsedMinutes = Math.floor((context.currentTime - context.startTime) / 60000);
    const currentTime = new Date(context.currentTime).toISOString();

    let userPrompt = `It has been ${elapsedMinutes} minutes since you started trading. The current time is ${currentTime}. You've been invoked ${context.invokeCount} times.\n\n`;
    userPrompt += `ALL OF THE PRICE OR SIGNAL DATA BELOW IS ORDERED: OLDEST → NEWEST\n\n`;

    userPrompt += `**CURRENT MARKET STATE FOR ALL COINS:**\n`;
    userPrompt += this.formatMarketDataDetailed(marketData);

    userPrompt += `\n**HERE IS YOUR ACCOUNT INFORMATION & PERFORMANCE:**\n`;
    userPrompt += this.formatAccountDataDetailed(account);

    userPrompt += `\n**CURRENT LIVE POSITIONS & PERFORMANCE:**\n`;
    userPrompt += this.formatPositionDataDetailed(existingPositions);

    userPrompt += `\nGenerate trading signals based on this data. Respond with JSON only.`;

    return userPrompt;
  }

  private formatMarketDataDetailed(marketData: MarketData[]): string {
    // Group market data by coin
    const dataByCoin: Record<string, MarketData[]> = {};

    marketData.forEach(data => {
      if (!dataByCoin[data.coin]) {
        dataByCoin[data.coin] = [];
      }
      dataByCoin[data.coin].push(data);
    });

    let formatted = '';

    for (const [coin, coinData] of Object.entries(dataByCoin)) {
      const indicators = coinData[0].indicators;
      formatted += `${coin}:\n`;
      formatted += `  current_price: ${coinData[0].currentPrice.toFixed(2)}\n`;
      formatted += `  current_ema20: ${indicators.ema20.toFixed(2)}\n`;
      formatted += `  current_macd: ${indicators.macd.macd.toFixed(4)}\n`;
      formatted += `  current_rsi_7: ${indicators.rsi7.toFixed(2)}\n`;
      formatted += `  current_rsi_14: ${indicators.rsi14.toFixed(2)}\n`;
      formatted += `  trend: ${coinData[0].trend}\n`;
      formatted += `  volatility: ${coinData[0].volatility}\n`;

      // Add recent K-line data
      const recent3m = coinData.find(d => d.timeframe === '3m');
      const recent4h = coinData.find(d => d.timeframe === '4h');

      if (recent3m && recent3m.candlesticks.length > 0) {
        const recent3mCandles = recent3m.candlesticks.slice(-5);
        formatted += `  intraday_3min: [\n`;
        recent3mCandles.forEach(c => {
          formatted += `    {timestamp: ${c.timestamp}, open: ${c.open.toFixed(2)}, high: ${c.high.toFixed(2)}, low: ${c.low.toFixed(2)}, close: ${c.close.toFixed(2)}, volume: ${c.volume.toFixed(2)}},\n`;
        });
        formatted += `  ]\n`;
      }

      if (recent4h && recent4h.candlesticks.length > 0) {
        const recent4hCandles = recent4h.candlesticks.slice(-3);
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

  private formatPositionDataDetailed(positions: Position[]): string {
    if (positions.length === 0) {
      return 'No existing positions.';
    }

    const positionsJson = positions.map(pos => {
      // Calculate stop loss and profit target (simplified estimates)
      const entryPrice = pos.entryPrice;
      const pnlPercent = (pos.unrealizedPnl / (pos.size * entryPrice)) * 100;

      // Estimate exit plan based on risk/reward
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
          profit_target: profitTarget,
        },
      };
    });

    return JSON.stringify(positionsJson, null, 2);
  }

  private async callOpenRouterAPI(prompt: string): Promise<string> {
    try {
      // Extract system prompt and user prompt
      const systemPromptEnd = prompt.indexOf('**CURRENT MARKET STATE');
      const systemPrompt = prompt.substring(0, systemPromptEnd).trim();
      const userPrompt = prompt.substring(systemPromptEnd).trim();

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

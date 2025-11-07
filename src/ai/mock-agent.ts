import { MarketData } from '../data/market.js';
import { Account, Position, TradingSignal } from '../types/index.js';
import { TechnicalIndicators } from '../types/index.js';
import type { AIContext } from './agent.js';
import {
  MOCK_AI_SIGNALS,
  TECHNICAL_THRESHOLDS,
  CONFIDENCE_ADJUSTMENTS,
  RSI_RANGES,
} from './constants.js';

export class MockAIAgent {
  private signalCounter: number = 0;

  async generateTradingSignal(
    marketData: MarketData[],
    account: Account,
    existingPositions: Position[],
    _context?: AIContext
  ): Promise<TradingSignal[]> {
    const signals: TradingSignal[] = [];

    // Generate signals for each coin in market data
    for (const data of marketData) {
      const signal = this.generateSignalForCoin(data, account, existingPositions);
      if (signal) {
        signals.push(signal);
      }
    }

    return signals;
  }

  private generateSignalForCoin(
    marketData: MarketData,
    _account: Account,
    existingPositions: Position[]
  ): TradingSignal | null {
    const { coin, indicators, trend, volatility, currentPrice } = marketData;

    // Check if we already have a position in this coin
    // Normalize symbol comparison: coin is "BTC", position.symbol is "BTC/USDT"
    const positionSymbol = `${coin}/USDT`;
    const existingPosition = existingPositions.find(p => p.symbol === positionSymbol);

    // Generate deterministic signals based on technical indicators
    const signal = this.analyzeMarketConditions(
      coin,
      indicators,
      trend,
      volatility,
      currentPrice,
      existingPosition
    );

    return signal;
  }

  private analyzeMarketConditions(
    coin: string,
    indicators: TechnicalIndicators,
    trend: string,
    volatility: string,
    currentPrice: number,
    existingPosition?: Position
  ): TradingSignal | null {
    this.signalCounter++;

    // If we have an existing position, consider closing it
    if (existingPosition) {
      return this.generateCloseSignal(coin, existingPosition, indicators, currentPrice);
    }

    // Generate new position signals based on technical analysis
    const rsi = indicators.rsi14;
    const macd = indicators.macd.macd;
    const macdSignal = indicators.macd.signal;
    const ema20 = indicators.ema20;
    const ema50 = indicators.ema50;

    // Bullish conditions
    if (this.isBullishSetup(rsi, macd, macdSignal, ema20, ema50, currentPrice)) {
      return this.generateLongSignal(coin, currentPrice, indicators, trend, volatility);
    }

    // Bearish conditions
    if (this.isBearishSetup(rsi, macd, macdSignal, ema20, ema50, currentPrice)) {
      return this.generateShortSignal(coin, currentPrice, indicators, trend, volatility);
    }

    // Hold signal
    return this.generateHoldSignal(coin, currentPrice, indicators);
  }

  private isBullishSetup(
    rsi: number,
    macd: number,
    macdSignal: number,
    ema20: number,
    _ema50: number,
    currentPrice: number
  ): boolean {
    const rsiOk =
      rsi > TECHNICAL_THRESHOLDS.RSI_LOWER_BOUND && rsi < TECHNICAL_THRESHOLDS.RSI_UPPER_BOUND;
    const macdBullish = macd > macdSignal;
    const priceAboveEMAs = currentPrice > ema20;

    return rsiOk && (macdBullish || priceAboveEMAs);
  }

  private isBearishSetup(
    rsi: number,
    macd: number,
    macdSignal: number,
    ema20: number,
    _ema50: number,
    currentPrice: number
  ): boolean {
    const rsiOk =
      rsi > TECHNICAL_THRESHOLDS.RSI_LOWER_BOUND && rsi < TECHNICAL_THRESHOLDS.RSI_UPPER_BOUND;
    const macdBearish = macd < macdSignal;
    const priceBelowEMAs = currentPrice < ema20;

    return rsiOk && (macdBearish || priceBelowEMAs);
  }

  private generateLongSignal(
    coin: string,
    currentPrice: number,
    indicators: TechnicalIndicators,
    trend: string,
    volatility: string
  ): TradingSignal {
    const confidence = this.calculateConfidence(indicators, trend, volatility, 'bullish');
    const entryPrice =
      currentPrice * (1 + (Math.random() - 0.5) * MOCK_AI_SIGNALS.PRICE_VARIATION_RANGE);
    const stopLoss = MOCK_AI_SIGNALS.DEFAULT_STOP_LOSS;
    const profitTarget = MOCK_AI_SIGNALS.DEFAULT_PROFIT_TARGET;
    const positionSize = MOCK_AI_SIGNALS.DEFAULT_POSITION_SIZE;

    return {
      coin,
      action: 'LONG',
      confidence,
      reasoning: this.generateLongReasoning(indicators, trend, volatility),
      entry_price: entryPrice,
      position_size: positionSize,
      stop_loss: stopLoss,
      profit_target: profitTarget,
      invalidation_condition: 'Price breaks below EMA20',
    };
  }

  private generateShortSignal(
    coin: string,
    currentPrice: number,
    indicators: TechnicalIndicators,
    trend: string,
    volatility: string
  ): TradingSignal {
    const confidence = this.calculateConfidence(indicators, trend, volatility, 'bearish');
    const entryPrice =
      currentPrice * (1 + (Math.random() - 0.5) * MOCK_AI_SIGNALS.PRICE_VARIATION_RANGE);
    const stopLoss = MOCK_AI_SIGNALS.DEFAULT_STOP_LOSS;
    const profitTarget = MOCK_AI_SIGNALS.DEFAULT_PROFIT_TARGET;
    const positionSize = MOCK_AI_SIGNALS.DEFAULT_POSITION_SIZE;

    return {
      coin,
      action: 'SHORT',
      confidence,
      reasoning: this.generateShortReasoning(indicators, trend, volatility),
      entry_price: entryPrice,
      position_size: positionSize,
      stop_loss: stopLoss,
      profit_target: profitTarget,
      invalidation_condition: 'Price breaks above EMA20',
    };
  }

  private generateCloseSignal(
    coin: string,
    existingPosition: Position,
    indicators: TechnicalIndicators,
    _currentPrice: number
  ): TradingSignal {
    const pnlPercent =
      (existingPosition.unrealizedPnl / (existingPosition.size * existingPosition.entryPrice)) *
      100;

    // Close if significant profit or loss
    const shouldClose =
      Math.abs(pnlPercent) > 2 ||
      this.isReversalSignal(indicators, existingPosition.side === 'long' ? 'bullish' : 'bearish');

    if (shouldClose) {
      return {
        coin,
        action: 'CLOSE',
        confidence: 0.8,
        reasoning: `Closing position due to ${pnlPercent > 0 ? 'profit target reached' : 'stop loss triggered'} (${pnlPercent.toFixed(2)}%)`,
      };
    }

    return {
      coin,
      action: 'HOLD',
      confidence: 0.6,
      reasoning: 'Position performing within normal parameters',
    };
  }

  private generateHoldSignal(
    coin: string,
    _currentPrice: number,
    indicators: TechnicalIndicators
  ): TradingSignal {
    return {
      coin,
      action: 'HOLD',
      confidence: 0.5,
      reasoning: this.generateHoldReasoning(indicators),
    };
  }

  private calculateConfidence(
    indicators: TechnicalIndicators,
    trend: string,
    volatility: string,
    direction: 'bullish' | 'bearish'
  ): number {
    let confidence = CONFIDENCE_ADJUSTMENTS.BASE_CONFIDENCE;

    // RSI confidence
    const rsi = indicators.rsi14;
    if (direction === 'bullish') {
      if (rsi > RSI_RANGES.BULLISH_LOWER && rsi < RSI_RANGES.BULLISH_UPPER)
        confidence += CONFIDENCE_ADJUSTMENTS.RSI_CONFIDENCE_BOOST;
      else if (rsi < RSI_RANGES.BEARISH_LOWER || rsi > TECHNICAL_THRESHOLDS.RSI_OVERBOUGHT)
        confidence += CONFIDENCE_ADJUSTMENTS.RSI_CONFIDENCE_PENALTY;
    } else {
      if (rsi > RSI_RANGES.BEARISH_LOWER && rsi < RSI_RANGES.BEARISH_UPPER)
        confidence += CONFIDENCE_ADJUSTMENTS.RSI_CONFIDENCE_BOOST;
      else if (rsi < TECHNICAL_THRESHOLDS.RSI_OVERSOLD || rsi > TECHNICAL_THRESHOLDS.RSI_OVERBOUGHT)
        confidence += CONFIDENCE_ADJUSTMENTS.RSI_CONFIDENCE_PENALTY;
    }

    // MACD confidence
    const macd = indicators.macd.macd;
    const macdSignal = indicators.macd.signal;
    if (direction === 'bullish' && macd > macdSignal)
      confidence += CONFIDENCE_ADJUSTMENTS.MACD_CONFIDENCE_BOOST;
    else if (direction === 'bearish' && macd < macdSignal)
      confidence += CONFIDENCE_ADJUSTMENTS.MACD_CONFIDENCE_BOOST;

    // Trend alignment
    if (
      (direction === 'bullish' && trend === 'bullish') ||
      (direction === 'bearish' && trend === 'bearish')
    ) {
      confidence += CONFIDENCE_ADJUSTMENTS.TREND_ALIGNMENT_BOOST;
    }

    // Volatility adjustment
    if (volatility === 'medium') confidence += CONFIDENCE_ADJUSTMENTS.VOLATILITY_MEDIUM_BOOST;
    else if (volatility === 'high') confidence += CONFIDENCE_ADJUSTMENTS.VOLATILITY_HIGH_PENALTY;

    return Math.max(
      CONFIDENCE_ADJUSTMENTS.MIN_CONFIDENCE,
      Math.min(CONFIDENCE_ADJUSTMENTS.MAX_CONFIDENCE, confidence)
    );
  }

  private generateLongReasoning(
    indicators: TechnicalIndicators,
    trend: string,
    volatility: string
  ): string {
    const reasons = [];

    if (indicators.rsi14 > 40 && indicators.rsi14 < 65) {
      reasons.push('RSI in healthy range');
    }

    if (indicators.macd.macd > indicators.macd.signal) {
      reasons.push('MACD showing bullish momentum');
    }

    if (trend === 'bullish') {
      reasons.push('overall bullish trend');
    }

    if (volatility === 'medium') {
      reasons.push('moderate volatility');
    }

    return `Strong bullish momentum with ${reasons.join(', ')}`;
  }

  private generateShortReasoning(
    indicators: TechnicalIndicators,
    trend: string,
    volatility: string
  ): string {
    const reasons = [];

    if (indicators.rsi14 > 35 && indicators.rsi14 < 60) {
      reasons.push('RSI in healthy range');
    }

    if (indicators.macd.macd < indicators.macd.signal) {
      reasons.push('MACD showing bearish momentum');
    }

    if (trend === 'bearish') {
      reasons.push('overall bearish trend');
    }

    if (volatility === 'medium') {
      reasons.push('moderate volatility');
    }

    return `Strong bearish momentum with ${reasons.join(', ')}`;
  }

  private generateHoldReasoning(indicators: TechnicalIndicators): string {
    const rsi = indicators.rsi14;
    const macd = indicators.macd.macd;
    const macdSignal = indicators.macd.signal;

    if (rsi > TECHNICAL_THRESHOLDS.RSI_OVERBOUGHT) return 'RSI overbought, waiting for pullback';
    if (rsi < TECHNICAL_THRESHOLDS.RSI_OVERSOLD) return 'RSI oversold, waiting for bounce';
    if (Math.abs(macd - macdSignal) < TECHNICAL_THRESHOLDS.MACD_WEAK_MOMENTUM_THRESHOLD)
      return 'MACD showing weak momentum';

    return 'Mixed signals, waiting for clearer direction';
  }

  private isReversalSignal(
    indicators: TechnicalIndicators,
    currentDirection: 'bullish' | 'bearish'
  ): boolean {
    const rsi = indicators.rsi14;
    const macd = indicators.macd.macd;
    const macdSignal = indicators.macd.signal;

    if (currentDirection === 'bullish') {
      return rsi > TECHNICAL_THRESHOLDS.RSI_OVERBOUGHT || macd < macdSignal;
    } else {
      return rsi < TECHNICAL_THRESHOLDS.RSI_OVERSOLD || macd > macdSignal;
    }
  }
}

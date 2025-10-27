import { MarketData } from '../data/market.js';
import { Account, Position, TradingSignal } from '../types/index.js';
import { TechnicalIndicators } from '../types/index.js';
import { AIContext } from './agent.js';

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
    account: Account,
    existingPositions: Position[]
  ): TradingSignal | null {
    const { coin, indicators, trend, volatility, currentPrice } = marketData;

    // Check if we already have a position in this coin
    const existingPosition = existingPositions.find(p => p.symbol === coin);

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
    ema50: number,
    currentPrice: number
  ): boolean {
    // More lenient conditions for demonstration
    const rsiOk = rsi > 25 && rsi < 75;
    const macdBullish = macd > macdSignal;
    const priceAboveEMAs = currentPrice > ema20;

    return rsiOk && (macdBullish || priceAboveEMAs);
  }

  private isBearishSetup(
    rsi: number,
    macd: number,
    macdSignal: number,
    ema20: number,
    ema50: number,
    currentPrice: number
  ): boolean {
    // More lenient conditions for demonstration
    const rsiOk = rsi > 25 && rsi < 75;
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
    const entryPrice = currentPrice * (1 + (Math.random() - 0.5) * 0.001); // Small random variation
    const stopLoss = 0.03; // 3% stop loss
    const profitTarget = 0.06; // 6% take profit (2:1 risk/reward)
    const positionSize = 0.05; // 5% of account

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
    const entryPrice = currentPrice * (1 + (Math.random() - 0.5) * 0.001); // Small random variation
    const stopLoss = 0.03; // 3% stop loss
    const profitTarget = 0.06; // 6% take profit (2:1 risk/reward)
    const positionSize = 0.05; // 5% of account

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
    currentPrice: number,
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
    let confidence = 0.5; // Base confidence

    // RSI confidence
    const rsi = indicators.rsi14;
    if (direction === 'bullish') {
      if (rsi > 40 && rsi < 65) confidence += 0.2;
      else if (rsi < 30 || rsi > 80) confidence -= 0.2;
    } else {
      if (rsi > 35 && rsi < 60) confidence += 0.2;
      else if (rsi < 20 || rsi > 70) confidence -= 0.2;
    }

    // MACD confidence
    const macd = indicators.macd.macd;
    const macdSignal = indicators.macd.signal;
    if (direction === 'bullish' && macd > macdSignal) confidence += 0.15;
    else if (direction === 'bearish' && macd < macdSignal) confidence += 0.15;

    // Trend alignment
    if (
      (direction === 'bullish' && trend === 'bullish') ||
      (direction === 'bearish' && trend === 'bearish')
    ) {
      confidence += 0.1;
    }

    // Volatility adjustment
    if (volatility === 'medium') confidence += 0.05;
    else if (volatility === 'high') confidence -= 0.05;

    return Math.max(0.3, Math.min(0.95, confidence));
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

    if (rsi > 70) return 'RSI overbought, waiting for pullback';
    if (rsi < 30) return 'RSI oversold, waiting for bounce';
    if (Math.abs(macd - macdSignal) < 5) return 'MACD showing weak momentum';

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
      return rsi > 70 || macd < macdSignal;
    } else {
      return rsi < 30 || macd > macdSignal;
    }
  }
}

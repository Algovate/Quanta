/**
 * Enhanced Market Regime Detection
 * Comprehensive market regime analysis including volatility regimes
 */

import type { TechnicalIndicators, MarketData } from '../types/index.js';
import { UnifiedLogger } from '../logging/index.js';

export type VolatilityRegime = 'low' | 'medium' | 'high' | 'extreme';
export type MarketMicrostructure = 'maker_dominant' | 'taker_dominant' | 'balanced' | 'unknown';
export type TrendRegime =
  | 'strong_trending'
  | 'weak_trending'
  | 'ranging'
  | 'transitioning'
  | 'unknown';

export interface MarketRegime {
  trend: TrendRegime;
  volatility: VolatilityRegime;
  microstructure: MarketMicrostructure;
  confidence: number; // 0-1, confidence in regime classification
  indicators: {
    bollingerBandwidth: number;
    emaSpread: number;
    atrPercent: number;
    volumeRatio: number;
    macdMomentum: number;
  };
}

export interface RegimeTransition {
  from: MarketRegime;
  to: MarketRegime;
  confidence: number;
  warning: boolean; // True if transition is significant
}

/**
 * Enhanced Market Regime Analyzer
 * Detects market regimes with high accuracy
 */
export class MarketRegimeAnalyzer {
  private logger: UnifiedLogger;
  private readonly context = 'MarketRegime';
  private historicalRegimes: Map<string, MarketRegime[]> = new Map(); // Track regime history per symbol

  constructor() {
    this.logger = UnifiedLogger.getInstance();
  }

  /**
   * Analyze market regime from indicators
   */
  analyzeRegime(
    indicators: TechnicalIndicators,
    currentPrice: number,
    _marketData?: MarketData[]
  ): MarketRegime {
    const regime: MarketRegime = {
      trend: 'unknown',
      volatility: 'medium',
      microstructure: 'unknown',
      confidence: 0,
      indicators: {
        bollingerBandwidth: indicators.bollinger?.bandwidth || 0,
        emaSpread: 0,
        atrPercent: 0,
        volumeRatio: indicators.volume?.ratio || 1.0,
        macdMomentum: Math.abs(indicators.macd?.histogram || 0) / currentPrice,
      },
    };

    // Calculate EMA spread
    if (indicators.ema20 && indicators.ema50 && currentPrice > 0) {
      regime.indicators.emaSpread = Math.abs(indicators.ema20 - indicators.ema50) / currentPrice;
    }

    // Calculate ATR percentage
    if (indicators.atr14 && currentPrice > 0) {
      regime.indicators.atrPercent = indicators.atr14 / currentPrice;
    }

    // Detect trend regime
    regime.trend = this.detectTrendRegime(indicators, currentPrice);

    // Detect volatility regime
    regime.volatility = this.detectVolatilityRegime(indicators, currentPrice);

    // Detect market microstructure (simplified)
    regime.microstructure = this.detectMicrostructure(indicators);

    // Calculate confidence
    regime.confidence = this.calculateRegimeConfidence(regime);

    return regime;
  }

  /**
   * Detect trend regime
   */
  private detectTrendRegime(indicators: TechnicalIndicators, currentPrice: number): TrendRegime {
    let trendScore = 0;

    // Bollinger Bandwidth: narrow = ranging, wide = trending
    if (indicators.bollinger?.bandwidth !== undefined) {
      if (indicators.bollinger.bandwidth < 0.02) {
        trendScore -= 2; // Narrow = ranging
      } else if (indicators.bollinger.bandwidth > 0.04) {
        trendScore += 2; // Wide = trending
      }
    }

    // EMA alignment
    if (indicators.ema20 && indicators.ema50 && currentPrice > 0) {
      const emaSpread = Math.abs(indicators.ema20 - indicators.ema50) / currentPrice;
      if (emaSpread > 0.015) {
        trendScore += 2; // Strong separation = trending
      } else if (emaSpread < 0.005) {
        trendScore -= 2; // Tight = ranging
      }

      // Check EMA direction
      const isLong = currentPrice > indicators.ema20 && indicators.ema20 > indicators.ema50;
      const isShort = currentPrice < indicators.ema20 && indicators.ema20 < indicators.ema50;
      if (isLong || isShort) {
        trendScore += 1; // Clear direction
      }
    }

    // MACD momentum
    if (indicators.macd?.histogram !== undefined) {
      const macdStrength = Math.abs(indicators.macd.histogram) / currentPrice;
      if (macdStrength > 0.001) {
        trendScore += 1; // Strong momentum
      }
    }

    // Determine regime
    if (trendScore >= 4) {
      return 'strong_trending';
    } else if (trendScore >= 2) {
      return 'weak_trending';
    } else if (trendScore <= -2) {
      return 'ranging';
    } else if (Math.abs(trendScore) === 1) {
      return 'transitioning';
    }

    return 'unknown';
  }

  /**
   * Detect volatility regime
   */
  private detectVolatilityRegime(
    indicators: TechnicalIndicators,
    currentPrice: number
  ): VolatilityRegime {
    if (!indicators.atr14 || currentPrice <= 0) {
      return 'medium';
    }

    const atrPercent = indicators.atr14 / currentPrice;

    if (atrPercent >= 0.05) {
      return 'extreme'; // > 5% ATR
    } else if (atrPercent >= 0.03) {
      return 'high'; // 3-5% ATR
    } else if (atrPercent >= 0.01) {
      return 'medium'; // 1-3% ATR
    } else {
      return 'low'; // < 1% ATR
    }
  }

  /**
   * Detect market microstructure (simplified)
   */
  private detectMicrostructure(indicators: TechnicalIndicators): MarketMicrostructure {
    // Simplified: use volume and price action to infer microstructure
    // In production, would use order book data

    const volumeRatio = indicators.volume?.ratio || 1.0;

    // High volume with low volatility = maker dominant (liquidity provision)
    // High volume with high volatility = taker dominant (aggressive trading)

    if (
      volumeRatio > 1.5 &&
      indicators.bollinger?.bandwidth &&
      indicators.bollinger.bandwidth < 0.02
    ) {
      return 'maker_dominant'; // High volume, low volatility
    } else if (
      volumeRatio > 1.5 &&
      indicators.bollinger?.bandwidth &&
      indicators.bollinger.bandwidth > 0.04
    ) {
      return 'taker_dominant'; // High volume, high volatility
    } else if (volumeRatio > 0.8 && volumeRatio < 1.2) {
      return 'balanced'; // Normal volume
    }

    return 'unknown';
  }

  /**
   * Calculate confidence in regime classification
   */
  private calculateRegimeConfidence(regime: MarketRegime): number {
    let confidence = 0.5; // Base confidence

    // More indicators available = higher confidence
    const indicatorCount = [
      regime.indicators.bollingerBandwidth,
      regime.indicators.emaSpread,
      regime.indicators.atrPercent,
      regime.indicators.volumeRatio,
      regime.indicators.macdMomentum,
    ].filter(v => v > 0).length;

    confidence += (indicatorCount / 5) * 0.3; // Up to 30% boost from indicators

    // Clear regime signals = higher confidence
    if (regime.trend !== 'unknown' && regime.trend !== 'transitioning') {
      confidence += 0.1;
    }
    if (regime.volatility !== 'medium') {
      confidence += 0.05;
    }
    if (regime.microstructure !== 'unknown') {
      confidence += 0.05;
    }

    return Math.min(1.0, confidence);
  }

  /**
   * Detect regime transitions
   */
  detectTransition(symbol: string, currentRegime: MarketRegime): RegimeTransition | null {
    const history = this.historicalRegimes.get(symbol) || [];

    if (history.length === 0) {
      // First regime for this symbol
      this.historicalRegimes.set(symbol, [currentRegime]);
      return null;
    }

    const previousRegime = history[history.length - 1];

    // Check if regime changed
    const trendChanged = previousRegime.trend !== currentRegime.trend;
    const volatilityChanged = previousRegime.volatility !== currentRegime.volatility;
    const microstructureChanged = previousRegime.microstructure !== currentRegime.microstructure;

    if (!trendChanged && !volatilityChanged && !microstructureChanged) {
      // No change
      return null;
    }

    // Calculate transition confidence
    const changes = [trendChanged, volatilityChanged, microstructureChanged].filter(Boolean).length;
    const confidence = Math.min(1.0, currentRegime.confidence * (changes / 3));

    // Warning if multiple aspects changed or significant regime shift
    const warning =
      changes >= 2 ||
      (trendChanged &&
        (previousRegime.trend === 'strong_trending' ||
          currentRegime.trend === 'strong_trending')) ||
      (volatilityChanged &&
        (previousRegime.volatility === 'extreme' || currentRegime.volatility === 'extreme'));

    const transition: RegimeTransition = {
      from: previousRegime,
      to: currentRegime,
      confidence,
      warning,
    };

    // Update history
    history.push(currentRegime);
    if (history.length > 10) {
      history.shift(); // Keep last 10 regimes
    }
    this.historicalRegimes.set(symbol, history);

    if (warning) {
      this.logger.warn(
        `Market regime transition detected for ${symbol}`,
        {
          from: previousRegime.trend,
          to: currentRegime.trend,
          volatility: currentRegime.volatility,
          confidence,
        },
        this.context
      );
    }

    return transition;
  }

  /**
   * Get recommended position sizing adjustment based on regime
   */
  getRegimePositionSizingAdjustment(regime: MarketRegime): number {
    // Returns multiplier: 1.0 = no change, >1.0 = increase size, <1.0 = decrease size

    let multiplier = 1.0;

    // Trending markets: slightly increase size
    if (regime.trend === 'strong_trending') {
      multiplier = 1.2;
    } else if (regime.trend === 'weak_trending') {
      multiplier = 1.1;
    } else if (regime.trend === 'ranging') {
      multiplier = 0.8; // Reduce size in ranging markets
    }

    // Volatility adjustments
    if (regime.volatility === 'extreme') {
      multiplier *= 0.7; // Reduce size in extreme volatility
    } else if (regime.volatility === 'high') {
      multiplier *= 0.9;
    } else if (regime.volatility === 'low') {
      multiplier *= 1.1; // Can increase size in low volatility
    }

    return multiplier;
  }

  /**
   * Get recommended stop loss adjustment based on regime
   */
  getRegimeStopLossAdjustment(regime: MarketRegime): number {
    // Returns multiplier for stop loss distance

    let multiplier = 1.0;

    // Trending markets: wider stops
    if (regime.trend === 'strong_trending') {
      multiplier = 1.3;
    } else if (regime.trend === 'weak_trending') {
      multiplier = 1.1;
    } else if (regime.trend === 'ranging') {
      multiplier = 0.8; // Tighter stops in ranging
    }

    // Volatility adjustments
    if (regime.volatility === 'extreme') {
      multiplier *= 1.5; // Much wider stops
    } else if (regime.volatility === 'high') {
      multiplier *= 1.2;
    } else if (regime.volatility === 'low') {
      multiplier *= 0.9; // Tighter stops
    }

    return multiplier;
  }
}

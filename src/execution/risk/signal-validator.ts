/**
 * Signal validation logic for RiskManager
 * Extracted from RiskManager to improve modularity
 */

import { TradingSignal, Account, Position } from '../../exchange/types.js';
import { TechnicalIndicators } from '../../types/index.js';
import { SIGNAL_VALIDATION, POSITION_SIZING } from '../constants.js';
import { UnifiedLogger } from '../../logging/index.js';
import { SymbolPerformanceTracker } from '../symbol-performance.js';
import { PortfolioCorrelationAnalyzer } from '../portfolio-correlation.js';

export interface SignalValidationResult {
  valid: boolean;
  reason?: string;
}

export interface SignalQualityScore {
  score: number; // 0-1, higher is better
  factors: {
    indicatorConfluence: number; // 0-1, based on indicator alignment
    volumeConfirmation: number; // 0-1, based on volume confirmation
    trendStrength: number; // 0-1, based on trend strength
    multiTimeframeAlignment: number; // 0-1, based on multi-timeframe consistency
  };
  breakdown: string[]; // Detailed breakdown of scoring factors
}

/**
 * Validates trading signals for correctness and safety
 */
export class SignalValidator {
  private logger: UnifiedLogger;
  private readonly context = 'SignalValidator';
  private performanceTracker: SymbolPerformanceTracker;
  private correlationAnalyzer: PortfolioCorrelationAnalyzer;

  constructor(performanceTracker: SymbolPerformanceTracker) {
    this.logger = UnifiedLogger.getInstance();
    this.performanceTracker = performanceTracker;
    this.correlationAnalyzer = new PortfolioCorrelationAnalyzer();
  }

  validateSignal(
    signal: TradingSignal,
    _account: Account,
    currentPositions: Position[]
  ): SignalValidationResult {
    try {
      // Check signal format
      if (!signal.coin || !signal.action || !signal.confidence) {
        const missingFields: string[] = [];
        if (!signal.coin) missingFields.push('coin');
        if (!signal.action) missingFields.push('action');
        if (!signal.confidence) missingFields.push('confidence');

        const reason = `Missing required fields: ${missingFields.join(', ')}`;
        this.logger.warn(`Signal validation failed: ${reason}`, {}, this.context);
        return { valid: false, reason };
      }

      // Check confidence threshold with adaptive adjustment based on symbol performance
      const adaptiveThreshold = this.performanceTracker.getConfidenceThreshold(
        signal.coin,
        SIGNAL_VALIDATION.MIN_CONFIDENCE
      );
      if (adaptiveThreshold !== SIGNAL_VALIDATION.MIN_CONFIDENCE) {
        this.logger.debug(
          'Adaptive confidence threshold applied',
          {
            coin: signal.coin,
            default: (SIGNAL_VALIDATION.MIN_CONFIDENCE * 100).toFixed(1) + '%',
            adjusted: (adaptiveThreshold * 100).toFixed(1) + '%',
          },
          this.context
        );
      }

      // Check with epsilon tolerance for floating-point precision
      // (e.g., 0.54999999 should be accepted when threshold is 0.55)
      if (signal.confidence < adaptiveThreshold - SIGNAL_VALIDATION.CONFIDENCE_EPSILON) {
        const reason = `Confidence too low: ${(signal.confidence * 100).toFixed(1)}% < ${(adaptiveThreshold * 100).toFixed(1)}% required (adaptive threshold based on ${signal.coin} performance)`;
        // Log signal validation rejection
        this.logger.debug(
          `Signal validation rejected for ${signal.coin} ${signal.action}: ${reason}`,
          {},
          this.context
        );
        return { valid: false, reason };
      }

      // Check if we already have a position in this coin
      // Normalize symbol comparison (e.g., "BTC/USDT" vs "BTC")
      const positionSymbol = `${signal.coin}/USDT`;
      const existingPosition = currentPositions.find(p => p.symbol === positionSymbol);
      if (existingPosition && (signal.action === 'LONG' || signal.action === 'SHORT')) {
        const reason = `Position already exists for ${signal.coin} (${existingPosition.side} ${existingPosition.size} ${signal.coin})`;
        this.logger.debug(
          `Signal validation rejected for ${signal.coin} ${signal.action}: ${reason}`,
          {},
          this.context
        );
        return { valid: false, reason };
      }

      // Check stop loss validity
      if (
        signal.stop_loss &&
        (signal.stop_loss < SIGNAL_VALIDATION.MIN_STOP_LOSS ||
          signal.stop_loss > SIGNAL_VALIDATION.MAX_STOP_LOSS)
      ) {
        const reason = `Invalid stop loss: ${(signal.stop_loss * 100).toFixed(1)}% not in range ${(SIGNAL_VALIDATION.MIN_STOP_LOSS * 100).toFixed(1)}%-${(SIGNAL_VALIDATION.MAX_STOP_LOSS * 100).toFixed(1)}%`;
        this.logger.debug(
          `Signal validation rejected for ${signal.coin} ${signal.action}: ${reason}`,
          {},
          this.context
        );
        return { valid: false, reason };
      }

      // Check profit target validity
      if (
        signal.profit_target &&
        signal.stop_loss &&
        signal.profit_target < signal.stop_loss * SIGNAL_VALIDATION.MIN_RISK_REWARD_RATIO
      ) {
        const reason = `Invalid risk/reward ratio: ${(signal.profit_target / signal.stop_loss).toFixed(2)} < ${SIGNAL_VALIDATION.MIN_RISK_REWARD_RATIO} required`;
        this.logger.debug(
          `Signal validation rejected for ${signal.coin} ${signal.action}: ${reason}`,
          {},
          this.context
        );
        return { valid: false, reason };
      }

      // Enhanced correlation check using PortfolioCorrelationAnalyzer
      if (signal.action === 'LONG' || signal.action === 'SHORT') {
        const newSymbol = `${signal.coin}/USDT`;
        const newSide = signal.action === 'LONG' ? 'long' : 'short';

        // Check if adding this position would create excessive correlation
        const canAdd = this.correlationAnalyzer.canAddPosition(
          currentPositions,
          newSymbol,
          newSide,
          0.8 // Max correlation threshold
        );

        if (!canAdd) {
          const correlation = this.correlationAnalyzer.calculateCorrelation(currentPositions);
          const reason = `Position rejected: would create excessive correlation (max: ${correlation.maxCorrelation.toFixed(2)})`;
          this.logger.debug(
            `Signal validation rejected for ${signal.coin} ${signal.action}: ${reason}`,
            {
              newSymbol,
              newSide,
              existingPositions: currentPositions.length,
              maxCorrelation: correlation.maxCorrelation,
            },
            this.context
          );
          return { valid: false, reason };
        }

        // Legacy check: also prevent too many same-side positions as additional safeguard
        const targetSide = signal.action.toLowerCase() as 'long' | 'short';
        const sameSidePositions = currentPositions.filter(p => p.side === targetSide);
        if (sameSidePositions.length >= POSITION_SIZING.MAX_SAME_SIDE_POSITIONS) {
          const reason = `Too many ${targetSide} positions (${sameSidePositions.length} >= ${POSITION_SIZING.MAX_SAME_SIDE_POSITIONS}), rejecting to reduce correlation`;
          this.logger.debug(
            `Signal validation rejected for ${signal.coin} ${signal.action}: ${reason}`,
            {},
            this.context
          );
          return { valid: false, reason };
        }
      }

      return { valid: true };
    } catch (error) {
      const reason = `Validation error: ${error instanceof Error ? error.message : 'Unknown error'}`;
      this.logger.error(
        'Error validating signal',
        error instanceof Error ? error : new Error(String(error)),
        this.context
      );
      return { valid: false, reason };
    }
  }

  /**
   * Calculate signal quality score based on multiple factors
   * @param signal - Trading signal to score
   * @param indicators - Technical indicators for the coin
   * @param marketData - Market data for multi-timeframe analysis
   * @returns Signal quality score (0-1, higher is better)
   */
  calculateSignalQuality(
    signal: TradingSignal,
    indicators?: TechnicalIndicators,
    marketData?: Array<{ timeframe: string; trend: string; indicators?: TechnicalIndicators }>
  ): SignalQualityScore {
    const factors = {
      indicatorConfluence: 0,
      volumeConfirmation: 0,
      trendStrength: 0,
      multiTimeframeAlignment: 0,
    };
    const breakdown: string[] = [];

    if (!indicators) {
      return {
        score: 0.5, // Default neutral score if no indicators
        factors,
        breakdown: ['No indicators available'],
      };
    }

    const isLong = signal.action === 'LONG';
    const isShort = signal.action === 'SHORT';

    // Factor 1: Indicator Confluence (0-1)
    let indicatorScore = 0;
    let indicatorCount = 0;

    // EMA alignment
    if (indicators.ema20 && indicators.ema50) {
      const emaBullish = indicators.ema20 > indicators.ema50;
      const emaBearish = indicators.ema20 < indicators.ema50;

      if ((isLong && emaBullish) || (isShort && emaBearish)) {
        indicatorScore += 0.2;
        breakdown.push('EMA alignment confirms direction');
      } else if ((isLong && emaBearish) || (isShort && emaBullish)) {
        indicatorScore -= 0.1;
        breakdown.push('EMA alignment conflicts with signal');
      }
      indicatorCount++;
    }

    // MACD
    if (indicators.macd) {
      const macdBullish =
        indicators.macd.macd > indicators.macd.signal && indicators.macd.histogram > 0;
      const macdBearish =
        indicators.macd.macd < indicators.macd.signal && indicators.macd.histogram < 0;

      if ((isLong && macdBullish) || (isShort && macdBearish)) {
        indicatorScore += 0.2;
        breakdown.push('MACD confirms direction');
      } else if ((isLong && macdBearish) || (isShort && macdBullish)) {
        indicatorScore -= 0.1;
        breakdown.push('MACD conflicts with signal');
      }
      indicatorCount++;
    }

    // RSI
    if (indicators.rsi14) {
      const rsiOverbought = indicators.rsi14 > 70;
      const rsiOversold = indicators.rsi14 < 30;

      if ((isLong && rsiOversold) || (isShort && rsiOverbought)) {
        indicatorScore += 0.15;
        breakdown.push('RSI supports entry');
      } else if ((isLong && rsiOverbought) || (isShort && rsiOversold)) {
        indicatorScore -= 0.15;
        breakdown.push('RSI indicates extreme zone');
      }
      indicatorCount++;
    }

    // Bollinger Bands
    if (indicators.bollinger) {
      const { position } = indicators.bollinger;

      if (
        (isLong && (position === 'below' || position === 'lower')) ||
        (isShort && (position === 'above' || position === 'upper'))
      ) {
        indicatorScore += 0.15;
        breakdown.push('Price near Bollinger Band edge');
      } else if ((isLong && position === 'above') || (isShort && position === 'below')) {
        indicatorScore -= 0.1;
        breakdown.push('Price at opposite Bollinger Band');
      }
      indicatorCount++;
    }

    factors.indicatorConfluence = Math.max(
      0,
      Math.min(1, indicatorScore / Math.max(1, indicatorCount))
    );

    // Factor 2: Volume Confirmation (0-1)
    if (indicators.volume) {
      const volumeRatio = indicators.volume.ratio;
      if (volumeRatio > 1.2) {
        factors.volumeConfirmation = 0.9;
        breakdown.push(`Strong volume confirmation (${volumeRatio.toFixed(2)}x)`);
      } else if (volumeRatio > 1.0) {
        factors.volumeConfirmation = 0.7;
        breakdown.push(`Moderate volume confirmation (${volumeRatio.toFixed(2)}x)`);
      } else if (volumeRatio > 0.8) {
        factors.volumeConfirmation = 0.5;
        breakdown.push(`Neutral volume (${volumeRatio.toFixed(2)}x)`);
      } else {
        factors.volumeConfirmation = 0.3;
        breakdown.push(`Weak volume (${volumeRatio.toFixed(2)}x)`);
      }
    } else {
      factors.volumeConfirmation = 0.5; // Neutral if no volume data
      breakdown.push('No volume data available');
    }

    // Factor 3: Trend Strength (0-1)
    if (indicators.ema20 && indicators.ema50) {
      const emaSpread = Math.abs(indicators.ema20 - indicators.ema50) / indicators.ema20;
      const trendStrength = Math.min(1, emaSpread * 100); // Scale to 0-1

      if (trendStrength > 0.02) {
        factors.trendStrength = 0.9;
        breakdown.push('Strong trend detected');
      } else if (trendStrength > 0.01) {
        factors.trendStrength = 0.7;
        breakdown.push('Moderate trend detected');
      } else {
        factors.trendStrength = 0.5;
        breakdown.push('Weak or ranging trend');
      }
    } else {
      factors.trendStrength = 0.5;
      breakdown.push('No trend data available');
    }

    // Factor 4: Multi-Timeframe Alignment (0-1)
    if (marketData && marketData.length > 1) {
      const trends = marketData.map(md => md.trend);
      const bullishCount = trends.filter(t => t === 'bullish').length;
      const bearishCount = trends.filter(t => t === 'bearish').length;
      const totalTrends = trends.length;

      if (isLong) {
        const alignment = bullishCount / totalTrends;
        factors.multiTimeframeAlignment = alignment;
        breakdown.push(`Multi-timeframe: ${bullishCount}/${totalTrends} bullish`);
      } else if (isShort) {
        const alignment = bearishCount / totalTrends;
        factors.multiTimeframeAlignment = alignment;
        breakdown.push(`Multi-timeframe: ${bearishCount}/${totalTrends} bearish`);
      } else {
        factors.multiTimeframeAlignment = 0.5;
        breakdown.push('Multi-timeframe: neutral (HOLD/CLOSE)');
      }
    } else {
      factors.multiTimeframeAlignment = 0.5;
      breakdown.push('No multi-timeframe data available');
    }

    // Calculate weighted overall score
    const weights = {
      indicatorConfluence: 0.35,
      volumeConfirmation: 0.25,
      trendStrength: 0.2,
      multiTimeframeAlignment: 0.2,
    };

    const overallScore =
      factors.indicatorConfluence * weights.indicatorConfluence +
      factors.volumeConfirmation * weights.volumeConfirmation +
      factors.trendStrength * weights.trendStrength +
      factors.multiTimeframeAlignment * weights.multiTimeframeAlignment;

    return {
      score: Math.max(0, Math.min(1, overallScore)),
      factors,
      breakdown,
    };
  }
}

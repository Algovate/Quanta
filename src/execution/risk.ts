import { Account, Position, TradingSignal } from '../exchange/types.js';
import { TechnicalIndicators } from '../types/index.js';
import {
  POSITION_SIZING,
  ORDER_EXECUTION,
  ACCOUNT_VALIDATION,
  POSITION_MONITORING,
} from './constants.js';
import { aggregatePositionMetrics } from './position-utils.js';
import { UnifiedLogger } from '../logging/index.js';
import {
  safeMultiply,
  safeDivide,
  safeSubtract,
  safeAdd,
  safePercentage,
  roundToPrecision,
  getSymbolPrecision,
  EXCHANGE_PRECISION,
} from '../utils/precision.js';
import { calculatePositionPnl } from '../utils/symbol-utils.js';
import { SymbolPerformanceTracker } from './symbol-performance.js';
import { SignalValidator } from './risk/signal-validator.js';
import { KellyCriterionCalculator } from './kelly-criterion.js';
import { MarketRegimeAnalyzer } from '../analytics/market-regime.js';

export interface RiskParams {
  maxRiskPerTrade: number; // 0.05 = 5%
  maxTotalRisk: number; // 0.30 = 30%
  maxPositions: number;
  defaultStopLoss: number; // 0.03 = 3%
  maxLeverage: number;
  minLeverage: number;
}

export interface PositionSizing {
  coin: string;
  suggestedSize: number;
  maxSize: number;
  riskAmount: number;
  stopLossPrice: number;
  leverage: number;
}

export class RiskManager {
  private params: RiskParams;
  private logger: UnifiedLogger;
  private readonly context = 'RiskManager';
  private performanceTracker: SymbolPerformanceTracker;
  private signalValidator: SignalValidator;
  private kellyCalculator: KellyCriterionCalculator;
  private marketRegimeAnalyzer: MarketRegimeAnalyzer;

  constructor(params: RiskParams) {
    this.params = params;
    this.logger = UnifiedLogger.getInstance();
    this.performanceTracker = new SymbolPerformanceTracker(50); // Track last 50 trades per symbol
    this.signalValidator = new SignalValidator(this.performanceTracker);
    this.kellyCalculator = new KellyCriterionCalculator(this.performanceTracker);
    this.marketRegimeAnalyzer = new MarketRegimeAnalyzer();
  }

  /**
   * Get signal validator instance
   * Used for signal quality scoring
   */
  getSignalValidator(): SignalValidator {
    return this.signalValidator;
  }

  /**
   * Get market regime analyzer instance
   * Used for regime-based position sizing adjustments
   */
  getMarketRegimeAnalyzer(): MarketRegimeAnalyzer {
    return this.marketRegimeAnalyzer;
  }

  /**
   * Update performance tracker with completed trades
   * Call this periodically to keep stats current
   */
  updatePerformanceStats(completedTrades: import('../types/index.js').CompletedTrade[]): void {
    this.performanceTracker.updateStats(completedTrades);
  }

  // --- Portfolio Exposure & Leverage Helpers ---
  /** Sum of absolute unlevered position values (size * markPrice). */
  /** Matches aggregates.totalNotional for portfolio leverage calculations. */
  computeExposure(positions: Position[]): number {
    if (!positions?.length) return 0;
    // Use unlevered exposure (size * markPrice) for portfolio metrics, matches aggregates.totalNotional
    // Only include positions with valid markPrice (skip positions with invalid prices)
    const total = positions.reduce((sum, p) => {
      // Validate markPrice before including in exposure calculation
      if (p.markPrice > 0 && isFinite(p.markPrice)) {
        return sum + Math.abs(p.size * p.markPrice);
      }
      // Skip positions with invalid markPrice (shouldn't happen, but handle gracefully)
      return sum;
    }, 0);
    return roundToPrecision(total, EXCHANGE_PRECISION.USDT);
  }

  /** Portfolio leverage = exposure / equity (guarding against zero). */
  computeLeverage(equity: number, exposure: number): number {
    if (!isFinite(equity) || equity <= 0) return 0;
    const lv = safeDivide(exposure, equity, EXCHANGE_PRECISION.USDT).toNumber();
    return roundToPrecision(lv, 2);
  }

  /** Mark-based unrealized P&L helper. */
  computeUnrealized(position: Position, markPrice: number): number {
    return calculatePositionPnl(
      position.side,
      markPrice,
      position.entryPrice,
      position.size,
      position.symbol
    );
  }

  /** P&L percent based on chosen basis (default: margin). */
  computePnlPercent(
    position: Position,
    markPrice: number,
    basis: 'margin' | 'notional' = 'margin'
  ): number {
    const unreal = this.computeUnrealized(position, markPrice);
    const notional = Math.abs(position.size * position.entryPrice);
    const margin = position.marginUsed || (position.leverage ? notional / position.leverage : 0);
    const denom = basis === 'margin' ? margin : notional;
    if (!denom) return 0;
    const pct = safeMultiply(safeDivide(unreal, denom, 6), 100).toNumber();
    return roundToPrecision(pct, 2);
  }

  // --- Maintenance Margin and Liquidation Checks ---
  /** Margins config; rates as decimals (e.g., 0.01 = 1%). */
  checkMaintenance(
    position: Position,
    markPrice: number,
    rates?: {
      initialMarginRate?: number;
      maintenanceMarginRate?: number;
      takerFeeRate?: number;
      maintenanceBuffer?: number; // Buffer to prevent early liquidation (e.g., 0.1 = 10%)
    }
  ): {
    shouldLiquidate: boolean;
    marginRatio: number;
    equityOnPosition: number;
    maintenanceMargin: number;
    initialMargin: number;
    liquidationPrice: number;
  } {
    const notional = Math.abs(position.size * markPrice);
    const leverage = Math.max(1, position.leverage || 1);
    const defaultIMR = 1 / leverage; // simple proxy when no table available
    const imr = rates?.initialMarginRate ?? defaultIMR;
    const takerFee = rates?.takerFeeRate ?? 0.0005; // 5 bps default
    const maintenanceBuffer = rates?.maintenanceBuffer ?? 0.1; // 10% buffer by default

    // Tiered maintenance margin rate based on notional (for BTC/USDT and similar)
    // Lower notional = lower rate, higher notional = higher rate
    let mmr: number;
    if (rates?.maintenanceMarginRate !== undefined) {
      mmr = rates.maintenanceMarginRate;
    } else {
      // Tiered rates based on notional (matches typical exchange tiers)
      if (notional < 5000) {
        mmr = Math.min(imr * 0.4, 0.015); // 1.5% for small positions
      } else if (notional < 50000) {
        mmr = Math.min(imr * 0.5, 0.02); // 2% for medium positions
      } else if (notional < 200000) {
        mmr = Math.min(imr * 0.6, 0.025); // 2.5% for large positions
      } else {
        mmr = Math.min(imr * 0.7, 0.03); // 3% for very large positions
      }
    }

    // Apply maintenance buffer to prevent early liquidation
    // Buffer increases the effective maintenance margin requirement
    const effectiveMMR = mmr * (1 + maintenanceBuffer);

    const entryNotional = Math.abs(position.size * position.entryPrice);
    const initialMargin = position.marginUsed || entryNotional / leverage;
    const unreal = this.computeUnrealized(position, markPrice);
    const feesBuffer = notional * takerFee; // simple fees buffer
    const equityOnPosition = initialMargin + unreal - feesBuffer;
    const maintenanceMargin = notional * effectiveMMR;

    // Calculate liquidation price (price at which equityOnPosition = maintenanceMargin)
    // For long: liquidationPrice = entryPrice - (initialMargin - maintenanceMargin) / size
    // For short: liquidationPrice = entryPrice + (initialMargin - maintenanceMargin) / size
    let liquidationPrice: number;
    if (position.side === 'long') {
      liquidationPrice =
        position.entryPrice - (initialMargin - maintenanceMargin) / Math.abs(position.size);
    } else {
      liquidationPrice =
        position.entryPrice + (initialMargin - maintenanceMargin) / Math.abs(position.size);
    }

    const marginRatio = maintenanceMargin > 0 ? equityOnPosition / maintenanceMargin : Infinity;
    const shouldLiquidate = equityOnPosition <= maintenanceMargin;

    return {
      shouldLiquidate,
      marginRatio: roundToPrecision(marginRatio, 4),
      equityOnPosition: roundToPrecision(equityOnPosition, EXCHANGE_PRECISION.USDT),
      maintenanceMargin: roundToPrecision(maintenanceMargin, EXCHANGE_PRECISION.USDT),
      initialMargin: roundToPrecision(initialMargin, EXCHANGE_PRECISION.USDT),
      liquidationPrice: roundToPrecision(liquidationPrice, EXCHANGE_PRECISION.USDT),
    };
  }

  calculatePositionSizing(
    signal: TradingSignal,
    account: Account,
    currentPositions: Position[],
    currentPrice: number,
    atr14?: number,
    indicators?: TechnicalIndicators,
    drawdownState?: 'normal' | 'reduced' | 'paused',
    peakEquity?: number
  ): PositionSizing | null {
    try {
      // Validate inputs
      if (account.equity <= ACCOUNT_VALIDATION.MIN_EQUITY) {
        this.logger.warn('Account equity too low for trading', {
          equity: account.equity,
          minimum: ACCOUNT_VALIDATION.MIN_EQUITY,
        });
        return null;
      }

      if (currentPrice <= ACCOUNT_VALIDATION.MIN_VALID_PRICE) {
        this.logger.error(
          'Invalid current price',
          new Error(`Current price ${currentPrice} for ${signal.coin} is invalid`),
          this.context
        );
        return null;
      }

      if (signal.entry_price && signal.entry_price <= ACCOUNT_VALIDATION.MIN_VALID_PRICE) {
        this.logger.error(
          'Invalid entry price in signal',
          new Error(`Entry price ${signal.entry_price} for ${signal.coin} is invalid`),
          this.context
        );
        return null;
      }

      // Check if we can open new positions
      if (currentPositions.length >= this.params.maxPositions) {
        this.logger.debug(
          'Position sizing rejected: maximum positions limit reached',
          {
            coin: signal.coin,
            currentPositions: currentPositions.length,
            maxPositions: this.params.maxPositions,
            reason: 'max_positions_reached',
          },
          this.context
        );
        return null;
      }

      // Check total margin usage to prevent over-leveraging using optimized aggregation
      const aggregates = aggregatePositionMetrics(currentPositions);
      const currentMarginUsage = safeDivide(
        aggregates.totalMarginUsed,
        account.equity,
        6
      ).toNumber();
      if (currentMarginUsage >= this.params.maxTotalRisk) {
        this.logger.debug(
          'Position sizing rejected: margin limit reached',
          {
            coin: signal.coin,
            currentMarginUsage,
            maxTotalRisk: this.params.maxTotalRisk,
            totalMarginUsed: aggregates.totalMarginUsed,
            accountEquity: account.equity,
            reason: 'margin_limit_reached',
          },
          this.context
        );
        return null;
      }

      // Calculate position size based on risk using precision-safe arithmetic
      const entryPrice = signal.entry_price || currentPrice;
      const stopLoss = signal.stop_loss || this.params.defaultStopLoss;
      const riskAmount = safePercentage(account.equity, this.params.maxRiskPerTrade).toNumber(); // Maximum $ loss

      // Enhanced market regime detection for adaptive stop loss and position sizing
      let regime: 'trending' | 'ranging' | 'unknown' = 'unknown';
      let regimeMultiplier = 1.0;

      if (indicators && entryPrice > 0) {
        // Use enhanced regime analyzer
        const marketRegime = this.marketRegimeAnalyzer.analyzeRegime(indicators, entryPrice);
        regime =
          marketRegime.trend === 'strong_trending' || marketRegime.trend === 'weak_trending'
            ? 'trending'
            : marketRegime.trend === 'ranging'
              ? 'ranging'
              : 'unknown';

        // Get regime-based adjustments
        regimeMultiplier =
          this.marketRegimeAnalyzer.getRegimePositionSizingAdjustment(marketRegime);

        // Detect regime transitions
        const symbol = `${signal.coin}/USDT`;
        const transition = this.marketRegimeAnalyzer.detectTransition(symbol, marketRegime);
        if (transition?.warning) {
          this.logger.warn(
            `Market regime transition detected for ${signal.coin}`,
            {
              from: transition.from.trend,
              to: transition.to.trend,
              volatility: transition.to.volatility,
              confidence: transition.confidence,
            },
            this.context
          );
        }

        if (regime !== 'unknown') {
          this.logger.debug(
            'Market regime detected',
            {
              coin: signal.coin,
              regime,
              trend: marketRegime.trend,
              volatility: marketRegime.volatility,
              microstructure: marketRegime.microstructure,
              confidence: marketRegime.confidence,
              regimeMultiplier: regimeMultiplier.toFixed(2),
            },
            this.context
          );
        }
      }

      // Calculate ATR-based stop loss if ATR is available
      let atrBasedStopLoss: number | undefined;
      if (atr14 && atr14 > 0 && entryPrice > 0) {
        // Dynamic ATR multiplier based on volatility
        // Higher volatility = wider stops, but with adaptive multiplier
        const atrPercent = safeDivide(atr14, entryPrice, 6).toNumber();
        let atrMultiplier: number = POSITION_SIZING.ATR_STOP_LOSS_MULTIPLIER;

        // Adjust multiplier based on volatility level
        if (atrPercent > POSITION_SIZING.HIGH_VOLATILITY_THRESHOLD) {
          // High volatility: use wider stops
          atrMultiplier = POSITION_SIZING.ATR_MULTIPLIER_HIGH_VOLATILITY;
        } else if (atrPercent < POSITION_SIZING.LOW_VOLATILITY_THRESHOLD) {
          // Low volatility: use tighter stops
          atrMultiplier = POSITION_SIZING.ATR_MULTIPLIER_LOW_VOLATILITY;
        }

        const atrStopDistance = safeMultiply(atr14, atrMultiplier).toNumber();
        atrBasedStopLoss = safeDivide(atrStopDistance, entryPrice, 6).toNumber();

        // In trending markets, use wider stops; in ranging, use tighter
        const originalStop = atrBasedStopLoss;
        if (regime === 'trending' && atrBasedStopLoss) {
          atrBasedStopLoss = safeMultiply(
            atrBasedStopLoss,
            POSITION_SIZING.TRENDING_STOP_MULTIPLIER
          ).toNumber();
          this.logger.debug(
            'Trending regime: widening stop loss',
            {
              coin: signal.coin,
              original: (originalStop * 100).toFixed(2) + '%',
              adjusted: (atrBasedStopLoss * 100).toFixed(2) + '%',
            },
            this.context
          );
        } else if (regime === 'ranging' && atrBasedStopLoss) {
          atrBasedStopLoss = safeMultiply(
            atrBasedStopLoss,
            POSITION_SIZING.RANGING_STOP_MULTIPLIER
          ).toNumber();
          this.logger.debug(
            'Ranging regime: tightening stop loss',
            {
              coin: signal.coin,
              original: (originalStop * 100).toFixed(2) + '%',
              adjusted: (atrBasedStopLoss * 100).toFixed(2) + '%',
            },
            this.context
          );
        }
      }

      // Calculate support/resistance-based stop loss if available
      let supportResistanceStopLoss: number | undefined;
      if (indicators?.supportResistance) {
        const { support, resistance } = indicators.supportResistance;
        const isLong = signal.action === 'LONG';

        if (isLong && support !== null && support > 0) {
          // For long positions, place stop below support
          const supportStopPrice = support * 0.995; // 0.5% below support for safety
          const supportStopPercent = safeDivide(
            safeSubtract(entryPrice, supportStopPrice).toNumber(),
            entryPrice,
            6
          ).toNumber();

          if (supportStopPercent > 0 && supportStopPercent < 0.1) {
            supportResistanceStopLoss = supportStopPercent;
            this.logger.debug(
              'Support-based stop loss calculated',
              {
                coin: signal.coin,
                support: support.toFixed(2),
                stopPrice: supportStopPrice.toFixed(2),
                stopPercent: (supportResistanceStopLoss * 100).toFixed(2) + '%',
              },
              this.context
            );
          }
        } else if (!isLong && resistance !== null && resistance > 0) {
          // For short positions, place stop above resistance
          const resistanceStopPrice = resistance * 1.005; // 0.5% above resistance for safety
          const resistanceStopPercent = safeDivide(
            safeSubtract(resistanceStopPrice, entryPrice).toNumber(),
            entryPrice,
            6
          ).toNumber();

          if (resistanceStopPercent > 0 && resistanceStopPercent < 0.1) {
            supportResistanceStopLoss = resistanceStopPercent;
            this.logger.debug(
              'Resistance-based stop loss calculated',
              {
                coin: signal.coin,
                resistance: resistance.toFixed(2),
                stopPrice: resistanceStopPrice.toFixed(2),
                stopPercent: (supportResistanceStopLoss * 100).toFixed(2) + '%',
              },
              this.context
            );
          }
        }
      }

      // Calculate price risk with precision
      const priceDiff = safeSubtract(currentPrice, entryPrice).toNumber();
      const priceRisk = safeDivide(Math.abs(priceDiff), currentPrice, 6).toNumber();

      // Use the largest of: signal stop loss, price risk, ATR-based stop loss, or support/resistance stop loss
      let actualStopLoss = Math.max(stopLoss, priceRisk);
      if (atrBasedStopLoss) {
        actualStopLoss = Math.max(actualStopLoss, atrBasedStopLoss);
      }
      if (supportResistanceStopLoss) {
        // Prefer support/resistance stop if it's reasonable (not too wide)
        if (supportResistanceStopLoss < actualStopLoss * 1.5) {
          actualStopLoss = Math.max(actualStopLoss, supportResistanceStopLoss);
        }
      }

      // Enforce minimum stop loss to prevent division issues and unrealistic position sizes
      if (actualStopLoss < POSITION_SIZING.MIN_STOP_LOSS_THRESHOLD) {
        this.logger.warn(
          'Stop loss too small, using minimum threshold',
          {
            original: actualStopLoss,
            minimum: POSITION_SIZING.MIN_STOP_LOSS_THRESHOLD,
            coin: signal.coin,
          },
          this.context
        );
        actualStopLoss = POSITION_SIZING.MIN_STOP_LOSS_THRESHOLD;
      }

      // Volatility scaling: reduce position size if ATR% exceeds threshold
      let volatilityScale = 1.0;
      if (atr14 && entryPrice > 0) {
        const atrPercent = safeDivide(atr14, entryPrice, 6).toNumber();
        if (atrPercent > POSITION_SIZING.MAX_ATR_PERCENT_OF_PRICE) {
          // Scale down position size proportionally to excessive volatility
          volatilityScale = safeDivide(
            POSITION_SIZING.MAX_ATR_PERCENT_OF_PRICE,
            atrPercent,
            6
          ).toNumber();
          this.logger.info(
            'Volatility scaling applied',
            {
              coin: signal.coin,
              atrPercent: (atrPercent * 100).toFixed(2) + '%',
              maxAllowed: (POSITION_SIZING.MAX_ATR_PERCENT_OF_PRICE * 100).toFixed(2) + '%',
              scale: (volatilityScale * 100).toFixed(1) + '%',
            },
            this.context
          );
        }
      }

      // Step 1: Calculate position value based on risk using precision-safe division
      // We want: max $ loss = position value × stop loss %
      // Therefore: position value = max $ loss / stop loss %
      const pricePerUnit = signal.entry_price || currentPrice;
      let riskBasedPositionValue = safeDivide(
        riskAmount,
        actualStopLoss,
        EXCHANGE_PRECISION.USDT
      ).toNumber();

      // Apply volatility scaling
      riskBasedPositionValue = safeMultiply(riskBasedPositionValue, volatilityScale).toNumber();

      // Apply regime-based position sizing adjustment
      if (regimeMultiplier !== 1.0) {
        const beforeRegime = riskBasedPositionValue;
        riskBasedPositionValue = safeMultiply(riskBasedPositionValue, regimeMultiplier).toNumber();
        this.logger.debug(
          'Regime-based position sizing adjustment applied',
          {
            coin: signal.coin,
            regime,
            regimeMultiplier: regimeMultiplier.toFixed(2),
            beforeRegime: beforeRegime.toFixed(2),
            afterRegime: riskBasedPositionValue.toFixed(2),
          },
          this.context
        );
      }

      // Step 2: Limit position size to avoid over-leveraging using precision-safe arithmetic
      // Use max 30% of available capital per trade to ensure we can open multiple positions
      // But ensure we leave at least 40% available for other trades
      const reservePercent = safeSubtract(1, POSITION_SIZING.MIN_RESERVE_PERCENT, 6).toNumber();
      const availableForTrade = safeMultiply(account.availableMargin, reservePercent).toNumber();
      const maxCapitalBasedValue = safePercentage(
        availableForTrade,
        POSITION_SIZING.MAX_CAPITAL_PERCENT
      ).toNumber();

      // Step 3: Apply utilization factor based on number of open positions
      // Scale position size inversely with position count to maintain diversification
      // Use a more gradual scaling with a minimum floor
      const positionRatio = safeDivide(
        currentPositions.length,
        this.params.maxPositions,
        6
      ).toNumber();
      const utilizationReduction = safeMultiply(positionRatio, 0.7).toNumber();
      const utilizationFactor = Math.max(
        POSITION_SIZING.MIN_UTILIZATION_FACTOR,
        safeSubtract(1, utilizationReduction, 6).toNumber()
      );
      // Factor ranges from 1.0 (no positions) down to 0.3 (at max positions)
      const smallerValue = Math.min(maxCapitalBasedValue, riskBasedPositionValue);
      const positionValueWithUtil = safeMultiply(
        smallerValue,
        utilizationFactor,
        EXCHANGE_PRECISION.USDT
      ).toNumber();

      // Ensure minimum position value (1% of account or $200, whichever is higher) using precision
      // This scales with account size and prevents tiny positions
      const minPositionValueFromPercent = safePercentage(
        account.equity,
        POSITION_SIZING.MIN_POSITION_PERCENT
      ).toNumber();
      const minPositionValue = Math.max(
        POSITION_SIZING.MIN_POSITION_VALUE_USD,
        minPositionValueFromPercent
      );
      const adjustedPositionValue = Math.max(minPositionValue, positionValueWithUtil);

      // Step 4: Apply drawdown protection multiplier to position size
      let drawdownMultiplier = 1.0;
      if (drawdownState && drawdownState !== 'normal') {
        drawdownMultiplier = this.getDrawdownPositionSizeMultiplier(
          drawdownState,
          account.equity,
          peakEquity
        );

        if (drawdownMultiplier <= 0) {
          // Trading paused due to drawdown
          this.logger.debug(
            'Position sizing rejected: trading paused due to drawdown',
            {
              coin: signal.coin,
              drawdownState,
              currentEquity: account.equity,
              peakEquity,
            },
            this.context
          );
          return null;
        }

        this.logger.debug(
          'Drawdown protection applied to position sizing',
          {
            coin: signal.coin,
            drawdownState,
            multiplier: (drawdownMultiplier * 100).toFixed(1) + '%',
          },
          this.context
        );
      }

      // Step 5: Calculate position size in units using precision-safe division
      // Safety check: ensure position doesn't exceed maximum size cap
      const maxPositionValue = safePercentage(
        account.equity,
        POSITION_SIZING.MAX_POSITION_SIZE_PERCENT
      ).toNumber();
      const cappedPositionValue = Math.min(adjustedPositionValue, maxPositionValue);

      // Apply drawdown multiplier to position size
      let drawdownAdjustedValue = safeMultiply(cappedPositionValue, drawdownMultiplier).toNumber();

      // Step 5.5: Apply Kelly Criterion multiplier if available
      const symbol = `${signal.coin}/USDT`;
      const kellyMultiplier = this.kellyCalculator.getPositionSizeMultiplier(symbol);
      if (kellyMultiplier !== 1.0) {
        const beforeKelly = drawdownAdjustedValue;
        drawdownAdjustedValue = safeMultiply(drawdownAdjustedValue, kellyMultiplier).toNumber();
        this.logger.debug(
          'Kelly Criterion applied to position sizing',
          {
            coin: signal.coin,
            kellyMultiplier: kellyMultiplier.toFixed(2),
            beforeKelly: beforeKelly.toFixed(2),
            afterKelly: drawdownAdjustedValue.toFixed(2),
          },
          this.context
        );
      }

      const cappedSize = safeDivide(drawdownAdjustedValue, pricePerUnit, 8).toNumber();

      // Step 6: Determine dynamic leverage based on confidence and risk
      const leverage = this.calculateDynamicLeverage(
        signal,
        account,
        aggregates.totalMarginUsed,
        currentPositions.length
      );

      // Calculate stop loss price using precision-safe arithmetic
      let stopLossMultiplier: number;
      if (signal.action === 'LONG') {
        stopLossMultiplier = safeSubtract(1, actualStopLoss, 6).toNumber();
      } else {
        stopLossMultiplier = safeAdd(1, actualStopLoss, 6).toNumber();
      }
      const stopLossPrice = roundToPrecision(
        safeMultiply(pricePerUnit, stopLossMultiplier).toNumber(),
        getSymbolPrecision(`${signal.coin}/USDT`)
      );

      // Final validation
      if (!isFinite(cappedSize)) {
        // Only treat non有限/NaN为异常，输出error并带上下文
        this.logger.error(
          'Invalid position size calculated (non-finite)',
          new Error(
            `Position size calculation failed for ${signal.coin}: cappedSize=${cappedSize}, adjustedPositionValue=${adjustedPositionValue}, pricePerUnit=${pricePerUnit}`
          ),
          this.context
        );
        return null;
      }
      if (cappedSize <= 0) {
        // 正常风控拒绝或多重约束压缩为0，静默返回即可（由上层做聚合统计）
        return null;
      }

      return {
        coin: signal.coin,
        suggestedSize: cappedSize, // Size in units (coins), NOT leveraged
        maxSize: cappedSize,
        riskAmount,
        stopLossPrice,
        leverage, // This is for reference, actual leverage applied by exchange
      };
    } catch (error) {
      this.logger.error(
        'Error calculating position sizing',
        error instanceof Error ? error : new Error(String(error)),
        this.context
      );
      return null;
    }
  }

  /**
   * Calculate dynamic leverage based on signal confidence, account risk, and position count
   * Uses additive adjustments instead of multiplicative to avoid compounding errors
   */
  private calculateDynamicLeverage(
    signal: TradingSignal,
    account: Account,
    totalMarginUsed: number,
    positionCount: number
  ): number {
    // Validate inputs
    if (account.equity <= 0) {
      this.logger.error(
        'Invalid equity for leverage calculation',
        new Error(`Equity ${account.equity} is invalid`),
        this.context
      );
      return this.params.minLeverage;
    }

    // Start with base leverage using precision-safe arithmetic
    const leverageRange = safeSubtract(this.params.maxLeverage, this.params.minLeverage).toNumber();
    let leverage = safeAdd(this.params.minLeverage, 0).toNumber();

    // Factor 1: Signal confidence boost (additive) using precision
    // Scale confidence from 0.55-1.0 to 0-1 range
    const confidenceDiff = safeSubtract(signal.confidence, 0.55).toNumber();
    const confidenceRange = safeSubtract(1.0, 0.55).toNumber();
    const confidenceBoost = Math.max(0, safeDivide(confidenceDiff, confidenceRange, 6).toNumber());
    const confidenceAdjustment = safeMultiply(
      leverageRange,
      safeMultiply(confidenceBoost, 0.5)
    ).toNumber();
    leverage = safeAdd(leverage, confidenceAdjustment).toNumber();

    // Factor 2: Margin usage penalty (additive reduction) using precision
    // Reduce leverage when margin usage is high
    const marginUsage = safeDivide(totalMarginUsed, account.equity, 6).toNumber();
    const marginUsageAboveThreshold = safeSubtract(marginUsage, 0.1).toNumber();
    const marginPenaltyRange = safeSubtract(0.25, 0.1).toNumber(); // 0.1 to 0.25 range
    const marginPenalty = Math.max(
      0,
      safeDivide(marginUsageAboveThreshold, marginPenaltyRange, 6).toNumber()
    );
    const marginAdjustment = safeMultiply(
      leverageRange,
      safeMultiply(marginPenalty, 0.3)
    ).toNumber();
    leverage = safeSubtract(leverage, marginAdjustment).toNumber();

    // Factor 3: Position count penalty (additive reduction) using precision
    // Reduce leverage as portfolio fills up
    const positionPenalty = safeDivide(positionCount, this.params.maxPositions, 6).toNumber();
    const positionAdjustment = safeMultiply(
      leverageRange,
      safeMultiply(positionPenalty, 0.2)
    ).toNumber();
    leverage = safeSubtract(leverage, positionAdjustment).toNumber();

    // Factor 4: Symbol performance adjustment (adaptive)
    // Adjust leverage based on historical performance of this symbol
    const symbol = signal.coin;
    const perfAdjustment = this.performanceTracker.getLeverageAdjustment(symbol);
    if (perfAdjustment !== 1.0) {
      // Apply performance adjustment multiplicatively (final adjustment)
      leverage = safeMultiply(leverage, perfAdjustment).toNumber();
      this.logger.debug(
        'Adaptive leverage adjustment applied',
        {
          symbol,
          adjustment: (perfAdjustment * 100).toFixed(1) + '%',
          finalLeverage: leverage.toFixed(2) + 'x',
        },
        this.context
      );
    }

    // Ensure leverage stays within bounds
    let leverageNum = leverage;
    leverageNum = Math.max(this.params.minLeverage, Math.min(this.params.maxLeverage, leverageNum));

    // Round to nearest 0.5 for cleaner display
    return roundToPrecision(leverageNum, 1);
  }

  validateSignal(
    signal: TradingSignal,
    account: Account,
    currentPositions: Position[]
  ): { valid: boolean; reason?: string } {
    // Delegate to SignalValidator for clean separation
    return this.signalValidator.validateSignal(signal, account, currentPositions);
  }

  /**
   * Calculate exit price for a position
   * @param position - The position
   * @param currentPrice - Current price
   * @param percent - Percentage for stop loss or take profit
   * @param direction - 'stop' for stop loss, 'profit' for take profit
   */
  private calculateExitPrice(
    position: Position,
    currentPrice: number,
    percent: number,
    direction: 'stop' | 'profit'
  ): number {
    const isLong = position.side === 'long';
    const multiplier = direction === 'stop' ? -1 : 1;

    if (isLong) {
      return currentPrice * (1 + multiplier * percent);
    } else {
      return currentPrice * (1 - multiplier * percent);
    }
  }

  calculateStopLoss(position: Position, currentPrice: number): number {
    return this.calculateExitPrice(position, currentPrice, this.params.defaultStopLoss, 'stop');
  }

  calculateTakeProfit(
    position: Position,
    currentPrice: number,
    riskRewardRatio: number = ORDER_EXECUTION.DEFAULT_RISK_REWARD_RATIO
  ): number {
    const takeProfitPercent = this.params.defaultStopLoss * riskRewardRatio;
    return this.calculateExitPrice(position, currentPrice, takeProfitPercent, 'profit');
  }

  /**
   * Check if exit condition is met
   * @param position - The position to check
   * @param currentPrice - Current market price
   * @param exitPrice - The exit price (stop loss or take profit)
   * @param type - Type of exit condition
   */
  private checkExitCondition(
    position: Position,
    currentPrice: number,
    exitPrice: number,
    type: 'stop' | 'profit'
  ): boolean {
    const isLong = position.side === 'long';

    if (type === 'stop') {
      return isLong ? currentPrice <= exitPrice : currentPrice >= exitPrice;
    } else {
      return isLong ? currentPrice >= exitPrice : currentPrice <= exitPrice;
    }
  }

  checkStopLoss(position: Position, currentPrice: number): boolean {
    // Use effective stop loss price (custom, trailing, or calculated based on entry price)
    const stopLossPrice = this.getEffectiveStopLossPrice(position, position.entryPrice);
    return this.checkExitCondition(position, currentPrice, stopLossPrice, 'stop');
  }

  checkTakeProfit(position: Position, currentPrice: number): boolean {
    // Use effective take profit price (custom or calculated based on entry price)
    const takeProfitPrice = this.getEffectiveTakeProfitPrice(position, position.entryPrice);
    return this.checkExitCondition(position, currentPrice, takeProfitPrice, 'profit');
  }

  updateRiskParams(newParams: Partial<RiskParams>): void {
    this.params = { ...this.params, ...newParams };
  }

  getRiskParams(): RiskParams {
    return { ...this.params };
  }

  /**
   * Check if portfolio drawdown exceeds maximum allowed threshold
   * @param account - Current account state
   * @param initialBalance - Initial account balance at start of trading
   * @returns true if drawdown limit exceeded, false otherwise
   */
  checkPortfolioDrawdown(account: Account, initialBalance: number): boolean {
    if (initialBalance <= 0) {
      this.logger.error(
        'Invalid initial balance for drawdown calculation',
        new Error(`Initial balance ${initialBalance} is invalid`),
        this.context
      );
      return false;
    }

    const drawdown = (initialBalance - account.equity) / initialBalance;

    if (drawdown > POSITION_MONITORING.MAX_PORTFOLIO_DRAWDOWN) {
      this.logger.error(
        'Portfolio drawdown limit exceeded - emergency close recommended',
        new Error(
          `Drawdown ${(drawdown * 100).toFixed(2)}% exceeds limit ${(POSITION_MONITORING.MAX_PORTFOLIO_DRAWDOWN * 100).toFixed(2)}%`
        ),
        this.context
      );
      return true;
    }

    // Warn at 75% of limit
    const recoveryThreshold = POSITION_MONITORING.MAX_PORTFOLIO_DRAWDOWN * 0.75;
    if (drawdown > recoveryThreshold) {
      this.logger.warn(
        'Portfolio drawdown approaching limit',
        {
          drawdown: (drawdown * 100).toFixed(2) + '%',
          limit: (POSITION_MONITORING.MAX_PORTFOLIO_DRAWDOWN * 100).toFixed(2) + '%',
        },
        this.context
      );
    }

    return false;
  }

  /**
   * Check if daily loss limit has been exceeded
   * @param account - Current account state
   * @param startOfDayBalance - Account balance at start of day
   * @returns true if daily loss limit exceeded, false otherwise
   */
  checkDailyLossLimit(account: Account, startOfDayBalance: number): boolean {
    if (startOfDayBalance <= 0) {
      this.logger.error(
        'Invalid start of day balance',
        new Error(`Start of day balance ${startOfDayBalance} is invalid`),
        this.context
      );
      return false;
    }

    const dailyLoss = (startOfDayBalance - account.equity) / startOfDayBalance;

    if (dailyLoss > POSITION_MONITORING.MAX_DAILY_LOSS) {
      this.logger.error(
        'Daily loss limit exceeded - trading should be paused',
        new Error(
          `Daily loss ${(dailyLoss * 100).toFixed(2)}% exceeds limit ${(POSITION_MONITORING.MAX_DAILY_LOSS * 100).toFixed(2)}%`
        ),
        this.context
      );
      return true;
    }

    return false;
  }

  /**
   * Calculate trailing stop loss for a position
   * Returns both the stop price and updated peak price (immutable)
   * Trail begins when position is +2% and moves to breakeven
   * At +5% profit, trail at -2% from peak
   * Implements progressive stop tightening as profit increases
   */
  updateTrailingStop(
    position: Position,
    currentPrice: number,
    atr14?: number,
    _indicators?: TechnicalIndicators
  ): { stopPrice: number | null; newPeakPrice: number } {
    // Validate inputs
    if (position.entryPrice <= 0 || currentPrice <= 0) {
      this.logger.warn(
        'Invalid prices for trailing stop calculation',
        {
          entryPrice: position.entryPrice,
          currentPrice,
          symbol: position.symbol,
        },
        this.context
      );
      return { stopPrice: null, newPeakPrice: position.peakPrice || currentPrice };
    }

    const isLong = position.side === 'long';
    const entryPrice = position.entryPrice;

    // Calculate current P&L percentage
    const pnlPercent = ((currentPrice - entryPrice) / entryPrice) * 100;
    const actualPnlPercent = isLong ? pnlPercent : -pnlPercent;

    // Calculate new peak price (immutable - don't modify position)
    const currentPeak = position.peakPrice || currentPrice;
    const newPeakPrice = isLong
      ? Math.max(currentPeak, currentPrice)
      : Math.min(currentPeak, currentPrice);

    let stopPrice: number | null = null;
    let trailingDistance: number = ORDER_EXECUTION.TRAILING_STOP_DISTANCE;

    // Calculate dynamic trailing distance based on ATR if available
    if (atr14 && currentPrice > 0) {
      const atrPercent = atr14 / currentPrice;
      // Use ATR-based trailing distance with clamping
      const atrBasedDistance = Math.min(
        Math.max(
          atrPercent * ORDER_EXECUTION.ATR_TRAILING_DISTANCE_MULTIPLIER,
          ORDER_EXECUTION.MIN_TRAILING_STOP_DISTANCE
        ),
        ORDER_EXECUTION.MAX_TRAILING_STOP_DISTANCE
      );
      trailingDistance = Math.max(trailingDistance, atrBasedDistance);

      this.logger.debug(
        'ATR-based trailing distance calculated',
        {
          symbol: position.symbol,
          atrPercent: (atrPercent * 100).toFixed(2) + '%',
          trailingDistance: (trailingDistance * 100).toFixed(2) + '%',
        },
        this.context
      );
    }

    // Progressive stop tightening as profit increases
    // Trailing stop conditions using constants
    if (actualPnlPercent >= ORDER_EXECUTION.TRAILING_STOP_ACTIVATION * 100) {
      if (actualPnlPercent >= ORDER_EXECUTION.TRAILING_STOP_ACTIVATION * 250) {
        // At +5% or more: trail stop at dynamic distance from peak
        // Progressive tightening: the more profit, the tighter the stop
        if (actualPnlPercent >= ORDER_EXECUTION.HIGH_PROFIT_THRESHOLD) {
          // At +10% or more: tighten trailing distance
          trailingDistance = Math.max(
            ORDER_EXECUTION.HIGH_PROFIT_TRAILING_DISTANCE,
            trailingDistance * ORDER_EXECUTION.HIGH_PROFIT_TIGHTENING_FACTOR
          );
        } else if (actualPnlPercent >= ORDER_EXECUTION.MEDIUM_PROFIT_THRESHOLD) {
          // At +7.5% or more: tighten trailing distance
          trailingDistance = Math.max(
            ORDER_EXECUTION.MEDIUM_PROFIT_TRAILING_DISTANCE,
            trailingDistance * ORDER_EXECUTION.MEDIUM_PROFIT_TIGHTENING_FACTOR
          );
        }

        stopPrice = isLong
          ? newPeakPrice * (1 - trailingDistance)
          : newPeakPrice * (1 + trailingDistance);
      } else {
        // At +2% to +5%: move stop to breakeven
        stopPrice = entryPrice;
      }
    }

    // Before +2%: use regular stop loss (return null)
    return { stopPrice, newPeakPrice };
  }

  /**
   * Check if trailing stop or regular stop loss should trigger
   * Updates position.peakPrice and position.trailingStopPrice as side effects
   * @param position - The position to check
   * @param currentPrice - Current market price
   * @param atr14 - Optional ATR14 for dynamic trailing distance
   * @param indicators - Optional technical indicators for enhanced stop calculation
   */
  checkStopLossWithTrailing(
    position: Position,
    currentPrice: number,
    atr14?: number,
    indicators?: TechnicalIndicators
  ): boolean {
    // Check trailing stop first (more aggressive)
    const { stopPrice, newPeakPrice } = this.updateTrailingStop(
      position,
      currentPrice,
      atr14,
      indicators
    );

    // Update position state with new peak price
    position.peakPrice = newPeakPrice;

    if (stopPrice) {
      const isLong = position.side === 'long';
      position.trailingStopPrice = stopPrice;
      return isLong ? currentPrice <= stopPrice : currentPrice >= stopPrice;
    }

    // Otherwise use regular stop loss
    return this.checkStopLoss(position, currentPrice);
  }

  /** Compute R-multiple given entry, current and stop distance percent (defaultStopLoss) */
  computeRMultiple(position: Position, currentPrice: number, stopLossPercent?: number): number {
    const sl = stopLossPercent ?? this.params.defaultStopLoss;
    if (position.entryPrice <= 0 || sl <= 0) return 0;
    const move = (currentPrice - position.entryPrice) / position.entryPrice;
    const signedMove = position.side === 'long' ? move : -move;
    return signedMove / sl;
  }

  /** Return breakeven stop price for a position */
  computeBreakevenStop(position: Position): number {
    return position.entryPrice;
  }

  /** Apply breakeven: set trailingStopPrice to entryPrice */
  applyBreakevenStop(position: Position): void {
    position.trailingStopPrice = this.computeBreakevenStop(position);
  }

  /**
   * Get effective stop loss price for a position
   * Priority: customStopLoss > trailingStopPrice > calculated default
   * @param position - The position to get stop loss for
   * @param currentPrice - Current market price for default calculation
   * @returns Effective stop loss price
   */
  getEffectiveStopLossPrice(position: Position, currentPrice: number): number {
    return (
      position.customStopLoss ??
      position.trailingStopPrice ??
      this.calculateStopLoss(position, currentPrice)
    );
  }

  /**
   * Get effective take profit price for a position
   * Priority: customTakeProfit > calculated default
   * @param position - The position to get take profit for
   * @param currentPrice - Current market price for default calculation
   * @returns Effective take profit price
   */
  getEffectiveTakeProfitPrice(position: Position, currentPrice: number): number {
    return position.customTakeProfit ?? this.calculateTakeProfit(position, currentPrice);
  }

  /**
   * Check drawdown protection and return protection state
   * Implements account-level drawdown protection with position size reduction and trading pause
   * @param currentEquity - Current account equity
   * @param peakEquity - Peak equity (highest equity reached)
   * @param maxDrawdown - Maximum drawdown percentage (0-1)
   * @param currentState - Current drawdown protection state
   * @returns Drawdown protection check result
   */
  checkDrawdownProtection(
    currentEquity: number,
    peakEquity: number,
    maxDrawdown: number,
    currentState?: 'normal' | 'reduced' | 'paused'
  ): {
    state: 'normal' | 'reduced' | 'paused';
    shouldReducePositionSize: boolean;
    shouldPauseTrading: boolean;
    positionSizeMultiplier: number;
  } {
    if (peakEquity <= 0 || currentEquity <= 0) {
      return {
        state: 'normal',
        shouldReducePositionSize: false,
        shouldPauseTrading: false,
        positionSizeMultiplier: 1.0,
      };
    }

    const currentDrawdown = (peakEquity - currentEquity) / peakEquity;
    const maxDrawdownThreshold = POSITION_MONITORING.MAX_PORTFOLIO_DRAWDOWN;
    const reducedThreshold = maxDrawdownThreshold * 0.7; // 70% of max = 10.5% drawdown
    const recoveryThreshold = maxDrawdownThreshold * 0.5; // 50% of max = 7.5% drawdown

    let state: 'normal' | 'reduced' | 'paused' = currentState || 'normal';
    let shouldReducePositionSize = false;
    let shouldPauseTrading = false;
    let positionSizeMultiplier = 1.0;

    // State transitions based on drawdown levels
    if (currentDrawdown >= maxDrawdownThreshold) {
      // At or above max drawdown: pause trading
      state = 'paused';
      shouldPauseTrading = true;
      positionSizeMultiplier = 0;

      this.logger.warn(
        'Maximum drawdown threshold reached - trading paused',
        {
          currentDrawdown: (currentDrawdown * 100).toFixed(2) + '%',
          maxDrawdown: (maxDrawdown * 100).toFixed(2) + '%',
          threshold: (maxDrawdownThreshold * 100).toFixed(2) + '%',
        },
        this.context
      );
    } else if (currentDrawdown >= reducedThreshold) {
      // Above reduced threshold: reduce position sizes
      state = 'reduced';
      shouldReducePositionSize = true;
      // Reduce position sizes proportionally: 50% reduction at reduced threshold, scaling to 0 at max
      const reductionFactor =
        (currentDrawdown - reducedThreshold) / (maxDrawdownThreshold - reducedThreshold);
      positionSizeMultiplier = Math.max(0.3, 1.0 - reductionFactor * 0.7); // Minimum 30% of normal size

      this.logger.info(
        'Drawdown protection: reducing position sizes',
        {
          currentDrawdown: (currentDrawdown * 100).toFixed(2) + '%',
          positionSizeMultiplier: (positionSizeMultiplier * 100).toFixed(1) + '%',
        },
        this.context
      );
    } else if (
      currentDrawdown <= recoveryThreshold &&
      (currentState === 'reduced' || currentState === 'paused')
    ) {
      // Recovered below recovery threshold: return to normal
      state = 'normal';
      shouldReducePositionSize = false;
      shouldPauseTrading = false;
      positionSizeMultiplier = 1.0;

      this.logger.info(
        'Drawdown recovery: returning to normal trading',
        {
          currentDrawdown: (currentDrawdown * 100).toFixed(2) + '%',
          recoveryThreshold: (recoveryThreshold * 100).toFixed(2) + '%',
        },
        this.context
      );
    } else if (currentState === 'reduced' || currentState === 'paused') {
      // Still in drawdown but recovering: maintain reduced state until recovery threshold
      state = currentState;
      shouldReducePositionSize = currentState === 'reduced';
      shouldPauseTrading = currentState === 'paused';

      if (currentState === 'reduced') {
        // Gradually increase position size as drawdown improves
        const improvement =
          (currentDrawdown - reducedThreshold) / (recoveryThreshold - reducedThreshold);
        positionSizeMultiplier = Math.max(0.3, 0.3 + improvement * 0.7); // Scale from 30% to 100%
      } else {
        positionSizeMultiplier = 0;
      }
    } else {
      // Normal state: no restrictions
      state = 'normal';
      shouldReducePositionSize = false;
      shouldPauseTrading = false;
      positionSizeMultiplier = 1.0;
    }

    return {
      state,
      shouldReducePositionSize,
      shouldPauseTrading,
      positionSizeMultiplier,
    };
  }

  /**
   * Get position size multiplier based on drawdown state
   * Used in position sizing to reduce sizes during drawdown
   * @param drawdownState - Current drawdown protection state
   * @param currentEquity - Current account equity
   * @param peakEquity - Peak equity
   * @returns Position size multiplier (0-1)
   */
  getDrawdownPositionSizeMultiplier(
    drawdownState?: 'normal' | 'reduced' | 'paused',
    currentEquity?: number,
    peakEquity?: number
  ): number {
    if (!drawdownState || drawdownState === 'normal') {
      return 1.0;
    }

    if (drawdownState === 'paused') {
      return 0;
    }

    // Calculate multiplier based on current drawdown
    if (currentEquity && peakEquity && peakEquity > 0) {
      const currentDrawdown = (peakEquity - currentEquity) / peakEquity;
      const maxDrawdownThreshold = POSITION_MONITORING.MAX_PORTFOLIO_DRAWDOWN;
      const reducedThreshold = maxDrawdownThreshold * 0.7;

      if (currentDrawdown >= maxDrawdownThreshold) {
        return 0;
      } else if (currentDrawdown >= reducedThreshold) {
        const reductionFactor =
          (currentDrawdown - reducedThreshold) / (maxDrawdownThreshold - reducedThreshold);
        return Math.max(0.3, 1.0 - reductionFactor * 0.7);
      }
    }

    // Default reduced state multiplier
    return 0.5;
  }
}

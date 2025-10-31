import { Account, Position, TradingSignal } from '../exchange/types.js';
import { TechnicalIndicators } from '../types/index.js';
import {
  POSITION_SIZING,
  SIGNAL_VALIDATION,
  ORDER_EXECUTION,
  ACCOUNT_VALIDATION,
  POSITION_MONITORING,
} from './constants.js';
import { aggregatePositionMetrics } from './position-utils.js';
import { Logger } from '../utils/logger.js';
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
  private logger: Logger;
  private performanceTracker: SymbolPerformanceTracker;

  constructor(params: RiskParams) {
    this.params = params;
    this.logger = Logger.getInstance('RiskManager');
    this.performanceTracker = new SymbolPerformanceTracker(50); // Track last 50 trades per symbol
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
    const total = positions.reduce((sum, p) => sum + Math.abs(p.size * p.markPrice || 0), 0);
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
    rates?: { initialMarginRate?: number; maintenanceMarginRate?: number; takerFeeRate?: number }
  ): {
    shouldLiquidate: boolean;
    marginRatio: number;
    equityOnPosition: number;
    maintenanceMargin: number;
  } {
    const notional = Math.abs(position.size * markPrice);
    const leverage = Math.max(1, position.leverage || 1);
    const defaultIMR = 1 / leverage; // simple proxy when no table available
    const imr = rates?.initialMarginRate ?? defaultIMR;
    const mmr = rates?.maintenanceMarginRate ?? Math.min(imr * 0.5, 0.02); // conservative 50% of IMR or 2%
    const takerFee = rates?.takerFeeRate ?? 0.0005; // 5 bps default

    const entryNotional = Math.abs(position.size * position.entryPrice);
    const initialMargin = position.marginUsed || entryNotional / leverage;
    const unreal = this.computeUnrealized(position, markPrice);
    const feesBuffer = notional * takerFee; // simple fees buffer
    const equityOnPosition = initialMargin + unreal - feesBuffer;
    const maintenanceMargin = notional * mmr;

    const marginRatio = maintenanceMargin > 0 ? equityOnPosition / maintenanceMargin : Infinity;
    const shouldLiquidate = equityOnPosition <= maintenanceMargin;
    return {
      shouldLiquidate,
      marginRatio: roundToPrecision(marginRatio, 4),
      equityOnPosition: roundToPrecision(equityOnPosition, EXCHANGE_PRECISION.USDT),
      maintenanceMargin: roundToPrecision(maintenanceMargin, EXCHANGE_PRECISION.USDT),
    };
  }

  calculatePositionSizing(
    signal: TradingSignal,
    account: Account,
    currentPositions: Position[],
    currentPrice: number,
    atr14?: number,
    indicators?: TechnicalIndicators
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
        this.logger.error('Invalid current price', { currentPrice, signal: signal.coin });
        return null;
      }

      if (signal.entry_price && signal.entry_price <= ACCOUNT_VALIDATION.MIN_VALID_PRICE) {
        this.logger.error('Invalid entry price in signal', {
          entryPrice: signal.entry_price,
          signal: signal.coin,
        });
        return null;
      }

      // Check if we can open new positions
      if (currentPositions.length >= this.params.maxPositions) {
        // Silent rejection
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
        // Silent rejection - margin limit reached
        return null;
      }

      // Calculate position size based on risk using precision-safe arithmetic
      const entryPrice = signal.entry_price || currentPrice;
      const stopLoss = signal.stop_loss || this.params.defaultStopLoss;
      const riskAmount = safePercentage(account.equity, this.params.maxRiskPerTrade).toNumber(); // Maximum $ loss

      // Detect market regime (trending vs ranging) for adaptive stop loss
      const regime = this.detectRegime(indicators, entryPrice);
      if (regime !== 'unknown') {
        this.logger.debug('Market regime detected', {
          coin: signal.coin,
          regime,
          ema20: indicators?.ema20,
          ema50: indicators?.ema50,
          bandwidth: indicators?.bollinger?.bandwidth,
        });
      }

      // Calculate ATR-based stop loss if ATR is available
      let atrBasedStopLoss: number | undefined;
      if (atr14 && atr14 > 0 && entryPrice > 0) {
        const atrStopDistance = safeMultiply(
          atr14,
          POSITION_SIZING.ATR_STOP_LOSS_MULTIPLIER
        ).toNumber();
        atrBasedStopLoss = safeDivide(atrStopDistance, entryPrice, 6).toNumber();

        // In trending markets, use wider stops (allow 1.5x ATR); in ranging, use tighter (1.0x ATR)
        const originalStop = atrBasedStopLoss;
        if (regime === 'trending' && atrBasedStopLoss) {
          atrBasedStopLoss = safeMultiply(atrBasedStopLoss, 1.33).toNumber(); // 33% wider
          this.logger.debug('Trending regime: widening stop loss', {
            coin: signal.coin,
            original: (originalStop * 100).toFixed(2) + '%',
            adjusted: (atrBasedStopLoss * 100).toFixed(2) + '%',
          });
        } else if (regime === 'ranging' && atrBasedStopLoss) {
          atrBasedStopLoss = safeMultiply(atrBasedStopLoss, 0.75).toNumber(); // 25% tighter
          this.logger.debug('Ranging regime: tightening stop loss', {
            coin: signal.coin,
            original: (originalStop * 100).toFixed(2) + '%',
            adjusted: (atrBasedStopLoss * 100).toFixed(2) + '%',
          });
        }
      }

      // Calculate price risk with precision
      const priceDiff = safeSubtract(currentPrice, entryPrice).toNumber();
      const priceRisk = safeDivide(Math.abs(priceDiff), currentPrice, 6).toNumber();

      // Use the largest of: signal stop loss, price risk, or ATR-based stop loss
      let actualStopLoss = Math.max(stopLoss, priceRisk);
      if (atrBasedStopLoss) {
        actualStopLoss = Math.max(actualStopLoss, atrBasedStopLoss);
      }

      // Enforce minimum stop loss to prevent division issues and unrealistic position sizes
      if (actualStopLoss < POSITION_SIZING.MIN_STOP_LOSS_THRESHOLD) {
        this.logger.warn('Stop loss too small, using minimum threshold', {
          original: actualStopLoss,
          minimum: POSITION_SIZING.MIN_STOP_LOSS_THRESHOLD,
          coin: signal.coin,
        });
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
          this.logger.info('Volatility scaling applied', {
            coin: signal.coin,
            atrPercent: (atrPercent * 100).toFixed(2) + '%',
            maxAllowed: (POSITION_SIZING.MAX_ATR_PERCENT_OF_PRICE * 100).toFixed(2) + '%',
            scale: (volatilityScale * 100).toFixed(1) + '%',
          });
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

      // Step 4: Calculate position size in units using precision-safe division
      // Safety check: ensure position doesn't exceed maximum size cap
      const maxPositionValue = safePercentage(
        account.equity,
        POSITION_SIZING.MAX_POSITION_SIZE_PERCENT
      ).toNumber();
      const cappedPositionValue = Math.min(adjustedPositionValue, maxPositionValue);
      const cappedSize = safeDivide(cappedPositionValue, pricePerUnit, 8).toNumber();

      // Step 5: Determine dynamic leverage based on confidence and risk
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
      if (!isFinite(cappedSize) || cappedSize <= 0) {
        this.logger.error('Invalid position size calculated', {
          cappedSize,
          adjustedPositionValue,
          pricePerUnit,
          signal: signal.coin,
        });
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
      this.logger.error('Error calculating position sizing', error);
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
      this.logger.error('Invalid equity for leverage calculation', { equity: account.equity });
      return this.params.minLeverage;
    }

    // Start with base leverage using precision-safe arithmetic
    const leverageRange = safeSubtract(this.params.maxLeverage, this.params.minLeverage).toNumber();
    let leverage = safeAdd(this.params.minLeverage, 0);

    // Factor 1: Signal confidence boost (additive) using precision
    // Scale confidence from 0.55-1.0 to 0-1 range
    const confidenceDiff = safeSubtract(signal.confidence, 0.55).toNumber();
    const confidenceRange = safeSubtract(1.0, 0.55).toNumber();
    const confidenceBoost = Math.max(0, safeDivide(confidenceDiff, confidenceRange, 6).toNumber());
    const confidenceAdjustment = safeMultiply(
      leverageRange,
      safeMultiply(confidenceBoost, 0.5)
    ).toNumber();
    leverage = safeAdd(leverage, confidenceAdjustment);

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
    leverage = safeSubtract(leverage, marginAdjustment);

    // Factor 3: Position count penalty (additive reduction) using precision
    // Reduce leverage as portfolio fills up
    const positionPenalty = safeDivide(positionCount, this.params.maxPositions, 6).toNumber();
    const positionAdjustment = safeMultiply(
      leverageRange,
      safeMultiply(positionPenalty, 0.2)
    ).toNumber();
    leverage = safeSubtract(leverage, positionAdjustment);

    // Factor 4: Symbol performance adjustment (adaptive)
    // Adjust leverage based on historical performance of this symbol
    const symbol = signal.coin;
    const perfAdjustment = this.performanceTracker.getLeverageAdjustment(symbol);
    if (perfAdjustment !== 1.0) {
      // Apply performance adjustment multiplicatively (final adjustment)
      leverage = safeMultiply(leverage, perfAdjustment).toNumber();
      this.logger.debug('Adaptive leverage adjustment applied', {
        symbol,
        adjustment: (perfAdjustment * 100).toFixed(1) + '%',
        finalLeverage: leverage.toFixed(2) + 'x',
      });
    }

    // Ensure leverage stays within bounds
    let leverageNum = leverage.toNumber();
    leverageNum = Math.max(this.params.minLeverage, Math.min(this.params.maxLeverage, leverageNum));

    // Round to nearest 0.5 for cleaner display
    return roundToPrecision(leverageNum, 1);
  }

  validateSignal(
    signal: TradingSignal,
    _account: Account,
    currentPositions: Position[]
  ): { valid: boolean; reason?: string } {
    try {
      // Check signal format
      if (!signal.coin || !signal.action || !signal.confidence) {
        const missingFields = [];
        if (!signal.coin) missingFields.push('coin');
        if (!signal.action) missingFields.push('action');
        if (!signal.confidence) missingFields.push('confidence');

        const reason = `Missing required fields: ${missingFields.join(', ')}`;
        this.logger.warn(`Signal validation failed: ${reason}`);
        return { valid: false, reason };
      }

      // Check confidence threshold with adaptive adjustment based on symbol performance
      const adaptiveThreshold = this.performanceTracker.getConfidenceThreshold(
        signal.coin,
        SIGNAL_VALIDATION.MIN_CONFIDENCE
      );
      if (adaptiveThreshold !== SIGNAL_VALIDATION.MIN_CONFIDENCE) {
        this.logger.debug('Adaptive confidence threshold applied', {
          coin: signal.coin,
          default: (SIGNAL_VALIDATION.MIN_CONFIDENCE * 100).toFixed(1) + '%',
          adjusted: (adaptiveThreshold * 100).toFixed(1) + '%',
        });
      }

      // Check with epsilon tolerance for floating-point precision
      // (e.g., 0.54999999 should be accepted when threshold is 0.55)
      if (signal.confidence < adaptiveThreshold - SIGNAL_VALIDATION.CONFIDENCE_EPSILON) {
        const reason = `Confidence too low: ${(signal.confidence * 100).toFixed(1)}% < ${(adaptiveThreshold * 100).toFixed(1)}% required (adaptive threshold based on ${signal.coin} performance)`;
        this.logger.warn(`Signal validation failed for ${signal.coin} ${signal.action}: ${reason}`);
        return { valid: false, reason };
      }

      // Check if we already have a position in this coin
      // Normalize symbol comparison (e.g., "BTC/USDT" vs "BTC")
      const positionSymbol = `${signal.coin}/USDT`;
      const existingPosition = currentPositions.find(p => p.symbol === positionSymbol);
      if (existingPosition && (signal.action === 'LONG' || signal.action === 'SHORT')) {
        const reason = `Position already exists for ${signal.coin} (${existingPosition.side} ${existingPosition.size} ${signal.coin})`;
        this.logger.warn(`Signal validation failed for ${signal.coin} ${signal.action}: ${reason}`);
        return { valid: false, reason };
      }

      // Check stop loss validity
      if (
        signal.stop_loss &&
        (signal.stop_loss < SIGNAL_VALIDATION.MIN_STOP_LOSS ||
          signal.stop_loss > SIGNAL_VALIDATION.MAX_STOP_LOSS)
      ) {
        const reason = `Invalid stop loss: ${(signal.stop_loss * 100).toFixed(1)}% not in range ${(SIGNAL_VALIDATION.MIN_STOP_LOSS * 100).toFixed(1)}%-${(SIGNAL_VALIDATION.MAX_STOP_LOSS * 100).toFixed(1)}%`;
        this.logger.warn(`Signal validation failed for ${signal.coin} ${signal.action}: ${reason}`);
        return { valid: false, reason };
      }

      // Check profit target validity
      if (
        signal.profit_target &&
        signal.stop_loss &&
        signal.profit_target < signal.stop_loss * SIGNAL_VALIDATION.MIN_RISK_REWARD_RATIO
      ) {
        const reason = `Invalid risk/reward ratio: ${(signal.profit_target / signal.stop_loss).toFixed(2)} < ${SIGNAL_VALIDATION.MIN_RISK_REWARD_RATIO} required`;
        this.logger.warn(`Signal validation failed for ${signal.coin} ${signal.action}: ${reason}`);
        return { valid: false, reason };
      }

      // Correlation check: prevent over-concentration of same-side positions
      if (signal.action === 'LONG' || signal.action === 'SHORT') {
        const targetSide = signal.action.toLowerCase() as 'long' | 'short';
        const sameSidePositions = currentPositions.filter(p => p.side === targetSide);
        if (sameSidePositions.length >= POSITION_SIZING.MAX_SAME_SIDE_POSITIONS) {
          const reason = `Too many ${targetSide} positions (${sameSidePositions.length} >= ${POSITION_SIZING.MAX_SAME_SIDE_POSITIONS}), rejecting to reduce correlation`;
          this.logger.warn(
            `Signal validation failed for ${signal.coin} ${signal.action}: ${reason}`
          );
          return { valid: false, reason };
        }
      }

      return { valid: true };
    } catch (error) {
      const reason = `Validation error: ${error instanceof Error ? error.message : 'Unknown error'}`;
      this.logger.error('Error validating signal', error);
      return { valid: false, reason };
    }
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
    const stopLossPrice = this.calculateStopLoss(position, position.entryPrice);
    return this.checkExitCondition(position, currentPrice, stopLossPrice, 'stop');
  }

  checkTakeProfit(position: Position, currentPrice: number): boolean {
    const takeProfitPrice = this.calculateTakeProfit(position, position.entryPrice);
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
      this.logger.error('Invalid initial balance for drawdown calculation', { initialBalance });
      return false;
    }

    const drawdown = (initialBalance - account.equity) / initialBalance;

    if (drawdown > POSITION_MONITORING.MAX_PORTFOLIO_DRAWDOWN) {
      this.logger.error('Portfolio drawdown limit exceeded - emergency close recommended', {
        drawdown: (drawdown * 100).toFixed(2) + '%',
        limit: (POSITION_MONITORING.MAX_PORTFOLIO_DRAWDOWN * 100).toFixed(2) + '%',
        currentEquity: account.equity,
        initialBalance,
      });
      return true;
    }

    // Warn at 75% of limit
    if (drawdown > POSITION_MONITORING.MAX_PORTFOLIO_DRAWDOWN * 0.75) {
      this.logger.warn('Portfolio drawdown approaching limit', {
        drawdown: (drawdown * 100).toFixed(2) + '%',
        limit: (POSITION_MONITORING.MAX_PORTFOLIO_DRAWDOWN * 100).toFixed(2) + '%',
      });
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
      this.logger.error('Invalid start of day balance', { startOfDayBalance });
      return false;
    }

    const dailyLoss = (startOfDayBalance - account.equity) / startOfDayBalance;

    if (dailyLoss > POSITION_MONITORING.MAX_DAILY_LOSS) {
      this.logger.error('Daily loss limit exceeded - trading should be paused', {
        dailyLoss: (dailyLoss * 100).toFixed(2) + '%',
        limit: (POSITION_MONITORING.MAX_DAILY_LOSS * 100).toFixed(2) + '%',
        currentEquity: account.equity,
        startOfDayBalance,
      });
      return true;
    }

    return false;
  }

  /**
   * Calculate trailing stop loss for a position
   * Returns both the stop price and updated peak price (immutable)
   * Trail begins when position is +2% and moves to breakeven
   * At +5% profit, trail at -2% from peak
   */
  updateTrailingStop(
    position: Position,
    currentPrice: number
  ): { stopPrice: number | null; newPeakPrice: number } {
    // Validate inputs
    if (position.entryPrice <= 0 || currentPrice <= 0) {
      this.logger.warn('Invalid prices for trailing stop calculation', {
        entryPrice: position.entryPrice,
        currentPrice,
        symbol: position.symbol,
      });
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

    // Trailing stop conditions using constants
    if (actualPnlPercent >= ORDER_EXECUTION.TRAILING_STOP_ACTIVATION * 100) {
      if (actualPnlPercent >= ORDER_EXECUTION.TRAILING_STOP_ACTIVATION * 250) {
        // At +5% or more: trail stop at 2% below peak
        stopPrice = isLong
          ? newPeakPrice * (1 - ORDER_EXECUTION.TRAILING_STOP_DISTANCE)
          : newPeakPrice * (1 + ORDER_EXECUTION.TRAILING_STOP_DISTANCE);
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
   */
  checkStopLossWithTrailing(position: Position, currentPrice: number): boolean {
    // Check trailing stop first (more aggressive)
    const { stopPrice, newPeakPrice } = this.updateTrailingStop(position, currentPrice);

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

  /**
   * Detect market regime (trending vs ranging) based on indicators
   * Uses Bollinger bandwidth, EMA alignment, and price consolidation
   */
  private detectRegime(
    indicators?: TechnicalIndicators,
    currentPrice?: number
  ): 'trending' | 'ranging' | 'unknown' {
    if (!indicators || !currentPrice) return 'unknown';

    let trendScore = 0;

    // 1. Bollinger Bandwidth: narrow = ranging, wide = trending
    if (indicators.bollinger?.bandwidth !== undefined) {
      if (indicators.bollinger.bandwidth < POSITION_SIZING.RANGING_BANDWIDTH_THRESHOLD) {
        trendScore -= 1; // Narrow bands suggest ranging
      } else {
        trendScore += 1; // Wide bands suggest trending
      }
    }

    // 2. EMA alignment strength (distance between EMA20 and EMA50)
    if (indicators.ema20 && indicators.ema50 && indicators.ema20 > 0 && indicators.ema50 > 0) {
      const emaSpread = Math.abs(indicators.ema20 - indicators.ema50) / currentPrice;
      if (emaSpread > POSITION_SIZING.TREND_REGIME_THRESHOLD) {
        trendScore += 1; // Strong separation = trending
      } else if (emaSpread < POSITION_SIZING.TREND_REGIME_THRESHOLD * 0.5) {
        trendScore -= 1; // Tight = ranging
      }
    }

    // 3. MACD momentum (histogram strength indicates trending)
    if (indicators.macd?.histogram !== undefined) {
      const macdStrength = Math.abs(indicators.macd.histogram) / currentPrice;
      if (macdStrength > 0.001) {
        trendScore += 1; // Strong MACD momentum
      }
    }

    // Determine regime
    if (trendScore >= 2) return 'trending';
    if (trendScore <= -1) return 'ranging';
    return 'unknown';
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
}

import { Account, Position, TradingSignal } from '../exchange/types.js';
import { POSITION_SIZING, SIGNAL_VALIDATION, ORDER_EXECUTION } from './constants.js';
import { aggregatePositionMetrics } from './position-utils.js';
import { Logger } from '../utils/logger.js';

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

  constructor(params: RiskParams) {
    this.params = params;
    this.logger = Logger.getInstance('RiskManager');
  }

  calculatePositionSizing(
    signal: TradingSignal,
    account: Account,
    currentPositions: Position[],
    currentPrice: number
  ): PositionSizing | null {
    try {
      // Check if we can open new positions
      if (currentPositions.length >= this.params.maxPositions) {
        // Silent rejection
        return null;
      }

      // Check total margin usage to prevent over-leveraging using optimized aggregation
      const aggregates = aggregatePositionMetrics(currentPositions);
      const currentMarginUsage = aggregates.totalMarginUsed / account.equity;
      if (currentMarginUsage >= this.params.maxTotalRisk) {
        // Silent rejection - margin limit reached
        return null;
      }

      // Calculate position size based on risk
      const stopLoss = signal.stop_loss || this.params.defaultStopLoss;
      const riskAmount = account.equity * this.params.maxRiskPerTrade; // Maximum $ loss
      const priceRisk =
        Math.abs(currentPrice - (signal.entry_price || currentPrice)) / currentPrice;

      // Use the larger of signal stop loss or price risk
      const actualStopLoss = Math.max(stopLoss, priceRisk);

      if (actualStopLoss <= 0) {
        // Silent rejection
        return null;
      }

      // Step 1: Calculate position value based on risk
      // We want: max $ loss = position value × stop loss %
      // Therefore: position value = max $ loss / stop loss %
      const pricePerUnit = signal.entry_price || currentPrice;
      const riskBasedPositionValue = riskAmount / actualStopLoss;

      // Step 2: Limit position size to avoid over-leveraging
      // Use max 30% of available capital per trade to ensure we can open multiple positions
      // But ensure we leave at least 40% available for other trades
      const availableForTrade = account.availableMargin * (1 - POSITION_SIZING.MIN_RESERVE_PERCENT);
      const maxCapitalBasedValue = availableForTrade * POSITION_SIZING.MAX_CAPITAL_PERCENT;

      // Step 3: Apply utilization factor based on number of open positions
      // Scale position size inversely with position count to maintain diversification
      const utilizationFactor = 1 - currentPositions.length / this.params.maxPositions;
      // Factor ranges from 1.0 (no positions) down to ~0.17 (at max positions)
      const positionValueWithUtil =
        Math.min(maxCapitalBasedValue, riskBasedPositionValue) * utilizationFactor;

      // Ensure minimum position value (1% of account or $200, whichever is higher)
      // This scales with account size and prevents tiny positions
      const minPositionValue = Math.max(
        POSITION_SIZING.MIN_POSITION_VALUE_USD,
        account.equity * POSITION_SIZING.MIN_POSITION_PERCENT
      );
      const adjustedPositionValue = Math.max(minPositionValue, positionValueWithUtil);

      // Step 4: Calculate position size in units (this is the amount we'll buy/sell)
      const suggestedSize = adjustedPositionValue / pricePerUnit;

      // Step 5: Determine dynamic leverage based on confidence and risk
      const leverage = this.calculateDynamicLeverage(
        signal,
        account,
        aggregates.totalMarginUsed,
        currentPositions.length
      );

      // Calculate stop loss price
      const stopLossPrice =
        signal.action === 'LONG'
          ? pricePerUnit * (1 - actualStopLoss)
          : pricePerUnit * (1 + actualStopLoss);

      return {
        coin: signal.coin,
        suggestedSize: suggestedSize, // Size in units (coins), NOT leveraged
        maxSize: suggestedSize,
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
   */
  private calculateDynamicLeverage(
    signal: TradingSignal,
    account: Account,
    totalMarginUsed: number,
    positionCount: number
  ): number {
    // Base leverage starts at minimum
    let leverage = this.params.minLeverage;

    // Factor 1: Signal confidence
    // Higher confidence = can use higher leverage
    const confidenceFactor = signal.confidence;
    if (confidenceFactor >= 0.75) {
      // High confidence signals: use up to max leverage
      leverage = Math.min(this.params.maxLeverage, leverage * 1.5);
    } else if (confidenceFactor >= 0.65) {
      // Medium-high confidence: use slightly higher leverage
      leverage = Math.min(this.params.maxLeverage, leverage * 1.2);
    }
    // Low confidence (0.55-0.65): keep at min leverage

    // Factor 2: Account risk exposure
    // Lower leverage when already heavily leveraged
    const marginUsage = totalMarginUsed / account.equity;
    if (marginUsage > 0.2) {
      // Already using >20% of account: reduce leverage significantly
      leverage = leverage * 0.6;
    } else if (marginUsage > 0.15) {
      // Using 15-20%: reduce leverage moderately
      leverage = leverage * 0.8;
    }
    // Under 15%: no reduction

    // Factor 3: Number of open positions
    // More positions = lower per-position leverage for diversification
    const positionFactor = 1 - positionCount / (this.params.maxPositions * 2);
    leverage = leverage * Math.max(0.7, positionFactor);
    // Never go below 70% of calculated leverage due to position count

    // Ensure leverage stays within bounds
    leverage = Math.max(this.params.minLeverage, Math.min(this.params.maxLeverage, leverage));

    // Round to nearest 0.5 for cleaner display
    return Math.round(leverage * 2) / 2;
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

      // Check confidence threshold
      if (signal.confidence < SIGNAL_VALIDATION.MIN_CONFIDENCE) {
        const reason = `Confidence too low: ${(signal.confidence * 100).toFixed(1)}% < ${(SIGNAL_VALIDATION.MIN_CONFIDENCE * 100).toFixed(1)}% required`;
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
   * Update trailing stop loss for a position
   * Trail begins when position is +2% and moves to breakeven
   * At +5% profit, trail at -2% from peak
   */
  updateTrailingStop(position: Position, currentPrice: number): number | null {
    const isLong = position.side === 'long';
    const entryPrice = position.entryPrice;

    // Calculate current P&L percentage
    const pnlPercent = ((currentPrice - entryPrice) / entryPrice) * 100;
    const actualPnlPercent = isLong ? pnlPercent : -pnlPercent;

    // Update peak price if we're at a new high
    if (
      !position.peakPrice ||
      (isLong ? currentPrice > position.peakPrice : currentPrice < position.peakPrice)
    ) {
      position.peakPrice = currentPrice;
    }

    // Trailing stop conditions
    if (actualPnlPercent >= 5.0) {
      // At +5% or more: trail stop at 2% below peak
      const trailPercent = 0.02; // 2%
      return isLong
        ? (position.peakPrice || currentPrice) * (1 - trailPercent)
        : (position.peakPrice || currentPrice) * (1 + trailPercent);
    } else if (actualPnlPercent >= 2.0) {
      // At +2% to +5%: move stop to breakeven
      return entryPrice;
    }

    // Before +2%: use regular stop loss
    return null;
  }

  /**
   * Check if trailing stop or regular stop loss should trigger
   */
  checkStopLossWithTrailing(position: Position, currentPrice: number): boolean {
    // Check trailing stop first (more aggressive)
    const trailingStopPrice = this.updateTrailingStop(position, currentPrice);
    if (trailingStopPrice) {
      const isLong = position.side === 'long';
      position.trailingStopPrice = trailingStopPrice;
      return isLong ? currentPrice <= trailingStopPrice : currentPrice >= trailingStopPrice;
    }

    // Otherwise use regular stop loss
    return this.checkStopLoss(position, currentPrice);
  }
}

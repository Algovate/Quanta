import { Account, Position, TradingSignal } from '../exchange/types.js';
import { POSITION_SIZING, SIGNAL_VALIDATION, ORDER_EXECUTION } from './constants.js';
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

      // Check total margin usage to prevent over-leveraging
      const totalMarginUsed = currentPositions.reduce((sum, pos) => sum + pos.marginUsed, 0);
      const currentMarginUsage = totalMarginUsed / account.equity;
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

      // Step 3: Choose the smaller value (risk-based or capital-based) but ensure minimum size
      const finalPositionValue = Math.min(maxCapitalBasedValue, riskBasedPositionValue);

      // Ensure minimum position value (1% of account or $200, whichever is higher)
      // This scales with account size and prevents tiny positions
      const minPositionValue = Math.max(
        POSITION_SIZING.MIN_POSITION_VALUE_USD,
        account.equity * POSITION_SIZING.MIN_POSITION_PERCENT
      );
      const adjustedPositionValue = Math.max(minPositionValue, finalPositionValue);

      // Step 4: Calculate position size in units (this is the amount we'll buy/sell)
      const suggestedSize = adjustedPositionValue / pricePerUnit;

      // Step 5: Determine leverage to use
      // For simulation/safety, use minimum leverage from config
      const leverage = this.params.minLeverage;

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

  validateSignal(signal: TradingSignal, _account: Account, currentPositions: Position[]): boolean {
    try {
      // Check signal format
      if (!signal.coin || !signal.action || !signal.confidence) {
        // Silent rejection
        return false;
      }

      // Check confidence threshold
      if (signal.confidence < SIGNAL_VALIDATION.MIN_CONFIDENCE) {
        // Silent rejection
        return false;
      }

      // Check if we already have a position in this coin
      // Normalize symbol comparison (e.g., "BTC/USDT" vs "BTC")
      const positionSymbol = `${signal.coin}/USDT`;
      const existingPosition = currentPositions.find(p => p.symbol === positionSymbol);
      if (existingPosition && (signal.action === 'LONG' || signal.action === 'SHORT')) {
        // Silent rejection
        return false;
      }

      // Check stop loss validity
      if (
        signal.stop_loss &&
        (signal.stop_loss < SIGNAL_VALIDATION.MIN_STOP_LOSS ||
          signal.stop_loss > SIGNAL_VALIDATION.MAX_STOP_LOSS)
      ) {
        // Silent rejection
        return false;
      }

      // Check profit target validity
      if (
        signal.profit_target &&
        signal.stop_loss &&
        signal.profit_target < signal.stop_loss * SIGNAL_VALIDATION.MIN_RISK_REWARD_RATIO
      ) {
        // Silent rejection
        return false;
      }

      return true;
    } catch (error) {
      this.logger.error('Error validating signal', error);
      return false;
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
}

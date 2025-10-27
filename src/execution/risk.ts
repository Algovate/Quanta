import { Account, Position, TradingSignal } from '../exchange/types.js';

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

  constructor(params: RiskParams) {
    this.params = params;
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
      const maxCapitalPercent = 0.3;
      const minReservePercent = 0.4;
      const availableForTrade = account.availableMargin * (1 - minReservePercent);
      const maxCapitalBasedValue = availableForTrade * maxCapitalPercent;

      // Step 3: Choose the smaller value (risk-based or capital-based) but ensure minimum size
      const finalPositionValue = Math.min(maxCapitalBasedValue, riskBasedPositionValue);

      // Ensure minimum position value (1% of account or $200, whichever is higher)
      // This scales with account size and prevents tiny positions
      const minPositionValue = Math.max(200, account.equity * 0.01);
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
      console.error('Error calculating position sizing:', error);
      return null;
    }
  }

  validateSignal(signal: TradingSignal, account: Account, currentPositions: Position[]): boolean {
    try {
      // Check signal format
      if (!signal.coin || !signal.action || !signal.confidence) {
        // Silent rejection
        return false;
      }

      // Check confidence threshold (lowered to 0.55 to allow more trading opportunities)
      if (signal.confidence < 0.55) {
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
      if (signal.stop_loss && (signal.stop_loss < 0.01 || signal.stop_loss > 0.1)) {
        // Silent rejection
        return false;
      }

      // Check profit target validity
      if (
        signal.profit_target &&
        signal.stop_loss &&
        signal.profit_target < signal.stop_loss * 1.5
      ) {
        // Silent rejection
        return false;
      }

      return true;
    } catch (error) {
      console.error('Error validating signal:', error);
      return false;
    }
  }

  calculateStopLoss(position: Position, currentPrice: number): number {
    const stopLossPercent = this.params.defaultStopLoss;

    if (position.side === 'long') {
      return currentPrice * (1 - stopLossPercent);
    } else {
      return currentPrice * (1 + stopLossPercent);
    }
  }

  calculateTakeProfit(
    position: Position,
    currentPrice: number,
    riskRewardRatio: number = 2
  ): number {
    const stopLossPercent = this.params.defaultStopLoss;
    const takeProfitPercent = stopLossPercent * riskRewardRatio;

    if (position.side === 'long') {
      return currentPrice * (1 + takeProfitPercent);
    } else {
      return currentPrice * (1 - takeProfitPercent);
    }
  }

  checkStopLoss(position: Position, currentPrice: number): boolean {
    const stopLossPrice = this.calculateStopLoss(position, position.entryPrice);

    if (position.side === 'long') {
      return currentPrice <= stopLossPrice;
    } else {
      return currentPrice >= stopLossPrice;
    }
  }

  checkTakeProfit(position: Position, currentPrice: number): boolean {
    const takeProfitPrice = this.calculateTakeProfit(position, position.entryPrice);

    if (position.side === 'long') {
      return currentPrice >= takeProfitPrice;
    } else {
      return currentPrice <= takeProfitPrice;
    }
  }

  private calculateTotalRisk(positions: Position[], account: Account): number {
    if (positions.length === 0) return 0;

    let totalRisk = 0;

    positions.forEach(position => {
      const positionValue = position.size * position.markPrice;
      const riskPercent = Math.abs(position.unrealizedPnl) / positionValue;
      totalRisk += riskPercent * (positionValue / account.equity);
    });

    return totalRisk;
  }

  updateRiskParams(newParams: Partial<RiskParams>): void {
    this.params = { ...this.params, ...newParams };
  }

  getRiskParams(): RiskParams {
    return { ...this.params };
  }
}

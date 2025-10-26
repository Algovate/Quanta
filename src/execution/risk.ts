import { Account, Position, TradingSignal } from '../exchange/types';

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
        console.log(`Max positions (${this.params.maxPositions}) reached`);
        return null;
      }

      // Check total risk exposure
      const totalRisk = this.calculateTotalRisk(currentPositions, account);
      if (totalRisk >= this.params.maxTotalRisk) {
        console.log(
          `Total risk (${(totalRisk * 100).toFixed(1)}%) exceeds limit (${(this.params.maxTotalRisk * 100).toFixed(1)}%)`
        );
        return null;
      }

      // Calculate position size based on risk
      const stopLoss = signal.stop_loss || this.params.defaultStopLoss;
      const riskAmount = account.equity * this.params.maxRiskPerTrade;
      const priceRisk =
        Math.abs(currentPrice - (signal.entry_price || currentPrice)) / currentPrice;

      // Use the larger of signal stop loss or price risk
      const actualStopLoss = Math.max(stopLoss, priceRisk);

      if (actualStopLoss <= 0) {
        console.log('Invalid stop loss calculation');
        return null;
      }

      // Calculate position size
      const maxLoss = riskAmount;
      const pricePerUnit = signal.entry_price || currentPrice;
      const suggestedSize = maxLoss / (pricePerUnit * actualStopLoss);

      // Apply leverage limits
      const leverage = Math.min(
        Math.max(this.params.minLeverage, signal.position_size || 1),
        this.params.maxLeverage
      );

      const leveragedSize = suggestedSize * leverage;

      // Calculate stop loss price
      const stopLossPrice =
        signal.action === 'LONG'
          ? pricePerUnit * (1 - actualStopLoss)
          : pricePerUnit * (1 + actualStopLoss);

      return {
        coin: signal.coin,
        suggestedSize: leveragedSize,
        maxSize: leveragedSize,
        riskAmount,
        stopLossPrice,
        leverage,
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
        console.log('Invalid signal format');
        return false;
      }

      // Check confidence threshold
      if (signal.confidence < 0.6) {
        console.log(`Signal confidence (${signal.confidence}) too low`);
        return false;
      }

      // Check if we already have a position in this coin
      const existingPosition = currentPositions.find(p => p.symbol === signal.coin);
      if (existingPosition && signal.action === 'LONG') {
        console.log(`Already have position in ${signal.coin}`);
        return false;
      }

      // Check stop loss validity
      if (signal.stop_loss && (signal.stop_loss < 0.01 || signal.stop_loss > 0.1)) {
        console.log(`Invalid stop loss: ${signal.stop_loss}`);
        return false;
      }

      // Check profit target validity
      if (
        signal.profit_target &&
        signal.stop_loss &&
        signal.profit_target < signal.stop_loss * 1.5
      ) {
        console.log(`Profit target too close to stop loss`);
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

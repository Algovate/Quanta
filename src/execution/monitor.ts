import { Exchange, Position } from '../exchange/types';
import { RiskManager } from './risk';
import { OrderExecutor } from './orders';

export interface PositionMonitor {
  checkStopLoss(position: Position, currentPrice: number): boolean;
  checkTakeProfit(position: Position, currentPrice: number): boolean;
  shouldClosePosition(
    position: Position,
    currentPrice: number
  ): { shouldClose: boolean; reason: string };
}

export class PositionMonitorService implements PositionMonitor {
  private riskManager: RiskManager;
  private orderExecutor: OrderExecutor;

  constructor(riskManager: RiskManager, orderExecutor: OrderExecutor) {
    this.riskManager = riskManager;
    this.orderExecutor = orderExecutor;
  }

  checkStopLoss(position: Position, currentPrice: number): boolean {
    return this.riskManager.checkStopLoss(position, currentPrice);
  }

  checkTakeProfit(position: Position, currentPrice: number): boolean {
    return this.riskManager.checkTakeProfit(position, currentPrice);
  }

  shouldClosePosition(
    position: Position,
    currentPrice: number
  ): { shouldClose: boolean; reason: string } {
    // Check stop loss
    if (this.checkStopLoss(position, currentPrice)) {
      return { shouldClose: true, reason: 'Stop loss triggered' };
    }

    // Check take profit
    if (this.checkTakeProfit(position, currentPrice)) {
      return { shouldClose: true, reason: 'Take profit triggered' };
    }

    // Check for extreme losses (emergency stop)
    const lossPercent = Math.abs(position.unrealizedPnl) / (position.size * position.entryPrice);
    if (lossPercent > 0.1) {
      // 10% loss
      return { shouldClose: true, reason: 'Emergency stop - excessive loss' };
    }

    return { shouldClose: false, reason: 'Position within normal parameters' };
  }

  async monitorPositions(positions: Position[], exchange: Exchange): Promise<void> {
    for (const position of positions) {
      try {
        // Get current price
        const ticker = await exchange.getTicker(position.symbol);
        const currentPrice = (ticker as { price: number }).price;

        // Check if position should be closed
        const { shouldClose, reason } = this.shouldClosePosition(position, currentPrice);

        if (shouldClose) {
          console.log(`Closing position ${position.symbol}: ${reason}`);

          if (reason.includes('Stop loss')) {
            await this.orderExecutor.executeStopLoss(position, currentPrice);
          } else if (reason.includes('Take profit')) {
            await this.orderExecutor.executeTakeProfit(position, currentPrice);
          } else {
            // Emergency close
            await this.orderExecutor.executeStopLoss(position, currentPrice);
          }
        }
      } catch (error) {
        console.error(`Error monitoring position ${position.symbol}:`, error);
      }
    }
  }

  calculatePositionMetrics(
    position: Position,
    currentPrice: number
  ): {
    unrealizedPnl: number;
    pnlPercent: number;
    riskPercent: number;
    daysHeld: number;
  } {
    // Calculate unrealized P&L based on position side
    let unrealizedPnl: number;
    if (position.side === 'long') {
      unrealizedPnl = (currentPrice - position.entryPrice) * position.size;
    } else {
      // For SHORT: profit when price drops
      unrealizedPnl = (position.entryPrice - currentPrice) * position.size;
    }

    const pnlPercent = (unrealizedPnl / (position.size * position.entryPrice)) * 100;
    const riskPercent = (Math.abs(unrealizedPnl) / (position.size * position.entryPrice)) * 100;
    const daysHeld = (Date.now() - position.timestamp) / (1000 * 60 * 60 * 24);

    return {
      unrealizedPnl,
      pnlPercent,
      riskPercent,
      daysHeld,
    };
  }

  getPositionSummary(positions: Position[]): {
    totalPositions: number;
    totalPnl: number;
    totalMarginUsed: number;
    averageLeverage: number;
    riskLevel: 'low' | 'medium' | 'high';
  } {
    if (positions.length === 0) {
      return {
        totalPositions: 0,
        totalPnl: 0,
        totalMarginUsed: 0,
        averageLeverage: 0,
        riskLevel: 'low',
      };
    }

    const totalPnl = positions.reduce((sum, pos) => sum + pos.unrealizedPnl, 0);
    const totalMarginUsed = positions.reduce((sum, pos) => sum + pos.marginUsed, 0);
    const averageLeverage =
      positions.reduce((sum, pos) => sum + pos.leverage, 0) / positions.length;

    // Calculate risk level based on total PnL and margin usage
    let riskLevel: 'low' | 'medium' | 'high' = 'low';
    const pnlPercent = Math.abs(totalPnl) / totalMarginUsed;

    if (pnlPercent > 0.1) riskLevel = 'high';
    else if (pnlPercent > 0.05) riskLevel = 'medium';

    return {
      totalPositions: positions.length,
      totalPnl,
      totalMarginUsed,
      averageLeverage,
      riskLevel,
    };
  }
}

import { Exchange, Position } from '../exchange/types.js';
import { RiskManager } from './risk.js';
import { OrderExecutor } from './orders.js';
import { POSITION_MONITORING } from './constants.js';
import { Logger } from '../utils/logger.js';
import { calculateUnrealizedPnl, aggregatePositionMetrics } from './position-utils.js';

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
  private logger: Logger;

  constructor(riskManager: RiskManager, orderExecutor: OrderExecutor) {
    this.riskManager = riskManager;
    this.orderExecutor = orderExecutor;
    this.logger = Logger.getInstance('PositionMonitor');
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
    // Check trailing stop first (more protective)
    if (this.riskManager.checkStopLossWithTrailing(position, currentPrice)) {
      // Determine if it's a trailing stop or regular stop loss
      const reason = position.trailingStopPrice
        ? `Trailing stop triggered @ $${position.trailingStopPrice.toFixed(2)}`
        : 'Stop loss triggered';
      return { shouldClose: true, reason };
    }

    // Check take profit
    if (this.checkTakeProfit(position, currentPrice)) {
      return { shouldClose: true, reason: 'Take profit triggered' };
    }

    // Check for extreme losses (emergency stop)
    const lossPercent = Math.abs(position.unrealizedPnl) / (position.size * position.entryPrice);
    if (lossPercent > POSITION_MONITORING.EMERGENCY_STOP_LOSS_THRESHOLD) {
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
          // Silent during backtest
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
        this.logger.error(`Error monitoring position ${position.symbol}`, error);
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
    // Use shared utility for P&L calculation
    const unrealizedPnl = calculateUnrealizedPnl(position, currentPrice);
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
    correlationScore: number;
    diversificationScore: number;
  } {
    if (positions.length === 0) {
      return {
        totalPositions: 0,
        totalPnl: 0,
        totalMarginUsed: 0,
        averageLeverage: 0,
        riskLevel: 'low',
        correlationScore: 0,
        diversificationScore: 1,
      };
    }

    // Use optimized single-pass aggregation
    const aggregates = aggregatePositionMetrics(positions);
    const totalPnl = aggregates.totalPnl;
    const totalMarginUsed = aggregates.totalMarginUsed;
    const averageLeverage =
      positions.reduce((sum, pos) => sum + pos.leverage, 0) / positions.length;

    // Calculate risk level based on total PnL and margin usage
    let riskLevel: 'low' | 'medium' | 'high' = 'low';
    const pnlPercent = Math.abs(totalPnl) / totalMarginUsed;

    if (pnlPercent > POSITION_MONITORING.HIGH_RISK_THRESHOLD) riskLevel = 'high';
    else if (pnlPercent > POSITION_MONITORING.MEDIUM_RISK_THRESHOLD) riskLevel = 'medium';

    // Calculate correlation and diversification scores
    const { correlationScore, diversificationScore } = this.calculatePortfolioMetrics(positions);

    return {
      totalPositions: positions.length,
      totalPnl,
      totalMarginUsed,
      averageLeverage,
      riskLevel,
      correlationScore,
      diversificationScore,
    };
  }

  /**
   * Calculate portfolio correlation and diversification metrics
   */
  private calculatePortfolioMetrics(positions: Position[]): {
    correlationScore: number;
    diversificationScore: number;
  } {
    // Correlation score: 0 = uncorrelated, 1 = perfectly correlated
    // If all positions are same side and similar notional, high correlation
    const sides = positions.map(p => p.side);
    const allSameSide = sides.every(side => side === sides[0]);

    // Calculate correlation based on side diversity and position sizes
    let correlationScore = allSameSide ? 0.8 : 0.3;

    // Adjust based on position count (fewer positions = higher correlation)
    correlationScore = correlationScore * (3 / positions.length);
    correlationScore = Math.min(1, correlationScore);

    // Diversification score: 1 = well diversified, 0 = poorly diversified
    const uniqueSymbols = new Set(positions.map(p => p.symbol)).size;
    const totalPositions = positions.length;
    const diversificationScore = totalPositions > 1 ? uniqueSymbols / totalPositions : 1;

    // Combine with side diversity
    const finalDiversificationScore = allSameSide
      ? diversificationScore * 0.7
      : diversificationScore;

    return {
      correlationScore: Math.min(1, correlationScore),
      diversificationScore: Math.max(0, Math.min(1, finalDiversificationScore)),
    };
  }
}

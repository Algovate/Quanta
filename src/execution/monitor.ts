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
    // Only trigger on losses, calculate as percentage of margin used (actual capital at risk)
    if (position.unrealizedPnl < 0 && position.marginUsed > 0) {
      const lossPercent = Math.abs(position.unrealizedPnl) / position.marginUsed;
      if (lossPercent > POSITION_MONITORING.EMERGENCY_STOP_LOSS_THRESHOLD) {
        const lossPercentDisplay = (lossPercent * 100).toFixed(1);
        return {
          shouldClose: true,
          reason: `Emergency stop - loss ${lossPercentDisplay}% of margin`,
        };
      }
    }

    return { shouldClose: false, reason: 'Position within normal parameters' };
  }

  async monitorPositions(positions: Position[], exchange: Exchange): Promise<void> {
    // Process positions in parallel with error isolation
    const monitorPromises = positions.map(position =>
      this.monitorSinglePosition(position, exchange).catch(error => {
        this.logger.error(`Critical: Failed to monitor ${position.symbol}`, error);
        // Could emit event for manual intervention
        // EventBus.emit('position:monitor:failed', { position, error });
      })
    );

    await Promise.allSettled(monitorPromises);
  }

  /**
   * Monitor a single position with retry logic and timeout protection
   */
  private async monitorSinglePosition(position: Position, exchange: Exchange): Promise<void> {
    const MAX_RETRIES = 3;
    const TIMEOUT_MS = 5000;

    for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
      try {
        // Fetch current price with timeout
        const ticker = await Promise.race([
          exchange.getTicker(position.symbol),
          new Promise<never>((_, reject) =>
            setTimeout(() => reject(new Error('Ticker fetch timeout')), TIMEOUT_MS)
          ),
        ]);

        const currentPrice = (ticker as { price: number }).price;

        // Validate price
        if (!currentPrice || currentPrice <= 0) {
          throw new Error(`Invalid price received: ${currentPrice}`);
        }

        // Maintenance margin/liquidation check (highest priority)
        const maint = this.riskManager.checkMaintenance(position, currentPrice);
        if (maint.shouldLiquidate) {
          const reason = `Maintenance margin breached (ratio ${maint.marginRatio.toFixed(2)})`;
          await this.executePositionClose(position, currentPrice, reason);
          return; // done
        }

        // Check if position should be closed by stops/targets
        const { shouldClose, reason } = this.shouldClosePosition(position, currentPrice);
        if (shouldClose) {
          await this.executePositionClose(position, currentPrice, reason);
        }

        return; // Success - exit retry loop
      } catch (error) {
        const isLastAttempt = attempt === MAX_RETRIES;

        if (isLastAttempt) {
          this.logger.error(
            `Failed to monitor ${position.symbol} after ${MAX_RETRIES} attempts`,
            error
          );
          throw error; // Re-throw on final attempt
        }

        // Exponential backoff before retry
        const backoffMs = 1000 * Math.pow(2, attempt - 1);
        this.logger.warn(
          `Retry ${attempt}/${MAX_RETRIES} for ${position.symbol} after ${backoffMs}ms`,
          {
            error: error instanceof Error ? error.message : String(error),
          }
        );
        await new Promise(resolve => setTimeout(resolve, backoffMs));
      }
    }
  }

  /**
   * Execute position close based on reason
   */
  private async executePositionClose(
    position: Position,
    currentPrice: number,
    reason: string
  ): Promise<void> {
    try {
      if (reason.includes('Stop loss') || reason.includes('Emergency')) {
        await this.orderExecutor.executeStopLoss(position, currentPrice);
      } else if (reason.includes('Take profit')) {
        await this.orderExecutor.executeTakeProfit(position, currentPrice);
      } else {
        // Default to stop loss for unknown reasons
        await this.orderExecutor.executeStopLoss(position, currentPrice);
      }
    } catch (error) {
      this.logger.error(`Failed to execute close for ${position.symbol}`, error);
      throw error; // Re-throw to trigger retry
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

    // Calculate risk level based on margin ratio (not P&L)
    // Risk level represents how much of the account is at risk, not current profit/loss
    let riskLevel: 'low' | 'medium' | 'high' = 'low';

    // This calculation needs account equity, which we don't have here
    // For now, use a simplified approach based on margin used
    // Ideally this should be: const marginRatio = totalMarginUsed / account.equity
    // But we'll use thresholds relative to total margin
    const marginUsageIndicator = totalMarginUsed; // Placeholder until we add account param

    // Use absolute thresholds for now (should be ratio-based with account equity)
    if (marginUsageIndicator > 5000) riskLevel = 'high';
    else if (marginUsageIndicator > 2000) riskLevel = 'medium';

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

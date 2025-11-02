import { Exchange, Position } from '../exchange/types.js';
import { RiskManager } from './risk.js';
import { OrderExecutor } from './orders.js';
import { POSITION_MONITORING, ORDER_EXECUTION } from './constants.js';
import { Logger } from '../utils/logger.js';
import { LogLevel } from '../utils/logger-types.js';
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
  private stateBySymbol: Map<
    string,
    { tp1Done?: boolean; flatCycles?: number; breakevenApplied?: boolean }
  > = new Map();

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

  async monitorPositions(
    positions: Position[],
    exchange: Exchange
  ): Promise<
    Array<{
      symbol: string;
      side: string;
      decisions: Array<{
        type:
          | 'maintenance'
          | 'tp1'
          | 'breakeven'
          | 'auto_close'
          | 'stop_loss'
          | 'take_profit'
          | 'emergency';
        action: string;
        reason: string;
        details?: Record<string, any>;
      }>;
    }>
  > {
    // Process positions in parallel with error isolation
    const monitorPromises = positions.map(position =>
      this.monitorSinglePosition(position, exchange).catch(error => {
        this.logger.error(`Critical: Failed to monitor ${position.symbol}`, error);
        // Return decision info for failed monitoring
        return {
          symbol: position.symbol,
          side: position.side,
          decisions: [
            {
              type: 'emergency' as const,
              action: 'monitor_failed',
              reason: error instanceof Error ? error.message : String(error),
            },
          ],
        };
      })
    );

    const results = await Promise.allSettled(monitorPromises);
    return results
      .filter(
        (r): r is PromiseFulfilledResult<{ symbol: string; side: string; decisions: Array<any> }> =>
          r.status === 'fulfilled'
      )
      .map(r => r.value);
  }

  /**
   * Monitor a single position with retry logic and timeout protection
   */
  private async monitorSinglePosition(
    position: Position,
    exchange: Exchange
  ): Promise<{
    symbol: string;
    side: string;
    decisions: Array<{
      type:
        | 'maintenance'
        | 'tp1'
        | 'breakeven'
        | 'auto_close'
        | 'stop_loss'
        | 'take_profit'
        | 'emergency';
      action: string;
      reason: string;
      details?: Record<string, any>;
    }>;
  }> {
    const decisions: Array<{
      type:
        | 'maintenance'
        | 'tp1'
        | 'breakeven'
        | 'auto_close'
        | 'stop_loss'
        | 'take_profit'
        | 'emergency';
      action: string;
      reason: string;
      details?: Record<string, any>;
    }> = [];
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

        // Validate price - use strict validation
        if (
          currentPrice === undefined ||
          currentPrice === null ||
          !isFinite(currentPrice) ||
          currentPrice <= 0
        ) {
          throw new Error(`Invalid price received: ${currentPrice} (must be finite and > 0)`);
        }

        // Maintenance margin/liquidation check (highest priority)
        const maint = this.riskManager.checkMaintenance(position, currentPrice);
        if (maint.shouldLiquidate) {
          const reason = `Maintenance margin breached (ratio ${maint.marginRatio.toFixed(2)})`;
          decisions.push({
            type: 'maintenance',
            action: 'close',
            reason,
            details: {
              marginRatio: maint.marginRatio,
              equityOnPosition: maint.equityOnPosition,
              maintenanceMargin: maint.maintenanceMargin,
            },
          });
          await this.executePositionClose(position, currentPrice, reason);
          return {
            symbol: position.symbol,
            side: position.side,
            decisions,
          };
        }

        const key = position.symbol;
        const st = this.stateBySymbol.get(key) || {};
        const rMultiple = this.riskManager.computeRMultiple(position, currentPrice);

        // Partial take-profit at 1R: close 50% and move stop to breakeven (once)
        try {
          if (!st.tp1Done && rMultiple >= 1) {
            // Reduce noise: only log info when in verbose (info) level; otherwise skip
            if (this.logger.getConfig().level <= LogLevel.INFO) {
              this.logger.info(
                `Partial TP1 for ${position.symbol}: 1R reached, closing 50% and moving stop to breakeven`
              );
            }
            const result = await this.orderExecutor.executePartialClose(position, 0.5);
            if (!result.success) {
              this.logger.warn(`Partial close failed for ${position.symbol}: ${result.error}`);
            }
            this.riskManager.applyBreakevenStop(position);
            st.tp1Done = true;
            st.breakevenApplied = true;
            st.flatCycles = 0; // Reset flat counter on profit
            this.stateBySymbol.set(key, st);
            decisions.push({
              type: 'tp1',
              action: 'partial_close_50pct',
              reason: `1R reached (${rMultiple.toFixed(2)}), closed 50% and moved stop to breakeven`,
              details: {
                rMultiple,
                closePercent: 0.5,
                orderSuccess: result.success,
              },
            });
            decisions.push({
              type: 'breakeven',
              action: 'move_stop',
              reason: 'Stop moved to breakeven after TP1',
            });
          }
        } catch (e) {
          this.logger.warn('Partial TP processing error', {
            error: e instanceof Error ? e.message : String(e),
          });
        }

        // Time-based exit: detect flat positions and auto-close after M cycles
        try {
          const absR = Math.abs(rMultiple);
          const isFlat = absR <= ORDER_EXECUTION.FLAT_R_MULTIPLE_THRESHOLD;

          if (isFlat) {
            st.flatCycles = (st.flatCycles || 0) + 1;

            // After N cycles flat, move stop to breakeven (if not already)
            if (
              !st.breakevenApplied &&
              st.flatCycles >= ORDER_EXECUTION.FLAT_CYCLES_BEFORE_BREAKEVEN
            ) {
              // Actioned change: apply breakeven stop once; log concise, context-rich line
              this.riskManager.applyBreakevenStop(position);
              st.breakevenApplied = true;
              if (this.logger.getConfig().level <= LogLevel.INFO) {
                // Determine stop loss price (priority: customStopLoss > trailingStopPrice > calculated default)
                const stopLossPrice =
                  position.customStopLoss ??
                  position.trailingStopPrice ??
                  this.riskManager.calculateStopLoss(position, currentPrice);
                // Determine take profit price (priority: customTakeProfit > calculated default)
                const takeProfitPrice =
                  position.customTakeProfit ??
                  this.riskManager.calculateTakeProfit(position, currentPrice);
                this.logger.info(
                  `Exit policy: breakeven applied | symbol=${position.symbol} side=${position.side} size=${position.size} cycles=${st.flatCycles} r=${rMultiple.toFixed(2)} stop=@${stopLossPrice.toFixed(2)} tp=@${takeProfitPrice.toFixed(2)}`
                );
              }
              decisions.push({
                type: 'breakeven',
                action: 'move_stop',
                reason: `Flat for ${st.flatCycles} cycles, moved stop to breakeven`,
                details: {
                  flatCycles: st.flatCycles,
                  rMultiple,
                },
              });
            }

            // After M cycles flat, auto-close
            if (st.flatCycles >= ORDER_EXECUTION.FLAT_CYCLES_BEFORE_AUTO_CLOSE) {
              const reason = `flat-auto-close | cycles=${st.flatCycles} r<=${ORDER_EXECUTION.FLAT_R_MULTIPLE_THRESHOLD}`;
              decisions.push({
                type: 'auto_close',
                action: 'close',
                reason,
                details: {
                  flatCycles: st.flatCycles,
                  rMultiple,
                  threshold: ORDER_EXECUTION.FLAT_R_MULTIPLE_THRESHOLD,
                },
              });
              await this.executePositionClose(position, currentPrice, reason);
              this.stateBySymbol.delete(key); // Clean up state
              return {
                symbol: position.symbol,
                side: position.side,
                decisions,
              };
            }
          } else {
            // Reset flat counter when position moves
            st.flatCycles = 0;
          }

          this.stateBySymbol.set(key, st);
        } catch (e) {
          this.logger.warn('Time-based exit processing error', {
            error: e instanceof Error ? e.message : String(e),
          });
        }

        // Check if position should be closed by stops/targets
        const { shouldClose, reason } = this.shouldClosePosition(position, currentPrice);
        if (shouldClose) {
          let decisionType: 'stop_loss' | 'take_profit' | 'emergency' = 'stop_loss';
          if (reason.includes('Take profit')) decisionType = 'take_profit';
          else if (reason.includes('Emergency')) decisionType = 'emergency';

          decisions.push({
            type: decisionType,
            action: 'close',
            reason,
            details: {
              currentPrice,
              entryPrice: position.entryPrice,
            },
          });
          await this.executePositionClose(position, currentPrice, reason);
          this.stateBySymbol.delete(key); // Clean up state on close
        }

        return {
          symbol: position.symbol,
          side: position.side,
          decisions,
        };
      } catch (error) {
        const isLastAttempt = attempt === MAX_RETRIES;

        if (isLastAttempt) {
          this.logger.error(
            `Failed to monitor ${position.symbol} after ${MAX_RETRIES} attempts`,
            error
          );
          // Return decision info for failed monitoring
          return {
            symbol: position.symbol,
            side: position.side,
            decisions: [
              {
                type: 'emergency' as const,
                action: 'monitor_failed',
                reason: error instanceof Error ? error.message : String(error),
              },
            ],
          };
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
   * Extract base currency from symbol (e.g., BTC from BTC/USDT)
   */
  private getBaseCurrency(symbol: string): string {
    return symbol.split('/')[0].toUpperCase();
  }

  /**
   * Format position size with symbol unit for display
   * @example formatPositionSize(0.01625143, 'BTC/USDT') => "0.01625143 BTC"
   */
  private formatPositionSize(size: number, symbol: string): string {
    const baseCurrency = this.getBaseCurrency(symbol);
    const formattedSize = size.toFixed(6).replace(/\.?0+$/, '');
    return `${formattedSize} ${baseCurrency}`;
  }

  /**
   * Format price with thousand separators for readability
   * @example formatPrice(111037.50) => "111,037.50"
   */
  private formatPrice(price: number): string {
    return price.toLocaleString(undefined, {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    });
  }

  /**
   * Parse reason string to extract base reason and context
   * Handles format: "flat-auto-close | cycles=8 r<=0.25"
   */
  private parseReasonWithContext(reason: string): {
    baseReason: string;
    context?: { cycles?: number; rMultiple?: string };
  } {
    if (!reason.includes('flat-auto-close')) {
      return { baseReason: reason };
    }

    // Extract base reason (before the | separator)
    const baseReason = reason.split('|')[0]?.trim() || 'flat-auto-close';

    // Extract context using regex
    const cyclesMatch = reason.match(/cycles=(\d+)/);
    const rMatch = reason.match(/r<=([0-9.]+)/);

    const context: { cycles?: number; rMultiple?: string } = {};
    if (cyclesMatch) {
      context.cycles = parseInt(cyclesMatch[1], 10);
    }
    if (rMatch) {
      context.rMultiple = rMatch[1];
    }

    return {
      baseReason,
      context: Object.keys(context).length > 0 ? context : undefined,
    };
  }

  /**
   * Format context parts for log message
   */
  private formatContextParts(context: { cycles?: number; rMultiple?: string }): string {
    const parts: string[] = [];
    if (context.cycles !== undefined) {
      parts.push(`cycles=${context.cycles}`);
    }
    if (context.rMultiple !== undefined) {
      parts.push(`r≤${context.rMultiple}`);
    }
    return parts.length > 0 ? ` | ${parts.join(' ')}` : '';
  }

  /**
   * Format position close log message consistently with other logs
   * Follows format: "Position closed | symbol=... side=... size=... price=... reason=... | context"
   */
  private formatPositionCloseLog(position: Position, currentPrice: number, reason: string): string {
    const { baseReason, context } = this.parseReasonWithContext(reason);

    const parts = [
      `symbol=${position.symbol}`,
      `side=${position.side.toUpperCase()}`,
      `size=${this.formatPositionSize(position.size, position.symbol)}`,
      `price=${this.formatPrice(currentPrice)}`,
      `reason=${baseReason}`,
    ];

    const baseMessage = `Position closed | ${parts.join(' ')}`;
    const contextSuffix = context ? this.formatContextParts(context) : '';

    return baseMessage + contextSuffix;
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
      // Emit a concise, context-rich close log with consistent formatting
      const formattedLog = this.formatPositionCloseLog(position, currentPrice, reason);
      this.logger.info(formattedLog);
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

import type { Exchange } from '../exchange/types.js';
import type { Position, Account } from '../exchange/types.js';
import type { UnifiedLogger } from '../logging/index.js';
import type { RiskSnapshot } from './types/trading-manager.js';

/**
 * Aggregator for generating risk snapshots from exchange data
 * Handles both exchange-native portfolio metrics and fallback calculations
 */
export class RiskSnapshotAggregator {
  private logger: UnifiedLogger;
  private readonly context: string;

  constructor(logger: UnifiedLogger, context: string) {
    this.logger = logger;
    this.context = context;
  }

  /**
   * Generate a risk snapshot from account and positions data
   * @param account Current account state
   * @param positions Current positions
   * @param exchange Exchange instance (for portfolio metrics if available)
   * @returns Risk snapshot or null if generation fails
   */
  async generateRiskSnapshot(
    account: Account,
    positions: Position[],
    exchange: Exchange
  ): Promise<RiskSnapshot | null> {
    try {
      const maybePM = exchange as unknown as Partial<ExchangeWithPortfolioMetrics>;
      if (typeof maybePM.getPortfolioMetrics === 'function') {
        return this.generateFromPortfolioMetrics(account, positions, exchange);
      } else {
        return this.generateFallbackRiskSnapshot(account, positions);
      }
    } catch (error) {
      this.logger.warn(
        'Risk snapshot generation failed',
        error instanceof Error ? { error: error.message } : { error: String(error) },
        this.context
      );
      return null;
    }
  }

  /**
   * Generate risk snapshot using exchange portfolio metrics
   */
  private async generateFromPortfolioMetrics(
    account: Account,
    positions: Position[],
    exchange: Exchange
  ): Promise<RiskSnapshot | null> {
    try {
      const exchangeWithPM = exchange as unknown as ExchangeWithPortfolioMetrics;
      const pm = await exchangeWithPM.getPortfolioMetrics();

      const portfolioMetrics = this.calculatePortfolioMetrics(positions);
      const correlationScore = this.calculateCorrelationScore(positions);
      const diversificationScore = this.calculateDiversificationScore(positions);

      const risk: RiskSnapshot = {
        timestamp: Date.now(),
        marginRatio: account.marginRatio,
        usedMargin: account.usedMargin,
        availableMargin: account.availableMargin,
        leverage: pm.leverage,
        totalExposure: pm.totalExposure,
        exposureBySymbol: pm.exposureBySymbol,
        averageLeverage: portfolioMetrics.averageLeverage,
        correlationScore,
        diversificationScore,
        flags: [],
      };

      // Add risk flags
      this.addRiskFlags(risk, account, pm.totalUnrealizedPnl);

      return risk;
    } catch (error) {
      this.logger.warn(
        'Risk snapshot from portfolio metrics failed',
        error instanceof Error ? { error: error.message } : { error: String(error) },
        this.context
      );
      return null;
    }
  }

  /**
   * Generate risk snapshot using fallback calculations
   */
  private generateFallbackRiskSnapshot(
    account: Account,
    positions: Position[]
  ): RiskSnapshot | null {
    try {
      // Compute exposure by symbol (unlevered)
      const exposureBySymbol: Record<string, number> = {};
      let totalExposure = 0;

      for (const p of positions) {
        // Validate markPrice before calculating exposure
        const validPrice = p.markPrice > 0 && isFinite(p.markPrice) ? p.markPrice : 0;
        const value = Math.abs((p.size || 0) * validPrice);
        exposureBySymbol[p.symbol] = (exposureBySymbol[p.symbol] || 0) + value;
        totalExposure += value;
      }

      const leverage = account.equity > 0 ? totalExposure / account.equity : 0;

      const portfolioMetrics = this.calculatePortfolioMetrics(positions);
      const correlationScore = this.calculateCorrelationScore(positions);
      const diversificationScore = this.calculateDiversificationScore(positions);

      const risk: RiskSnapshot = {
        timestamp: Date.now(),
        marginRatio: account.marginRatio,
        usedMargin: account.usedMargin,
        availableMargin: account.availableMargin,
        leverage,
        totalExposure,
        exposureBySymbol,
        averageLeverage: portfolioMetrics.averageLeverage,
        correlationScore,
        diversificationScore,
        flags: [],
      };

      // Calculate approximate unrealized PnL for drawdown flag
      const totalUnrealizedPnl = positions.reduce((s, p) => s + (p.unrealizedPnl || 0), 0);

      // Add risk flags
      this.addRiskFlags(risk, account, totalUnrealizedPnl);

      return risk;
    } catch (error) {
      this.logger.warn(
        'Fallback risk snapshot generation failed',
        error instanceof Error ? { error: error.message } : { error: String(error) },
        this.context
      );
      return null;
    }
  }

  /**
   * Calculate portfolio metrics from positions
   */
  private calculatePortfolioMetrics(positions: Position[]): { averageLeverage: number } {
    const avgLev =
      positions.length > 0
        ? positions.reduce((sum, p) => sum + (p.leverage || 0), 0) / positions.length
        : 0;
    return {
      averageLeverage: Number.isFinite(avgLev) ? avgLev : 0,
    };
  }

  /**
   * Calculate correlation score based on position sides
   */
  private calculateCorrelationScore(positions: Position[]): number {
    const sides = positions.map(p => p.side);
    const allSameSide = sides.length > 0 && sides.every(side => side === sides[0]);
    let correlationScore = allSameSide ? 0.8 : 0.3;
    correlationScore = Math.min(
      1,
      correlationScore * (positions.length > 0 ? 3 / positions.length : 1)
    );
    return Math.max(0, Math.min(1, correlationScore));
  }

  /**
   * Calculate diversification score based on unique symbols and position sides
   */
  private calculateDiversificationScore(positions: Position[]): number {
    if (positions.length === 0) return 1;
    if (positions.length === 1) return 1;

    const uniqueSymbols = new Set(positions.map(p => p.symbol)).size;
    const diversificationBase = uniqueSymbols / positions.length;

    const sides = positions.map(p => p.side);
    const allSameSide = sides.length > 0 && sides.every(side => side === sides[0]);

    const diversificationScore = allSameSide ? diversificationBase * 0.7 : diversificationBase;
    return Math.max(0, Math.min(1, diversificationScore));
  }

  /**
   * Add risk flags to the snapshot based on current state
   */
  private addRiskFlags(risk: RiskSnapshot, account: Account, totalUnrealizedPnl: number): void {
    if (risk.marginRatio > 0.5) {
      risk.flags.push('High margin usage');
    }
    if (account.equity > 0 && totalUnrealizedPnl < -account.equity * 0.05) {
      risk.flags.push('Drawdown > 5%');
    }
  }
}

interface ExchangeWithPortfolioMetrics extends Exchange {
  getPortfolioMetrics: () => Promise<{
    leverage: number;
    totalExposure: number;
    exposureBySymbol: Record<string, number>;
    totalUnrealizedPnl: number;
  }>;
}

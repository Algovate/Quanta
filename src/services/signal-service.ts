/**
 * Signal Service Implementation
 * Wraps existing signal generation logic
 */

import type { SignalService } from './interfaces/signal-service.js';
import type { TradingSignal, MarketData } from '../types/index.js';
import type { Account, Position } from '../exchange/types.js';
import type { OpenRouterClient } from '../ai/agent.js';
import type { RiskManager } from '../execution/risk.js';

export class SignalServiceImpl implements SignalService {
  constructor(
    private aiAgent: OpenRouterClient,
    private riskManager: RiskManager
  ) {}

  async generateSignals(
    marketData: MarketData[],
    account: Account,
    positions: Position[]
  ): Promise<TradingSignal[]> {
    // Delegate to AI agent
    // Generate signals for each market data entry
    const allSignals: TradingSignal[] = [];
    for (const md of marketData) {
      // Cast to MarketData from data/market.ts (has additional indicator fields)
      // generateTradingSignal returns TradingSignal[], not a single signal
      const signals = await this.aiAgent.generateTradingSignal([md as any], account, positions, {
        startTime: Date.now(),
        currentTime: Date.now(),
        invokeCount: 0,
        tradableCoins: marketData.map(m => m.coin),
        maxPositions: 5,
        maxRiskPerTrade: 0.02,
        maxLeverage: 10,
        minLeverage: 1,
        defaultStopLoss: 0.03,
      });
      if (signals && signals.length > 0) {
        allSignals.push(...signals);
      }
    }
    return allSignals;
  }

  validateSignal(signal: TradingSignal, account: Account, positions: Position[]): boolean {
    // Delegate to risk manager's signal validator
    const result = this.riskManager.validateSignal(signal, account, positions);
    return result.valid;
  }

  calculateQualityScore(signal: TradingSignal, marketData: MarketData[]): number {
    // Delegate to risk manager's signal validator
    const validator = this.riskManager.getSignalValidator();
    const coinMarketData = marketData.find(md => md.coin === signal.coin);
    const indicators = coinMarketData?.indicators;

    const coinMultiTimeframeData = marketData
      .filter(md => md.coin === signal.coin)
      .map(md => ({
        timeframe: md.timeframe,
        trend: md.trend,
        indicators: md.indicators,
      }));

    const qualityScore = validator.calculateSignalQuality(
      signal,
      indicators,
      coinMultiTimeframeData
    );
    return qualityScore.score;
  }
}

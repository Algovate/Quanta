/**
 * Technical Strategy Implementation
 * Rule-based technical analysis strategy
 */

import { BaseStrategy, type StrategyContext, type StrategyResult } from './base-strategy.js';
import type { TradingSignal } from '../types/index.js';

export class TechnicalStrategy extends BaseStrategy {
  async generateSignals(context: StrategyContext): Promise<StrategyResult> {
    const signals: TradingSignal[] = [];

    // Simple technical strategy: RSI + EMA crossover
    for (const marketData of context.marketData) {
      const indicators = marketData.indicators;
      if (!indicators) continue;

      const coin = marketData.coin;
      const currentPrice = marketData.currentPrice;

      // Check for existing position
      const existingPosition = context.positions.find(p => p.symbol === `${coin}/USDT`);

      // RSI strategy (use rsi14 from TechnicalIndicators)
      if (indicators.rsi14 && indicators.ema20 && indicators.ema50) {
        const rsi = indicators.rsi14;
        // Long signal: RSI oversold + EMA crossover
        if (!existingPosition && rsi < 30 && indicators.ema20 > indicators.ema50) {
          signals.push({
            coin,
            action: 'LONG',
            confidence: 0.7,
            reasoning: `RSI oversold (${rsi.toFixed(1)}) with bullish EMA crossover`,
            entry_price: currentPrice,
            stop_loss: currentPrice * 0.03, // 3% stop loss
            profit_target: currentPrice * 0.06, // 6% profit target
          });
        }
        // Short signal: RSI overbought + EMA crossover
        else if (!existingPosition && rsi > 70 && indicators.ema20 < indicators.ema50) {
          signals.push({
            coin,
            action: 'SHORT',
            confidence: 0.7,
            reasoning: `RSI overbought (${rsi.toFixed(1)}) with bearish EMA crossover`,
            entry_price: currentPrice,
            stop_loss: currentPrice * 0.03, // 3% stop loss
            profit_target: currentPrice * 0.06, // 6% profit target
          });
        }
        // Close signal: RSI reversal
        else if (existingPosition) {
          const isLong = existingPosition.side === 'long';
          if ((isLong && rsi > 70) || (!isLong && rsi < 30)) {
            signals.push({
              coin,
              action: 'CLOSE',
              confidence: 0.8,
              reasoning: `RSI reversal signal (${rsi.toFixed(1)})`,
            });
          }
        }
      }
    }

    return {
      signals,
      metadata: {
        strategy: this.config.name,
        confidence:
          signals.length > 0
            ? signals.reduce((sum, s) => sum + s.confidence, 0) / signals.length
            : 0,
        reasoning: `Technical analysis signals using RSI and EMA`,
      },
    };
  }
}

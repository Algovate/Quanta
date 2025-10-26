import { Exchange } from '../exchange/types';

export interface Candlestick {
  timestamp: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

export interface TechnicalIndicators {
  ema20: number;
  ema50: number;
  macd: {
    macd: number;
    signal: number;
    histogram: number;
  };
  rsi7: number;
  rsi14: number;
  atr3: number;
  atr14: number;
}

export interface MarketData {
  coin: string;
  timeframe: string;
  candlesticks: Candlestick[];
  indicators: TechnicalIndicators;
  currentPrice: number;
  trend: 'bullish' | 'bearish' | 'sideways';
  volatility: 'low' | 'medium' | 'high';
}

export class MarketDataProvider {
  constructor(private exchange: Exchange) {}

  async getMarketData(coin: string, timeframes: string[] = ['3m', '4h']): Promise<MarketData[]> {
    const marketData: MarketData[] = [];

    for (const timeframe of timeframes) {
      try {
        // Fetch candlestick data
        const candlesticks = (await this.exchange.getCandlesticks(
          coin,
          timeframe,
          100
        )) as Candlestick[];

        if (candlesticks.length < 50) {
          console.warn(
            `Insufficient data for ${coin} ${timeframe}: ${candlesticks.length} candles`
          );
          continue;
        }

        // Calculate technical indicators
        const indicators = this.calculateIndicators(candlesticks);

        // Determine trend and volatility
        const trend = this.determineTrend(candlesticks, indicators);
        const volatility = this.calculateVolatility(candlesticks);

        marketData.push({
          coin,
          timeframe,
          candlesticks,
          indicators,
          currentPrice: candlesticks[candlesticks.length - 1].close,
          trend,
          volatility,
        });
      } catch (error) {
        console.error(`Error fetching market data for ${coin} ${timeframe}:`, error);
      }
    }

    return marketData;
  }

  private calculateIndicators(candlesticks: Candlestick[]): TechnicalIndicators {
    const closes = candlesticks.map(c => c.close);
    const highs = candlesticks.map(c => c.high);
    const lows = candlesticks.map(c => c.low);

    return {
      ema20: this.calculateEMA(closes, 20),
      ema50: this.calculateEMA(closes, 50),
      macd: this.calculateMACD(closes),
      rsi7: this.calculateRSI(closes, 7),
      rsi14: this.calculateRSI(closes, 14),
      atr3: this.calculateATR(highs, lows, closes, 3),
      atr14: this.calculateATR(highs, lows, closes, 14),
    };
  }

  private calculateEMA(prices: number[], period: number): number {
    if (prices.length < period) return prices[prices.length - 1];

    const multiplier = 2 / (period + 1);
    let ema = prices.slice(0, period).reduce((sum, price) => sum + price, 0) / period;

    for (let i = period; i < prices.length; i++) {
      ema = prices[i] * multiplier + ema * (1 - multiplier);
    }

    return ema;
  }

  private calculateMACD(prices: number[]): { macd: number; signal: number; histogram: number } {
    const ema12 = this.calculateEMA(prices, 12);
    const ema26 = this.calculateEMA(prices, 26);
    const macd = ema12 - ema26;

    // For simplicity, we'll use a basic signal line calculation
    // In a real implementation, you'd maintain MACD history for proper signal calculation
    const signal = macd * 0.9; // Simplified signal line
    const histogram = macd - signal;

    return { macd, signal, histogram };
  }

  private calculateRSI(prices: number[], period: number): number {
    if (prices.length < period + 1) return 50;

    let gains = 0;
    let losses = 0;

    for (let i = 1; i <= period; i++) {
      const change = prices[i] - prices[i - 1];
      if (change > 0) gains += change;
      else losses -= change;
    }

    const avgGain = gains / period;
    const avgLoss = losses / period;

    if (avgLoss === 0) return 100;

    const rs = avgGain / avgLoss;
    return 100 - 100 / (1 + rs);
  }

  private calculateATR(highs: number[], lows: number[], closes: number[], period: number): number {
    if (highs.length < period + 1) return 0;

    const trueRanges: number[] = [];

    for (let i = 1; i < highs.length; i++) {
      const tr1 = highs[i] - lows[i];
      const tr2 = Math.abs(highs[i] - closes[i - 1]);
      const tr3 = Math.abs(lows[i] - closes[i - 1]);
      trueRanges.push(Math.max(tr1, tr2, tr3));
    }

    return trueRanges.slice(-period).reduce((sum, tr) => sum + tr, 0) / period;
  }

  private determineTrend(
    candlesticks: Candlestick[],
    indicators: TechnicalIndicators
  ): 'bullish' | 'bearish' | 'sideways' {
    const recentCandles = candlesticks.slice(-10);
    const priceChange =
      (recentCandles[recentCandles.length - 1].close - recentCandles[0].close) /
      recentCandles[0].close;

    // Trend determination based on multiple factors
    const emaTrend = indicators.ema20 > indicators.ema50 ? 1 : -1;
    const macdTrend = indicators.macd.macd > indicators.macd.signal ? 1 : -1;
    const priceTrend = priceChange > 0.02 ? 1 : priceChange < -0.02 ? -1 : 0;

    const trendScore = emaTrend + macdTrend + priceTrend;

    if (trendScore >= 2) return 'bullish';
    if (trendScore <= -2) return 'bearish';
    return 'sideways';
  }

  private calculateVolatility(candlesticks: Candlestick[]): 'low' | 'medium' | 'high' {
    if (candlesticks.length < 20) return 'medium';

    const recentCandles = candlesticks.slice(-20);
    const returns = [];

    for (let i = 1; i < recentCandles.length; i++) {
      const return_ =
        (recentCandles[i].close - recentCandles[i - 1].close) / recentCandles[i - 1].close;
      returns.push(Math.abs(return_));
    }

    const avgVolatility = returns.reduce((sum, ret) => sum + ret, 0) / returns.length;

    if (avgVolatility < 0.01) return 'low';
    if (avgVolatility > 0.03) return 'high';
    return 'medium';
  }
}

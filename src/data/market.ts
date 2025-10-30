import { Exchange } from '../exchange/types.js';

export interface Candlestick {
  timestamp: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

export interface TechnicalIndicators {
  // Moving averages
  sma5?: number;
  sma20?: number;
  sma50?: number;
  ema5?: number;
  ema20: number;
  ema50: number;
  macd: {
    macd: number;
    signal: number;
    histogram: number;
  };
  // Momentum & volatility
  rsi7: number;
  rsi14: number;
  atr3: number;
  atr14: number;
  // Bands
  bollinger?: {
    upper: number;
    middle: number;
    lower: number;
    percentB: number;
    bandwidth: number;
    position: 'above' | 'upper' | 'middle' | 'lower' | 'below';
  };
  // Structure levels
  supportResistance?: {
    support: number | null;
    resistance: number | null;
    distToSupport: number | null;
    distToResistance: number | null;
  };
  // Volume metrics
  volume?: {
    sma20: number;
    ratio: number;
    obv?: number;
  };
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
          // Silent skip during backtesting
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
    const volumes = candlesticks.map(c => c.volume);

    const ema20 = this.calculateEMA(closes, 20);
    const ema50 = this.calculateEMA(closes, 50);
    const ema5 = this.calculateEMA(closes, 5);
    const sma5 = this.calculateSMA(closes, 5);
    const sma20 = this.calculateSMA(closes, 20);
    const sma50 = this.calculateSMA(closes, 50);
    const macd = this.calculateMACD(closes);
    const rsi7 = this.calculateRSI(closes, 7);
    const rsi14 = this.calculateRSI(closes, 14);
    const atr3 = this.calculateATR(highs, lows, closes, 3);
    const atr14 = this.calculateATR(highs, lows, closes, 14);
    const bollinger = this.calculateBollinger(closes, 20, 2);
    const supportResistance = this.calculateSupportResistance(candlesticks, 5);
    const volume = this.calculateVolumeStats(closes, volumes, 20);

    return {
      sma5,
      sma20,
      sma50,
      ema5,
      ema20,
      ema50,
      macd,
      rsi7,
      rsi14,
      atr3,
      atr14,
      bollinger: bollinger ?? undefined,
      supportResistance,
      volume,
    };
  }

  private calculateSMA(values: number[], period: number): number | undefined {
    if (values.length < period) return undefined;
    const slice = values.slice(-period);
    const sum = slice.reduce((acc, v) => acc + v, 0);
    return sum / period;
  }

  private calculateStdDev(values: number[], period: number): number | undefined {
    if (values.length < period) return undefined;
    const slice = values.slice(-period);
    const mean = slice.reduce((acc, v) => acc + v, 0) / period;
    const variance = slice.reduce((acc, v) => acc + (v - mean) * (v - mean), 0) / period;
    return Math.sqrt(variance);
  }

  private calculateBollinger(
    closes: number[],
    period: number = 20,
    k: number = 2
  ): {
    upper: number;
    middle: number;
    lower: number;
    percentB: number;
    bandwidth: number;
    position: 'above' | 'upper' | 'middle' | 'lower' | 'below';
  } | null {
    const middle = this.calculateSMA(closes, period);
    const std = this.calculateStdDev(closes, period);
    if (middle === undefined || std === undefined) return null;
    const upper = middle + k * std;
    const lower = middle - k * std;
    const last = closes[closes.length - 1];
    const width = upper - lower;
    const percentB = width !== 0 ? (last - lower) / width : 0.5;
    const bandwidth = middle !== 0 ? width / middle : 0;
    let position: 'above' | 'upper' | 'middle' | 'lower' | 'below' = 'middle';
    if (last > upper) position = 'above';
    else if (last >= middle && last <= upper) position = 'upper';
    else if (last >= lower && last < middle) position = 'lower';
    else if (last < lower) position = 'below';
    return { upper, middle, lower, percentB, bandwidth, position };
  }

  private calculateSupportResistance(
    candles: Candlestick[],
    lookback: number = 5
  ): {
    support: number | null;
    resistance: number | null;
    distToSupport: number | null;
    distToResistance: number | null;
  } {
    if (candles.length < lookback + 2) {
      return { support: null, resistance: null, distToSupport: null, distToResistance: null };
    }
    const recent = candles.slice(-(lookback + 2));
    let support: number | null = null;
    let resistance: number | null = null;
    // Simple pivot-based: local minima/maxima in the window
    for (let i = 1; i < recent.length - 1; i++) {
      const prev = recent[i - 1];
      const curr = recent[i];
      const next = recent[i + 1];
      if (curr.low < prev.low && curr.low < next.low) {
        support = support == null ? curr.low : Math.max(support, curr.low);
      }
      if (curr.high > prev.high && curr.high > next.high) {
        resistance = resistance == null ? curr.high : Math.min(resistance, curr.high);
      }
    }
    const lastClose = recent[recent.length - 1].close;
    const distToSupport = support != null ? (lastClose - support) / lastClose : null;
    const distToResistance = resistance != null ? (resistance - lastClose) / lastClose : null;
    return { support, resistance, distToSupport, distToResistance };
  }

  private calculateVolumeStats(
    closes: number[],
    volumes: number[],
    period: number = 20
  ): { sma20: number; ratio: number; obv?: number } | undefined {
    if (volumes.length < period) return undefined;
    const volSMA = this.calculateSMA(volumes, period);
    if (volSMA === undefined) return undefined;
    const lastVol = volumes[volumes.length - 1];
    const ratio = volSMA !== 0 ? lastVol / volSMA : 1;
    // OBV optional: cumulative based on close change sign
    if (closes.length < 2) return { sma20: volSMA, ratio };
    let obv = 0;
    for (let i = 1; i < closes.length; i++) {
      if (closes[i] > closes[i - 1]) obv += volumes[i];
      else if (closes[i] < closes[i - 1]) obv -= volumes[i];
    }
    return { sma20: volSMA, ratio, obv };
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
    if (prices.length < 26) {
      return { macd: 0, signal: 0, histogram: 0 };
    }

    // Calculate MACD line (12-period EMA - 26-period EMA)
    const ema12 = this.calculateEMA(prices, 12);
    const ema26 = this.calculateEMA(prices, 26);
    const macd = ema12 - ema26;

    // Calculate signal line (9-period EMA of MACD)
    // For a proper signal line, we need to calculate MACD for each period
    // and then apply EMA to those MACD values
    const macdValues: number[] = [];

    // Calculate MACD for the last 35 periods (26 for EMA26 + 9 for signal)
    const startIdx = Math.max(0, prices.length - 35);
    for (let i = startIdx; i < prices.length; i++) {
      const subset = prices.slice(0, i + 1);
      if (subset.length >= 26) {
        const ema12Temp = this.calculateEMA(subset, 12);
        const ema26Temp = this.calculateEMA(subset, 26);
        macdValues.push(ema12Temp - ema26Temp);
      }
    }

    // Calculate 9-period EMA of MACD values for signal line
    const signal = macdValues.length >= 9 ? this.calculateEMA(macdValues, 9) : macd * 0.9;
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

// Re-export types from centralized location
export * from '../types/index.js';

// Keep existing schemas for backward compatibility
import { z } from 'zod';

// Candlestick data structure
export const CandlestickSchema = z.object({
  timestamp: z.number(),
  open: z.number(),
  high: z.number(),
  low: z.number(),
  close: z.number(),
  volume: z.number(),
});

// Account information
export const AccountSchema = z.object({
  balance: z.number(),
  equity: z.number(),
  availableMargin: z.number(),
  usedMargin: z.number(),
  marginRatio: z.number(),
  timestamp: z.number(),
});

// Position information
export const PositionSchema = z.object({
  symbol: z.string(),
  side: z.enum(['long', 'short']),
  size: z.number(),
  entryPrice: z.number(),
  markPrice: z.number(),
  unrealizedPnl: z.number(),
  marginUsed: z.number(),
  leverage: z.number(),
  timestamp: z.number(),
});

// Trading signal from AI
export const TradingSignalSchema = z.object({
  coin: z.string(),
  action: z.enum(['LONG', 'SHORT', 'CLOSE', 'HOLD']),
  confidence: z.number().min(0).max(1),
  reasoning: z.string(),
  entry_price: z.number().optional(),
  position_size: z.number().optional(),
  stop_loss: z.number().optional(),
  profit_target: z.number().optional(),
  invalidation_condition: z.string().optional(),
});

// Market data with indicators
export const TechnicalIndicatorsSchema = z.object({
  // Moving averages
  sma5: z.number().optional(),
  sma20: z.number().optional(),
  sma50: z.number().optional(),
  ema5: z.number().optional(),
  ema20: z.number(),
  ema50: z.number(),
  macd: z.object({
    macd: z.number(),
    signal: z.number(),
    histogram: z.number(),
  }),
  // Momentum & volatility
  rsi14: z.number(),
  atr14: z.number(),
  // Bollinger Bands
  bollinger: z
    .object({
      upper: z.number(),
      middle: z.number(),
      lower: z.number(),
      percentB: z.number(),
      bandwidth: z.number(),
      position: z.enum(['above', 'upper', 'middle', 'lower', 'below']),
    })
    .optional(),
  // Support and resistance
  supportResistance: z
    .object({
      support: z.number().nullable(),
      resistance: z.number().nullable(),
      distToSupport: z.number().nullable(),
      distToResistance: z.number().nullable(),
    })
    .optional(),
  // Volume metrics
  volume: z
    .object({
      sma20: z.number(),
      ratio: z.number(),
      obv: z.number().optional(),
    })
    .optional(),
});

export const MarketDataSchema = z.object({
  coin: z.string(),
  timeframe: z.string(),
  currentPrice: z.number(),
  trend: z.enum(['bullish', 'bearish', 'sideways']),
  volatility: z.enum(['low', 'medium', 'high']),
  candlesticks: z.array(CandlestickSchema),
  indicators: TechnicalIndicatorsSchema,
});

// Order information
export const OrderSchema = z.object({
  id: z.string(),
  symbol: z.string(),
  side: z.enum(['buy', 'sell']),
  amount: z.number(),
  price: z.number(),
  status: z.string(),
  timestamp: z.number(),
});

// AI error response
export const AIErrorSchema = z.object({
  error: z.string(),
  message: z.string(),
});

// Exit plan for positions
export const ExitPlanSchema = z.object({
  stopLoss: z.number(),
  takeProfit: z.number(),
  invalidationCondition: z.string(),
});

// System state
export const SystemStateSchema = z.object({
  isRunning: z.boolean(),
  cycleCount: z.number(),
  startTime: z.number(),
  lastUpdate: z.number(),
  totalSignals: z.number(),
  totalTrades: z.number(),
  totalPnl: z.number(),
  winRate: z.number(),
});

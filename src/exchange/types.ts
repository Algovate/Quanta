import { z } from 'zod';

// Exchange data types
export const CandlestickSchema = z.object({
  timestamp: z.number(),
  open: z.number(),
  high: z.number(),
  low: z.number(),
  close: z.number(),
  volume: z.number(),
});

export const PositionSchema = z.object({
  symbol: z.string(),
  side: z.enum(['long', 'short']),
  size: z.number(),
  entryPrice: z.number(),
  markPrice: z.number(),
  unrealizedPnl: z.number(),
  percentage: z.number(),
  leverage: z.number(),
});

export const AccountSchema = z.object({
  balance: z.number(),
  equity: z.number(),
  marginUsed: z.number(),
  marginAvailable: z.number(),
  unrealizedPnl: z.number(),
});

export const OrderSchema = z.object({
  id: z.string(),
  symbol: z.string(),
  side: z.enum(['buy', 'sell']),
  type: z.enum(['market', 'limit', 'stop']),
  amount: z.number(),
  price: z.number().optional(),
  status: z.enum(['open', 'filled', 'cancelled', 'rejected']),
  timestamp: z.number(),
});

// AI response types
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

// Market data types
export const MarketDataSchema = z.object({
  symbol: z.string(),
  timeframe: z.string(),
  candlesticks: z.array(CandlestickSchema),
  indicators: z.object({
    ema20: z.number().optional(),
    ema50: z.number().optional(),
    macd: z.object({
      macd: z.number(),
      signal: z.number(),
      histogram: z.number(),
    }).optional(),
    rsi7: z.number().optional(),
    rsi14: z.number().optional(),
    atr3: z.number().optional(),
    atr14: z.number().optional(),
  }),
  latestPrice: z.number(),
  recentCandlesticks: z.object({
    '3m': z.array(CandlestickSchema),
    '4h': z.array(CandlestickSchema),
  }).optional(),
  trendAnalysis: z.object({
    '3m': z.object({
      direction: z.enum(['up', 'down', 'sideways']),
      strength: z.number(),
      volatility: z.number(),
    }),
    '4h': z.object({
      direction: z.enum(['up', 'down', 'sideways']),
      strength: z.number(),
      volatility: z.number(),
    }),
  }).optional(),
});

// State management types
export const SystemStateSchema = z.object({
  startTime: z.number(),
  invocationCount: z.number(),
  initialBalance: z.number(),
  currentBalance: z.number(),
  totalReturn: z.number(),
  winRate: z.number(),
  maxDrawdown: z.number(),
  activePositions: z.array(PositionSchema),
  recentTrades: z.array(z.object({
    timestamp: z.number(),
    symbol: z.string(),
    action: z.string(),
    price: z.number(),
    amount: z.number(),
    pnl: z.number(),
  })),
});

// Type exports
export type Candlestick = z.infer<typeof CandlestickSchema>;
export type Position = z.infer<typeof PositionSchema>;
export type Account = z.infer<typeof AccountSchema>;
export type Order = z.infer<typeof OrderSchema>;
export type TradingSignal = z.infer<typeof TradingSignalSchema>;
export type MarketData = z.infer<typeof MarketDataSchema>;
export type SystemState = z.infer<typeof SystemStateSchema>;

// Error types
export class TradingError extends Error {
  constructor(message: string, public code?: string) {
    super(message);
    this.name = 'TradingError';
  }
}

export class AIError extends Error {
  constructor(message: string, public model?: string) {
    super(message);
    this.name = 'AIError';
  }
}

export class ExchangeError extends Error {
  constructor(message: string, public exchange?: string) {
    super(message);
    this.name = 'ExchangeError';
  }
}

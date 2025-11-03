import type { Account, Position } from '../types/index.js';

export interface SignalEvent {
  id: string;
  timestamp: number;
  symbol: string;
  action: 'LONG' | 'SHORT' | 'CLOSE' | 'HOLD';
  confidence: number;
  reasoning?: string;
  price?: number;
  strategy?: string;
  status?: 'generated' | 'executed' | 'rejected';
}

export interface OrderEvent {
  id: string;
  timestamp: number;
  symbol: string;
  side: 'buy' | 'sell';
  amount: number;
  price?: number;
  status: string;
  source: string;
  reason: string;
}

export interface TradeEvent {
  id: string; // tradeId (unique trade execution ID)
  orderId: string; // link to originating order
  timestamp: number;
  symbol: string;
  side: 'buy' | 'sell';
  amount: number;
  price: number; // required for trades (execution price)
  fee?: number; // execution fee
  feeAsset?: string; // fee currency (default: USDT)
  realizedPnl?: number; // realized P&L if closing a position
  source: string; // AI, stop-loss, take-profit, etc.
  reason: string; // why this trade was executed
}

export interface RiskSnapshot {
  timestamp: number;
  marginRatio: number;
  usedMargin: number;
  availableMargin: number;
  leverage: number;
  totalExposure: number;
  exposureBySymbol: Record<string, number>;
  // Portfolio quality metrics (0..1). Higher diversification is better; higher correlation is worse
  diversificationScore?: number;
  correlationScore?: number;
  // Average position leverage across open positions
  averageLeverage?: number;
  flags: string[];
}

export type OutboundMessage =
  | { type: 'system:state'; data: unknown }
  | { type: 'account:update'; data: Account }
  | { type: 'position:update'; data: Position[] }
  | { type: 'signal:generated'; data: SignalEvent }
  | { type: 'trade:executed'; data: TradeEvent }
  | { type: 'cycle:complete'; data: unknown }
  | { type: 'kline:update'; data: unknown }
  | { type: 'risk:update'; data: RiskSnapshot }
  | { type: 'order:update'; data: OrderEvent };

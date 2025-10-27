// Core types for BetaArena CLI
export interface ApiResponse<T = unknown> {
  success: boolean;
  data?: T;
  error?: string;
  timestamp: number;
}

export interface ExchangeCredentials {
  apiKey?: string;
  apiSecret?: string;
  passphrase?: string;
  testnet: boolean;
}

export interface ExchangeInfo {
  name: string;
  type: string;
  testnet: boolean;
  enabled: boolean;
}

export interface ValidationResult {
  valid: boolean;
  error?: string;
}

// CCXT specific types
export interface CCXTBalance {
  total: Record<string, number>;
  free: Record<string, number>;
  used: Record<string, number>;
}

export interface CCXTPosition {
  symbol: string;
  side: 'long' | 'short';
  contracts: number;
  entryPrice: number;
  markPrice: number;
  unrealizedPnl: number;
  marginUsed: number;
  leverage: number;
}

export interface CCXTOrder {
  id: string;
  symbol: string;
  side: 'buy' | 'sell';
  amount: number;
  price: number;
  status: string;
}

export interface CCXTCandlestick {
  timestamp: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

// Trading specific types
export interface TradingSignal {
  coin: string;
  action: 'LONG' | 'SHORT' | 'CLOSE' | 'HOLD';
  confidence: number;
  reasoning: string;
  entry_price?: number;
  position_size?: number;
  stop_loss?: number;
  profit_target?: number;
  invalidation_condition?: string;
}

export interface MarketData {
  coin: string;
  timeframe: string;
  currentPrice: number;
  trend: 'bullish' | 'bearish' | 'sideways';
  volatility: 'low' | 'medium' | 'high';
  candlesticks: Candlestick[];
  indicators: TechnicalIndicators;
}

export interface TechnicalIndicators {
  ema20: number;
  ema50: number;
  macd: {
    macd: number;
    signal: number;
    histogram: number;
  };
  rsi14: number;
  atr14: number;
}

export interface Candlestick {
  timestamp: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

export interface Account {
  balance: number;
  equity: number;
  availableMargin: number;
  usedMargin: number;
  marginRatio: number;
  timestamp: number;
}

export interface Position {
  symbol: string;
  side: 'long' | 'short';
  size: number;
  entryPrice: number;
  markPrice: number;
  unrealizedPnl: number;
  marginUsed: number;
  notional: number; // Position value in USD (size * markPrice * leverage)
  leverage: number;
  timestamp: number;
}

export interface Order {
  id: string;
  symbol: string;
  side: 'buy' | 'sell';
  amount: number;
  price: number;
  status: string;
  timestamp: number;
}

// Error types
export class BetaArenaError extends Error {
  constructor(
    message: string,
    public code: string,
    public context?: Record<string, unknown>
  ) {
    super(message);
    this.name = 'BetaArenaError';
  }
}

export class ExchangeError extends BetaArenaError {
  constructor(message: string, context?: Record<string, unknown>) {
    super(message, 'EXCHANGE_ERROR', context);
    this.name = 'ExchangeError';
  }
}

export class AIError extends BetaArenaError {
  constructor(message: string, context?: Record<string, unknown>) {
    super(message, 'AI_ERROR', context);
    this.name = 'AIError';
  }
}

export class ValidationError extends BetaArenaError {
  constructor(message: string, context?: Record<string, unknown>) {
    super(message, 'VALIDATION_ERROR', context);
    this.name = 'ValidationError';
  }
}

// Configuration types
export interface ExchangeConfig {
  name: string;
  apiKey?: string;
  apiSecret?: string;
  testnet: boolean;
  enabled: boolean;
}

export interface AIConfig {
  provider: 'openrouter';
  apiKey: string;
  model: string;
  temperature: number;
}

export interface TradingConfig {
  coins: string[];
  cyclePeriod: number;
  maxPositions: number;
  leverageRange: [number, number];
  defaultStopLoss: number;
  maxRiskPerTrade: number;
  maxTotalRisk: number;
}

export interface UIConfig {
  mode: 'tui' | 'cli';
  refreshRate: number;
}

export interface BacktestConfig {
  startDate?: string;
  endDate?: string;
  initialBalance: number;
}

export interface Config {
  mode: 'live' | 'simulation' | 'backtest';
  dataSources: {
    klineData: ExchangeConfig;
    marketData: ExchangeConfig;
    accountData: ExchangeConfig;
    tradingData: ExchangeConfig;
  };
  ai: AIConfig;
  trading: TradingConfig;
  ui: UIConfig;
  backtest?: BacktestConfig;
}

// Workflow types
export interface SystemState {
  isRunning: boolean;
  cycleCount: number;
  startTime: number;
  lastUpdate: number;
  totalSignals: number;
  totalTrades: number;
  totalPnl: number;
  winRate: number;
}

export interface WorkflowConfig {
  coins: string[];
  cyclePeriod: number;
  maxPositions: number;
  riskParams: {
    maxRiskPerTrade: number;
    maxTotalRisk: number;
    defaultStopLoss: number;
    maxLeverage: number;
    minLeverage: number;
    maxPositions: number;
  };
}

// Exchange interface
export interface Exchange {
  getAccount(): Promise<Account>;
  getPositions(): Promise<Position[]>;
  getCandlesticks(symbol: string, timeframe: string, limit: number): Promise<Candlestick[]>;
  placeOrder(symbol: string, side: 'buy' | 'sell', amount: number, price?: number): Promise<Order>;
  cancelOrder(orderId: string, symbol: string): Promise<boolean>;
  getTicker(symbol: string): Promise<unknown>;
}

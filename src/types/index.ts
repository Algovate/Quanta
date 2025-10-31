// Core types for Quanta CLI

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
  rsi14: number;
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

export interface Candlestick {
  timestamp: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

export interface Account {
  balance: number; // Initial cash + all realized P&L (changes only on position close)
  equity: number; // balance + unrealized P&L (real-time account value)
  availableMargin: number; // Available for trading
  usedMargin: number; // Margin locked in positions
  marginRatio: number; // usedMargin / equity
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
  trailingStopPrice?: number; // Dynamic trailing stop price
  peakPrice?: number; // Highest price seen (for trailing stops)
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
export class QuantaError extends Error {
  constructor(
    message: string,
    public code: string,
    public context?: Record<string, unknown>
  ) {
    super(message);
    this.name = 'QuantaError';
  }
}

export class ExchangeError extends QuantaError {
  constructor(message: string, context?: Record<string, unknown>) {
    super(message, 'EXCHANGE_ERROR', context);
    this.name = 'ExchangeError';
  }
}

export class AIError extends QuantaError {
  constructor(message: string, context?: Record<string, unknown>) {
    super(message, 'AI_ERROR', context);
    this.name = 'AIError';
  }
}

export class ValidationError extends QuantaError {
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

// Backtest types
export interface BacktestConfig {
  startDate: string;
  endDate: string;
  initialBalance: number;
  coins: string[];
  cyclePeriod?: number;
  maxPositions?: number;
  leverage?: number;
  seed?: number;
  backtestExec?: {
    takerFeeRate?: number;
    makerFeeRate?: number;
    maxMarketSlippageBps?: number;
    partialFillProbability?: number;
    minPartialFillRatio?: number;
    maxPartialFillRatio?: number;
    networkLatencyMs?: number;
    latencySlippageBpsPerSec?: number;
  };
}

export interface EquitySnapshot {
  timestamp: number;
  equity: number;
  balance: number;
  unrealizedPnl: number;
}

export interface CompletedTrade {
  id: string;
  symbol: string;
  side: 'long' | 'short';
  entryTime: number;
  exitTime: number;
  entryPrice: number;
  exitPrice: number;
  size: number;
  pnl: number;
  pnlPercent: number;
  holdingPeriod: number; // in seconds
  reason: 'take_profit' | 'stop_loss' | 'signal' | 'end_of_backtest';
}

export interface PerformanceMetrics {
  totalReturn: number; // percentage
  totalPnL: number; // absolute value
  annualizedReturn: number; // percentage
  sharpeRatio: number;
  maxDrawdown: number; // percentage
  maxDrawdownValue: number; // absolute value
  winRate: number; // percentage
  profitFactor: number;
  avgWin: number;
  avgLoss: number;
  totalTrades: number;
  winningTrades: number;
  losingTrades: number;
  avgHoldingPeriod: number; // in hours
  volatility: number; // percentage
  var95: number; // value at risk at 95% confidence
  bestTrade: number;
  worstTrade: number;
  largestWin: number;
  largestLoss: number;
}

export interface SignalStatistics {
  generated: number;
  accepted: number;
  rejected: number;
}

export interface BacktestResult {
  config: BacktestConfig;
  startTime: number;
  endTime: number;
  duration: number; // in seconds
  equitySnapshots: EquitySnapshot[];
  trades: CompletedTrade[];
  metrics: PerformanceMetrics;
  finalBalance: number;
  finalEquity: number;
  signalStats: SignalStatistics;
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
  marketFetchParallel?: boolean;
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
  /**
   * Return a consistent snapshot of account and positions computed from the same price refresh.
   * Implementations should avoid double-refreshing marks between the two to prevent drift.
   */
  getSnapshot(): Promise<{ account: Account; positions: Position[] }>;
  getCandlesticks(symbol: string, timeframe: string, limit: number): Promise<Candlestick[]>;
  placeOrder(
    symbol: string,
    side: 'buy' | 'sell',
    amount: number,
    price?: number,
    leverage?: number
  ): Promise<Order>;
  cancelOrder(orderId: string, symbol: string): Promise<boolean>;
  getTicker(symbol: string): Promise<{ price: number; timestamp: number }>;
  getCompletedTrades?(): CompletedTrade[]; // Optional method for getting completed trades
  getExchangeName(): string; // Get the name of the exchange
}

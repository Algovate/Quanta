// TUI-specific type definitions

export interface TUIState {
  account: AccountSnapshot | null;
  positions: PositionSnapshot[];
  marketData: MarketDataSnapshot[];
  signals: SignalSnapshot[];
  orders: OrderSnapshot[];
  logs: LogEntry[];
  systemStatus: SystemStatus;
}

export interface AccountSnapshot {
  balance: number;
  equity: number;
  availableMargin: number;
  usedMargin: number;
  totalPnL: number;
  marginRatio: number;
  timestamp: number;
}

export interface PositionSnapshot {
  symbol: string;
  coin: string;
  side: 'long' | 'short';
  size: number;
  entryPrice: number;
  currentPrice: number;
  leverage: number;
  unrealizedPnL: number;
  notional: number;
  timestamp: number;
}

export interface MarketDataSnapshot {
  coin: string;
  currentPrice: number;
  change24h: number;
  changePercent24h: number;
  volume24h: number;
  indicators: {
    ema20: number;
    ema50: number;
    rsi14: number;
    macd: number;
    signal: number;
  };
  trend: 'bullish' | 'bearish' | 'sideways';
  volatility: 'low' | 'medium' | 'high';
}

export interface SignalSnapshot {
  coin: string;
  action: 'LONG' | 'SHORT' | 'CLOSE' | 'HOLD';
  confidence: number;
  reasoning: string;
  timestamp: number;
  executed: boolean;
}

export interface OrderSnapshot {
  id: string;
  symbol: string;
  side: 'buy' | 'sell';
  amount: number;
  price: number | null;
  status: 'open' | 'filled' | 'cancelled';
  timestamp: number;
}

export interface LogEntry {
  level: 'info' | 'warn' | 'error' | 'success';
  message: string;
  timestamp: number;
}

export interface SystemStatus {
  isRunning: boolean;
  isPaused: boolean;
  cycleCount: number;
  startTime: number;
  lastUpdate: number;
  totalSignals: number;
  totalTrades: number;
  winRate: number;
  riskLevel: 'low' | 'medium' | 'high';
}

export interface ActiveView {
  type: 'dashboard' | 'settings' | 'help';
  activePanel?: number;
}

export interface KeyboardState {
  mode: 'normal' | 'input' | 'dialog';
  activeDialog?: 'order' | 'position' | 'coin' | 'settings' | 'help';
}

export interface CycleStartEvent {
  cycleCount: number;
  timestamp: number;
  startTime: number;
}

export interface CycleSignalsEvent {
  cycleCount: number;
  timestamp: number;
  signalCount: number;
  signals: Array<{ coin: string; action: string; confidence: number }>; // simplified view
}

export interface CycleExecutionEvent {
  cycleCount: number;
  timestamp: number;
  executedSignals: number;
  totalTrades: number;
}

export interface CycleCompleteEvent {
  cycleCount: number;
  timestamp: number;
  duration: number;
  totalSignals: number;
  totalTrades: number;
  totalPnl: number;
  signalCount: number;
  tradeCount: number;
  cyclePnl: number;
  actionCounts: { LONG: number; SHORT: number; CLOSE: number; HOLD: number };
}

export interface CycleErrorEvent {
  cycleCount: number;
  error: string;
  timestamp: number;
}

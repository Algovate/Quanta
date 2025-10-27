// TUI Manager - Bridge between workflow and UI state

import { EventEmitter } from 'events';
import {
  TUIState,
  AccountSnapshot,
  SignalSnapshot,
  OrderSnapshot,
  LogEntry,
  SystemStatus,
} from './types.js';
import { Account, Position, TradingSignal, Order } from '../types/index.js';

export class TUIManager extends EventEmitter {
  private state: TUIState;
  private updateInterval?: NodeJS.Timeout;

  constructor() {
    super();
    this.state = this.createInitialState();
    this.setupEventListeners();
  }

  private setupEventListeners(): void {
    // Listen to workflow events
    this.on('account:update', (account: any) => {
      this.updateAccount(account);
    });

    this.on('positions:update', (positions: any[]) => {
      this.updatePositions(positions);
    });

    this.on('marketdata:update', (marketData: any[]) => {
      this.updateMarketData(marketData);
    });

    this.on('signal:new', (signal: any) => {
      this.addSignal(signal);
    });

    this.on('order:new', (order: any) => {
      this.addOrder(order);
    });

    this.on('log', (entry: { level: string; message: string; timestamp: number }) => {
      this.addLog(entry.level as 'info' | 'warn' | 'error' | 'success', entry.message);
    });

    this.on('system:status', (status: any) => {
      this.updateSystemStatus(status);
    });
  }

  private createInitialState(): TUIState {
    return {
      account: null,
      positions: [],
      marketData: [],
      signals: [],
      orders: [],
      logs: [],
      systemStatus: {
        isRunning: false,
        isPaused: false,
        cycleCount: 0,
        startTime: Date.now(),
        lastUpdate: Date.now(),
        totalSignals: 0,
        totalTrades: 0,
        winRate: 0,
        riskLevel: 'low',
      },
    };
  }

  public getState(): TUIState {
    return { ...this.state };
  }

  public updateAccount(account: Account): void {
    const snapshot: AccountSnapshot = {
      balance: account.balance,
      equity: account.equity,
      availableMargin: account.availableMargin,
      usedMargin: account.usedMargin,
      totalPnL: account.equity - account.balance,
      marginRatio: account.marginRatio,
      timestamp: account.timestamp,
    };

    this.state.account = snapshot;
    this.emit('update', this.state);
  }

  public updatePositions(positions: Position[]): void {
    this.state.positions = positions.map(pos => ({
      symbol: pos.symbol,
      coin: pos.symbol.replace('/USDT', ''),
      side: pos.side,
      size: pos.size,
      entryPrice: pos.entryPrice,
      currentPrice: pos.markPrice,
      leverage: pos.leverage,
      unrealizedPnL: pos.unrealizedPnl,
      notional: pos.notional,
      timestamp: pos.timestamp,
    }));

    // Update risk level based on total PnL
    const totalPnL = this.state.positions.reduce((sum, pos) => sum + pos.unrealizedPnL, 0);
    const totalMargin = this.state.positions.reduce(
      (sum, pos) => sum + pos.notional / pos.leverage,
      0
    );

    if (totalMargin > 0) {
      const pnlPercent = Math.abs(totalPnL) / totalMargin;
      if (pnlPercent > 0.1) {
        this.state.systemStatus.riskLevel = 'high';
      } else if (pnlPercent > 0.05) {
        this.state.systemStatus.riskLevel = 'medium';
      } else {
        this.state.systemStatus.riskLevel = 'low';
      }
    }

    this.emit('update', this.state);
  }

  public updateMarketData(marketData: any[]): void {
    this.state.marketData = marketData.map(data => ({
      coin: data.coin,
      currentPrice: data.currentPrice,
      change24h: 0, // Will be calculated from historical data
      changePercent24h: 0,
      volume24h: 0,
      indicators: {
        ema20: data.indicators.ema20,
        ema50: data.indicators.ema50,
        rsi14: data.indicators.rsi14,
        macd: data.indicators.macd.macd,
        signal: data.indicators.macd.signal,
      },
      trend: data.trend,
      volatility: data.volatility,
    }));

    this.emit('update', this.state);
  }

  public addSignal(signal: TradingSignal): void {
    const snapshot: SignalSnapshot = {
      coin: signal.coin,
      action: signal.action,
      confidence: signal.confidence,
      reasoning: signal.reasoning,
      timestamp: Date.now(),
      executed: false,
    };

    this.state.signals.unshift(snapshot);
    // Keep only last 20 signals
    if (this.state.signals.length > 20) {
      this.state.signals = this.state.signals.slice(0, 20);
    }

    this.state.systemStatus.totalSignals++;
    this.emit('update', this.state);
  }

  public addOrder(order: Order): void {
    const snapshot: OrderSnapshot = {
      id: order.id,
      symbol: order.symbol,
      side: order.side,
      amount: order.amount,
      price: order.price,
      status: order.status as 'open' | 'filled' | 'cancelled',
      timestamp: order.timestamp,
    };

    this.state.orders.unshift(snapshot);
    // Keep only last 20 orders
    if (this.state.orders.length > 20) {
      this.state.orders = this.state.orders.slice(0, 20);
    }

    this.state.systemStatus.totalTrades++;
    this.emit('update', this.state);
  }

  public addLog(level: 'info' | 'warn' | 'error' | 'success', message: string): void {
    const entry: LogEntry = {
      level,
      message,
      timestamp: Date.now(),
    };

    this.state.logs.unshift(entry);
    // Keep only last 1000 logs
    if (this.state.logs.length > 1000) {
      this.state.logs = this.state.logs.slice(0, 1000);
    }

    this.emit('update', this.state);
  }

  public updateSystemStatus(status: Partial<SystemStatus>): void {
    this.state.systemStatus = {
      ...this.state.systemStatus,
      ...status,
      lastUpdate: Date.now(),
    };

    this.emit('update', this.state);
  }

  public start(): void {
    this.state.systemStatus.isRunning = true;
    this.state.systemStatus.startTime = Date.now();
    this.addLog('success', '🚀 Trading system started');
    this.addLog('info', 'System running in interactive TUI mode');
    this.addLog('info', 'Press "h" or "?" for help');
    this.emit('start');
  }

  public pause(): void {
    this.state.systemStatus.isPaused = true;
    this.addLog('warn', 'Trading system paused');
    this.emit('pause');
  }

  public resume(): void {
    this.state.systemStatus.isPaused = false;
    this.addLog('info', 'Trading system resumed');
    this.emit('resume');
  }

  public stop(): void {
    this.state.systemStatus.isRunning = false;
    this.addLog('info', 'Trading system stopped');
    this.emit('stop');
  }

  public destroy(): void {
    if (this.updateInterval) {
      clearInterval(this.updateInterval);
    }
  }
}

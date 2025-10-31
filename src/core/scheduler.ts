import { Exchange } from '../exchange/types.js';
import { Logger } from '../utils/index.js';
import { timeframeToMs, type Timeframe } from '../utils/timeframe.js';
import type { Candlestick } from '../types/index.js';

export type BarTimeframe = Timeframe;

export interface BarSchedulerConfig {
  symbols: string[]; // e.g., ['BTC/USDT', 'ETH/USDT']
  timeframes: BarTimeframe[]; // e.g., ['3m', '4h']
  pollIntervalMs?: number; // low-overhead polling to detect new bars until WS is added
}

export interface BarEvent {
  symbol: string;
  timeframe: BarTimeframe;
  openTime: number;
  closeTime: number;
}

type BarListener = (event: BarEvent) => void;

/**
 * BarScheduler detects new completed bars for configured symbols/timeframes
 * and notifies listeners. It uses lightweight polling against getCandlesticks
 * as an interim solution until a dedicated WS ingestion layer is integrated.
 */
export class BarScheduler {
  private readonly exchange: Exchange;
  private readonly config: Required<BarSchedulerConfig>;
  private readonly logger: Logger;
  private timer?: NodeJS.Timeout;
  private isRunning: boolean = false;
  private readonly listeners: Set<BarListener> = new Set();
  private readonly lastBarKeyToCloseTime: Map<string, number> = new Map();

  constructor(exchange: Exchange, config: BarSchedulerConfig) {
    this.exchange = exchange;
    this.config = {
      pollIntervalMs: 5_000,
      ...config,
    } as Required<BarSchedulerConfig>;
    this.logger = Logger.getInstance('BarScheduler');
  }

  onBarClosed(listener: BarListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  start(): void {
    if (this.isRunning) return;
    this.isRunning = true;
    void this.loop();
  }

  stop(): void {
    this.isRunning = false;
    if (this.timer) clearTimeout(this.timer);
    this.timer = undefined;
  }

  private async loop(): Promise<void> {
    if (!this.isRunning) return;
    try {
      await this.scanOnce();
    } catch (error) {
      this.logger.warn('BarScheduler scan failed', error);
    } finally {
      if (this.isRunning) {
        this.timer = setTimeout(() => void this.loop(), this.config.pollIntervalMs);
      }
    }
  }

  private async scanOnce(): Promise<void> {
    const tasks: Array<Promise<void>> = [];
    for (const symbol of this.config.symbols) {
      for (const timeframe of this.config.timeframes) {
        tasks.push(this.checkSymbolTimeframe(symbol, timeframe));
      }
    }
    await Promise.allSettled(tasks);
  }

  private async checkSymbolTimeframe(symbol: string, timeframe: BarTimeframe): Promise<void> {
    try {
      const candles: Candlestick[] = await this.exchange.getCandlesticks(symbol, timeframe, 2);
      if (!candles || candles.length === 0) return;
      const last = candles[candles.length - 1];
      const prev = candles.length > 1 ? candles[candles.length - 2] : undefined;

      // Many exchanges return [timestamp, open, high, low, close, volume]
      // Our Candlestick type is an object; assume it has timestamp and closeTime or just timestamp.
      const closeTime = last.timestamp ?? 0;
      const openTime = prev?.timestamp ?? closeTime - timeframeToMs(timeframe);

      const key = `${symbol}:${timeframe}`;
      const seenClose = this.lastBarKeyToCloseTime.get(key);
      if (typeof closeTime === 'number' && closeTime > 0 && closeTime !== seenClose) {
        // New bar closed
        this.lastBarKeyToCloseTime.set(key, closeTime);
        const event: BarEvent = { symbol, timeframe, openTime, closeTime };
        for (const l of this.listeners) {
          try {
            l(event);
          } catch (e) {
            this.logger.warn('BarScheduler listener error', e);
          }
        }
      }
    } catch (e) {
      this.logger.debug?.('BarScheduler check failed', {
        symbol,
        timeframe,
        error: (e as Error)?.message,
      });
    }
  }

  // timeframeToMs is used instead
}

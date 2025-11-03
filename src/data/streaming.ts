import { EventEmitter } from 'events';
import type { Exchange } from '../exchange/types.js';
import type { Candlestick } from '../types/index.js';
import { UnifiedLogger } from '../logging/index.js';
import { timeframeToMs, type Timeframe } from '../utils/timeframe.js';
import { EventBus } from '../core/event-bus.js';

export type StreamTimeframe = Timeframe;

export interface GapInfo {
  symbol: string;
  timeframe: StreamTimeframe;
  missingFrom: number;
  missingTo: number;
}

export interface StreamEventMap {
  'bar:closed': { symbol: string; timeframe: StreamTimeframe; openTime: number; closeTime: number };
  'gap:detected': GapInfo;
  'stream:error': { symbol?: string; timeframe?: StreamTimeframe; error: string };
}

type StreamEvent = keyof StreamEventMap;

export interface TimeSyncProvider {
  now(): number; // wall-clock ms, optionally NTP-adjusted
}

export class SystemClock implements TimeSyncProvider {
  now(): number {
    return Date.now();
  }
}

export interface StreamingConfig {
  symbols: string[];
  timeframes: StreamTimeframe[];
  backfillOnStart?: boolean;
  maxSkewMs?: number; // clock skew tolerance
}

/**
 * Unified streaming ingestion facade. Initial version polls as a compatibility layer
 * until per-exchange WS adapters are wired. Exposes an EventEmitter-like on/off API.
 */
export class StreamingIngestion {
  private readonly exchange: Exchange;
  private readonly config: Required<StreamingConfig>;
  private readonly timeSync: TimeSyncProvider;
  private readonly logger: UnifiedLogger;
  private readonly emitter = new EventEmitter();
  private timer?: NodeJS.Timeout;
  private running = false;

  constructor(
    exchange: Exchange,
    config: StreamingConfig,
    timeSync: TimeSyncProvider = new SystemClock()
  ) {
    this.exchange = exchange;
    this.config = {
      backfillOnStart: true,
      maxSkewMs: 2_000,
      ...config,
    } as Required<StreamingConfig>;
    this.timeSync = timeSync;
    this.logger = UnifiedLogger.getInstance();
  }

  on<K extends StreamEvent>(event: K, listener: (payload: StreamEventMap[K]) => void): () => void {
    this.emitter.on(event, listener as any);
    return () => this.emitter.off(event, listener as any);
  }

  start(pollIntervalMs: number = 5_000): void {
    if (this.running) return;
    this.running = true;
    void this.loop(pollIntervalMs);
  }

  stop(): void {
    this.running = false;
    if (this.timer) clearTimeout(this.timer);
    this.timer = undefined;
  }

  private async loop(pollIntervalMs: number): Promise<void> {
    if (!this.running) return;
    try {
      await this.scanOnce();
    } catch (error) {
      this.emitter.emit('stream:error', { error: (error as Error)?.message || String(error) });
    } finally {
      if (this.running) {
        this.timer = setTimeout(() => void this.loop(pollIntervalMs), pollIntervalMs);
      }
    }
  }

  private async scanOnce(): Promise<void> {
    // Basic polling-based bar close detection; gaps can be inferred from timestamp strides
    const tasks: Array<Promise<void>> = [];
    for (const symbol of this.config.symbols) {
      for (const timeframe of this.config.timeframes) {
        tasks.push(this.checkBar(symbol, timeframe));
      }
    }
    await Promise.allSettled(tasks);
  }

  private async checkBar(symbol: string, timeframe: StreamTimeframe): Promise<void> {
    try {
      const candles: Candlestick[] = await this.exchange.getCandlesticks(symbol, timeframe, 3);
      if (!candles || candles.length < 2) return;
      const last = candles[candles.length - 1];
      const prev = candles[candles.length - 2];
      const closeTime = last.timestamp;
      const openTime = prev?.timestamp;

      if (typeof closeTime !== 'number') return;
      const tfMs = timeframeToMs(timeframe);
      const now = this.timeSync.now();
      if (closeTime > now + this.config.maxSkewMs) {
        this.logger?.warn?.('Streaming time skew detected', {
          symbol,
          timeframe,
          closeTime,
          now,
          maxSkewMs: this.config.maxSkewMs,
        });
        return;
      }

      if (typeof openTime === 'number') {
        const stride = closeTime - openTime;
        if (stride > tfMs * 1.5) {
          const missingFrom = openTime + tfMs;
          const missingTo = closeTime - tfMs;
          if (missingTo >= missingFrom) {
            this.logger?.debug?.('Gap detected', {
              symbol,
              timeframe,
              missingFrom,
              missingTo,
            });
            const gapPayload = { symbol, timeframe, missingFrom, missingTo } as const;
            this.emitter.emit('gap:detected', gapPayload);
            EventBus.emit('gap:detected', gapPayload);
          }
        }
      }

      this.logger?.debug?.('Bar closed', {
        symbol,
        timeframe,
        openTime: openTime ?? closeTime - tfMs,
        closeTime,
      });
      const payload = {
        symbol,
        timeframe,
        openTime: openTime ?? closeTime - tfMs,
        closeTime,
      } as const;
      this.emitter.emit('bar:closed', payload);
      EventBus.emit('bar:closed', payload);
    } catch (e) {
      this.emitter.emit('stream:error', {
        symbol,
        timeframe,
        error: (e as Error)?.message || String(e),
      });
    }
  }

  // timeframeToMs is used instead
}

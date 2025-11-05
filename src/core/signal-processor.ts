/**
 * Signal Processor - Handles signal processing, display, and event emission
 */

import type { TradingSignal } from '../types/index.js';
import type { ExchangeSnapshotService } from './exchange-snapshot.js';
import type { UnifiedLogger } from '../logging/index.js';
import { CycleLogger, CycleDisplay } from './display/index.js';
import { createTickerPriceGetter } from '../utils/ticker-cache.js';
import type { TypedEventBus, EventKey, EventPayloads } from './event-bus.js';

export interface SignalProcessorOptions {
  isBackgroundMode: boolean;
  tickerCache: Map<string, { price: number; timestamp: number }>;
  snapshotService: ExchangeSnapshotService;
  unifiedLogger: UnifiedLogger;
  loggerContext: string;
  eventBus: TypedEventBus;
  emitLog: (level: 'info' | 'warn' | 'error' | 'success', message: string) => void;
}

/**
 * SignalProcessor - Handles processing, displaying, and emitting signals
 */
export class SignalProcessor {
  private cycleLogger: CycleLogger;
  private cycleDisplay: CycleDisplay;

  constructor() {
    this.cycleLogger = new CycleLogger();
    this.cycleDisplay = new CycleDisplay();
  }

  /**
   * Process and display generated signals
   */
  async processSignals(signals: TradingSignal[], options: SignalProcessorOptions): Promise<void> {
    if (signals.length === 0) return;

    const getCachedPrice = createTickerPriceGetter(
      options.tickerCache,
      options.snapshotService,
      options.unifiedLogger,
      options.loggerContext
    );

    const signalSummary = `🤖 Generated ${signals.length} signal${signals.length > 1 ? 's' : ''}:`;
    if (options.isBackgroundMode) {
      options.emitLog('info', signalSummary);
    }

    // Log to structured logger for file output (background mode only to avoid buffering delays)
    if (options.isBackgroundMode) {
      options.unifiedLogger.info(
        'AI Signal Generation',
        {
          signalCount: signals.length,
          signals: signals.map(s => ({
            coin: s.coin,
            action: s.action,
            confidence: s.confidence,
            reasoning: s.reasoning,
          })),
        },
        options.loggerContext
      );
    }

    // Console output with formatting (only if not background mode)
    if (!options.isBackgroundMode) {
      const signalsFormatted = this.cycleDisplay.formatSignals(signals);
      this.cycleLogger.logFormatted(signalsFormatted);
    }

    // Push signals to UI buffer via event bus (decoupled)
    for (let i = 0; i < signals.length; i++) {
      const sig = signals[i];
      const action = sig.action;
      const symbol = `${sig.coin}/USDT`;
      const price = await getCachedPrice(symbol);
      options.eventBus.emit(
        'signal:buffer' as EventKey,
        {
          id: `${sig.coin}-${Date.now()}-${i}-${Math.random().toString(36).slice(2, 6)}`,
          timestamp: Date.now(),
          symbol,
          action,
          confidence: sig.confidence,
          reasoning: sig.reasoning,
          price,
          strategy: 'AI',
          status: 'generated',
        } as EventPayloads['signal:buffer']
      );
    }
  }
}


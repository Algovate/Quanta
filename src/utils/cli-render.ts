import ora, { Ora } from 'ora';
import cliProgress from 'cli-progress';
import chalk from 'chalk';
import { DrawdownTracker } from './drawdown.js';

type RenderMode = 'verbose' | 'normal' | 'quiet';

export interface BacktestRendererOptions {
  mode?: RenderMode;
  showProgress?: boolean;
  updateIntervalMs?: number;
  // Noise control
  sampleEveryCycles?: number; // print every N cycles regardless
  equityDeltaPctToPrint?: number; // print if equity changed by >= pct since last print (e.g., 0.001 = 0.1%)
  upnlDeltaAbsToPrint?: number; // print if UPNL changed by >= $ since last print
  exposureDeltaPctToPrint?: number; // exposure change threshold
  leverageDeltaAbsToPrint?: number; // leverage delta threshold
  drawdownSteps?: number[]; // e.g., [5,10,15]
}

export class BacktestRenderer {
  private mode: RenderMode;
  private showProgress: boolean;
  private updateIntervalMs: number;
  private spinner: Ora | null = null;
  private progressBar: cliProgress.SingleBar | null = null;
  private lastUpdate = 0;
  private lastHeartbeat = 0;
  private lastPrinted: {
    cycle?: number;
    equity?: number;
    positions?: number;
    upnl?: number;
  } = {};
  private sampleEveryCycles: number;
  private thresholds: {
    equityDeltaPctToPrint: number;
    upnlDeltaAbsToPrint: number;
    exposureDeltaPctToPrint: number;
    leverageDeltaAbsToPrint: number;
  };
  private drawdownSteps: number[];
  private ddTracker: DrawdownTracker;
  private spinnerWasRunning: boolean = false; // Track spinner state before pause

  constructor(options?: BacktestRendererOptions) {
    this.mode = options?.mode || 'normal';
    this.showProgress = options?.showProgress ?? true;
    this.updateIntervalMs = options?.updateIntervalMs ?? 750;
    this.sampleEveryCycles = Math.max(1, options?.sampleEveryCycles ?? 50);
    this.thresholds = {
      equityDeltaPctToPrint: options?.equityDeltaPctToPrint ?? 0.01,
      upnlDeltaAbsToPrint: options?.upnlDeltaAbsToPrint ?? 50,
      exposureDeltaPctToPrint: options?.exposureDeltaPctToPrint ?? 1.0,
      leverageDeltaAbsToPrint: options?.leverageDeltaAbsToPrint ?? 0.5,
    };
    this.drawdownSteps = (options?.drawdownSteps ?? [5, 10, 15, 20]).sort((a, b) => a - b);
    this.ddTracker = new DrawdownTracker(this.drawdownSteps);
  }

  startPhase(phase: 'loading' | 'running' | 'finalizing' | 'completed') {
    if (!this.spinner) this.spinner = ora();
    if (phase === 'completed') {
      this.spinner?.succeed('Completed');
      this.spinner = null;
      this.spinnerWasRunning = false;
      this.stopProgress();
      return;
    }
    const textMap: Record<string, string> = {
      loading: 'Loading historical data...',
      running: 'Running backtest cycles...',
      finalizing: 'Finalizing (closing positions)...',
    };
    this.spinner!.text = textMap[phase] || phase;
    if (!this.spinner!.isSpinning) {
      this.spinner!.start();
    }
  }

  updateLoadingProgress(info: {
    symbol: string;
    timeframe: string;
    completed: number;
    total: number;
    elapsedSec: number;
    paginationProgress?: {
      pages: number;
      candles: number;
    };
  }) {
    if (!this.spinner) return;

    // Always update spinner text for loading progress, even in quiet mode
    // This provides essential feedback for long-running operations
    const progressText = this.formatLoadingProgressText(info);
    this.spinner.text = progressText;

    // Use heartbeat mechanism for periodic updates during long operations (every 5 seconds)
    // Heartbeat respects quiet mode, so it won't print in quiet mode
    if (info.elapsedSec >= 5 && Math.floor(info.elapsedSec) % 5 === 0) {
      this.heartbeat(
        `Loading ${info.symbol} ${info.timeframe}... (${info.completed}/${info.total})`
      );
    }
  }

  /**
   * Format loading progress text with pagination details
   */
  private formatLoadingProgressText(info: {
    symbol: string;
    timeframe: string;
    completed: number;
    total: number;
    elapsedSec: number;
    paginationProgress?: {
      pages: number;
      candles: number;
    };
  }): string {
    let text = `Loading ${info.symbol} ${info.timeframe}... (${info.completed}/${info.total})`;

    // Add pagination details if available (for long-running fetches)
    if (info.paginationProgress) {
      text += ` - Page ${info.paginationProgress.pages}, ${info.paginationProgress.candles.toLocaleString()} candles`;
    }

    // Add elapsed time
    if (info.elapsedSec > 0) {
      text += ` [${Math.floor(info.elapsedSec)}s]`;
    }

    return text;
  }

  updateProgress(percent: number, elapsedSec: number) {
    if (!this.showProgress) return;
    const now = Date.now();
    if (now - this.lastUpdate < this.updateIntervalMs) return;

    if (!this.progressBar) {
      this.progressBar = new cliProgress.SingleBar(
        { format: '{bar} | {percentage}% | {elapsed}s' },
        cliProgress.Presets.shades_classic
      );
      this.progressBar.start(100, Math.floor(percent));
    }
    this.progressBar.update(Math.floor(Math.min(100, percent)), {
      elapsed: Math.floor(elapsedSec),
    });
    this.lastUpdate = now;
  }

  heartbeat(label?: string) {
    const now = Date.now();
    if (now - this.lastHeartbeat < Math.max(this.updateIntervalMs, 1500)) return;
    if (this.mode === 'quiet') return;

    console.log(chalk.gray(`⏳ ${label || 'Working...'} (${new Date().toLocaleTimeString()})`));
    this.lastHeartbeat = now;
  }

  updateCycleLine(info: {
    cycleCount: number;
    timestamp: number;
    equity: number;
    exposure?: number;
    leverage?: number;
    positions: number;
    generatedSignals: number;
    acceptedSignals: number;
    rejectedSignals: number;
    unrealizedPnl: number;
  }) {
    if (this.mode === 'quiet') return;

    // Drawdown detection via tracker
    const { crossed, ddPct } = this.ddTracker.update(info.equity);
    if (crossed !== null) {
      console.log(
        `RISK | dd=${ddPct.toFixed(1)}% crossed ${crossed}% | eq=$${info.equity.toFixed(0)}${
          info.leverage !== undefined ? ` | lev=${info.leverage.toFixed(2)}` : ''
        }`
      );
    }

    // Decide if we should print this cycle to avoid noise
    const shouldBySample = info.cycleCount % this.sampleEveryCycles === 0;
    const lastEq = this.lastPrinted.equity ?? info.equity;
    const lastUpnl = this.lastPrinted.upnl ?? info.unrealizedPnl;
    const eqDeltaPct = lastEq > 0 ? Math.abs(info.equity - lastEq) / lastEq : 1;
    const upnlDeltaAbs = Math.abs(info.unrealizedPnl - lastUpnl);
    const positionsChanged = this.lastPrinted.positions !== info.positions;
    let exposureChanged = false;
    let leverageChanged = false;
    if (info.exposure !== undefined && this.lastPrinted.equity) {
      const lastExp = (this.lastPrinted as any).exposure ?? info.exposure;
      exposureChanged =
        lastExp > 0 &&
        Math.abs(info.exposure - lastExp) / lastExp >= this.thresholds.exposureDeltaPctToPrint;
    }
    if (info.leverage !== undefined) {
      const lastLev = (this.lastPrinted as any).leverage ?? info.leverage;
      leverageChanged =
        Math.abs(info.leverage - lastLev) >= this.thresholds.leverageDeltaAbsToPrint;
    }
    const shouldByChange =
      eqDeltaPct >= this.thresholds.equityDeltaPctToPrint ||
      upnlDeltaAbs >= this.thresholds.upnlDeltaAbsToPrint ||
      positionsChanged ||
      exposureChanged ||
      leverageChanged;

    if (!(shouldBySample || shouldByChange)) return;

    const line = `#${info.cycleCount}  Eq:$${info.equity.toFixed(0)}  P:${info.positions}  G/A/R:${info.generatedSignals}/${info.acceptedSignals}/${info.rejectedSignals}  UPNL:$${info.unrealizedPnl.toFixed(0)}${
      info.exposure !== undefined ? `  EXP:$${info.exposure.toFixed(0)}` : ''
    }${info.leverage !== undefined ? `  LV:${info.leverage.toFixed(2)}` : ''}`;

    console.log(line);

    this.lastPrinted = {
      cycle: info.cycleCount,
      equity: info.equity,
      positions: info.positions,
      upnl: info.unrealizedPnl,
      ...(info.exposure !== undefined ? { exposure: info.exposure } : {}),
      ...(info.leverage !== undefined ? { leverage: info.leverage } : {}),
    };
  }

  stopProgress() {
    if (this.progressBar) {
      this.progressBar.update(100);
      this.progressBar.stop();
      this.progressBar = null;
    }
  }

  /**
   * Pause the spinner to allow other output without interference
   * Saves the current spinner state so it can be restored later
   */
  private pauseSpinner(): void {
    if (this.spinner && this.spinner.isSpinning) {
      this.spinnerWasRunning = true;
      this.spinner.stop();
      // Clear the current line to prevent text overlap
      process.stdout.write('\r\x1b[K');
    } else {
      this.spinnerWasRunning = false;
    }
  }

  /**
   * Resume the spinner if it was running before pause
   */
  private resumeSpinner(): void {
    if (this.spinner && this.spinnerWasRunning && !this.spinner.isSpinning) {
      this.spinner.start();
    }
  }

  /**
   * Log a message while ensuring spinner doesn't interfere
   * Pauses spinner, outputs message, then resumes spinner
   */
  logMessage(message: string): void {
    this.pauseSpinner();
    console.log(message);
    this.resumeSpinner();
  }
}

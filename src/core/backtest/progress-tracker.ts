import cliProgress from 'cli-progress';

/**
 * Progress bar configuration constants
 */
const PROGRESS_BAR_CONFIG = {
  format: '{bar} | {percentage}% | {duration}s',
  barCompleteChar: '\u2588',
  barIncompleteChar: '\u2591',
  hideCursor: true,
  clearOnComplete: false,
  linewrap: false,
} as const;

/**
 * Progress tracker for backtest progress reporting
 * Handles progress bar creation, updates, and timing
 */
export class ProgressTracker {
  private startSimulationTime: number;
  private lastProgressUpdate: number = 0;
  private simulationStartTime: number;
  private simulationEndTime: number;

  constructor(startTime: number, endTime: number) {
    this.simulationStartTime = startTime;
    this.simulationEndTime = endTime;
    this.startSimulationTime = Date.now();
  }

  /**
   * Initialize and start the progress bar
   * @returns Progress bar instance
   */
  startProgressBar(): cliProgress.SingleBar {
    const bar = new cliProgress.SingleBar(PROGRESS_BAR_CONFIG, cliProgress.Presets.shades_classic);
    bar.start(100, 0);
    return bar;
  }

  /**
   * Update progress bar based on current simulation time
   * @param currentTime Current timestamp in simulation
   * @param bar Progress bar instance to update
   */
  async updateProgress(currentTime: number, bar: cliProgress.SingleBar): Promise<void> {
    const totalDuration = this.simulationEndTime - this.simulationStartTime;
    const progress = Math.max(0, ((currentTime - this.simulationStartTime) / totalDuration) * 100);

    // Update on first call and every 0.5% progress to show real-time feedback
    if (this.lastProgressUpdate > 0 && progress - this.lastProgressUpdate < 0.5) {
      return;
    }

    // Calculate elapsed time in seconds
    const elapsedMs = Date.now() - this.startSimulationTime;
    const elapsedSec = Math.floor(elapsedMs / 1000);

    const progressValue = Math.floor(Math.min(progress, 100));
    bar.update(progressValue, {
      duration: elapsedSec,
    });
    this.lastProgressUpdate = progress;
  }

  /**
   * Stop and complete the progress bar
   * @param bar Progress bar instance to stop
   */
  stopProgressBar(bar: cliProgress.SingleBar): void {
    bar.update(100);
    bar.stop();
  }

  /**
   * Get elapsed time since simulation start
   * @returns Elapsed milliseconds
   */
  getElapsedTime(): number {
    return Date.now() - this.startSimulationTime;
  }
}

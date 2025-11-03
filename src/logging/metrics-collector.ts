/**
 * Metrics Collector - Real-time metrics collection and calculation
 *
 * Features:
 * - Real-time metric maintenance (error rate, latency, throughput)
 * - Automatic statistical calculations (p50/p75/p90/p95/p99)
 * - Anomaly detection (sudden metric changes)
 * - Queryable metrics
 */

import type { MetricsSnapshot } from './types.js';

interface MetricEntry {
  values: number[];
  timestamps: number[];
  maxSize: number;
}

interface APILatencyMetric {
  endpoint: string;
  latencies: number[];
  timestamps: number[];
  maxSize: number;
}

interface OperationTimeMetric {
  operationType: string;
  durations: number[];
  timestamps: number[];
  maxSize: number;
}

export class MetricsCollector {
  private static instance: MetricsCollector;
  private cycleTimes: MetricEntry = { values: [], timestamps: [], maxSize: 1000 };
  private errorCounts: Map<string, number> = new Map(); // errorType -> count
  private errorTimestamps: number[] = [];
  private apiLatencies: Map<string, APILatencyMetric> = new Map();
  private operationTimes: Map<string, OperationTimeMetric> = new Map();
  private signalGenerationSuccess: number = 0;
  private signalGenerationTotal: number = 0;
  private orderExecutionSuccess: number = 0;
  private orderExecutionTotal: number = 0;
  private positionProfitCount: number = 0;
  private positionTotalCount: number = 0;
  private startTime: number = Date.now();
  private handlers: Array<(snapshot: MetricsSnapshot) => void> = [];
  private snapshotInterval?: NodeJS.Timeout; // Keep for cleanup if needed

  private constructor() {
    // Create periodic snapshot
    this.snapshotInterval = setInterval(() => {
      this.createSnapshot();
    }, 60000); // Every 60 seconds
  }

  static getInstance(): MetricsCollector {
    if (!MetricsCollector.instance) {
      MetricsCollector.instance = new MetricsCollector();
    }
    return MetricsCollector.instance;
  }

  /**
   * Stop metrics collection (cleanup intervals)
   */
  stop(): void {
    if (this.snapshotInterval) {
      clearInterval(this.snapshotInterval);
      this.snapshotInterval = undefined;
    }
  }

  /**
   * Register a handler to receive metrics snapshots
   */
  onSnapshot(handler: (snapshot: MetricsSnapshot) => void): void {
    this.handlers.push(handler);
  }

  /**
   * Record cycle execution time
   */
  recordCycleTime(_cycleId: number, duration: number): void {
    this.addMetric(this.cycleTimes, duration);
  }

  /**
   * Record an error occurrence
   */
  recordError(errorType: string, _cycleId: number): void {
    const count = this.errorCounts.get(errorType) || 0;
    this.errorCounts.set(errorType, count + 1);
    this.errorTimestamps.push(Date.now());

    // Keep only recent errors (last 1000)
    if (this.errorTimestamps.length > 1000) {
      this.errorTimestamps.shift();
    }
  }

  /**
   * Record API call latency
   */
  recordAPILatency(endpoint: string, latency: number): void {
    if (!this.apiLatencies.has(endpoint)) {
      this.apiLatencies.set(endpoint, {
        endpoint,
        latencies: [],
        timestamps: [],
        maxSize: 1000,
      });
    }

    const metric = this.apiLatencies.get(endpoint)!;
    this.addMetric(
      { values: metric.latencies, timestamps: metric.timestamps, maxSize: metric.maxSize },
      latency
    );
  }

  /**
   * Record operation execution time
   */
  recordOperationTime(operationType: string, duration: number): void {
    if (!this.operationTimes.has(operationType)) {
      this.operationTimes.set(operationType, {
        operationType,
        durations: [],
        timestamps: [],
        maxSize: 1000,
      });
    }

    const metric = this.operationTimes.get(operationType)!;
    this.addMetric(
      { values: metric.durations, timestamps: metric.timestamps, maxSize: metric.maxSize },
      duration
    );
  }

  /**
   * Record signal generation result
   */
  recordSignalGeneration(success: boolean): void {
    this.signalGenerationTotal++;
    if (success) {
      this.signalGenerationSuccess++;
    }
  }

  /**
   * Record order execution result
   */
  recordOrderExecution(success: boolean): void {
    this.orderExecutionTotal++;
    if (success) {
      this.orderExecutionSuccess++;
    }
  }

  /**
   * Record position profitability
   */
  recordPositionProfitability(profit: number): void {
    this.positionTotalCount++;
    if (profit > 0) {
      this.positionProfitCount++;
    }
  }

  /**
   * Add a metric value
   */
  private addMetric(metric: MetricEntry, value: number): void {
    const now = Date.now();
    metric.values.push(value);
    metric.timestamps.push(now);

    // Trim to max size
    if (metric.values.length > metric.maxSize) {
      metric.values.shift();
      metric.timestamps.shift();
    }
  }

  /**
   * Calculate percentiles
   */
  private calculatePercentiles(values: number[]): {
    p50: number;
    p75: number;
    p90: number;
    p95: number;
    p99: number;
    avg: number;
  } {
    if (values.length === 0) {
      return { p50: 0, p75: 0, p90: 0, p95: 0, p99: 0, avg: 0 };
    }

    const sorted = [...values].sort((a, b) => a - b);
    const len = sorted.length;

    const percentile = (p: number): number => {
      const index = Math.ceil((p / 100) * len) - 1;
      return sorted[Math.max(0, index)] || 0;
    };

    const sum = sorted.reduce((a, b) => a + b, 0);

    return {
      p50: percentile(50),
      p75: percentile(75),
      p90: percentile(90),
      p95: percentile(95),
      p99: percentile(99),
      avg: sum / len,
    };
  }

  /**
   * Calculate error rate
   */
  private calculateErrorRate(): {
    overall: number;
    byType: Record<string, number>;
    bySymbol: Record<string, number>;
    trend: 'increasing' | 'stable' | 'decreasing';
  } {
    const now = Date.now();
    const window = 60000; // Last 60 seconds
    const recentErrors = this.errorTimestamps.filter(t => now - t < window);

    const overall =
      this.cycleTimes.values.length > 0
        ? recentErrors.length / (this.cycleTimes.values.length || 1)
        : 0;

    const byType: Record<string, number> = {};
    for (const [errorType, count] of this.errorCounts.entries()) {
      byType[errorType] = count;
    }

    // Calculate trend (simple: compare first half vs second half)
    const midpoint = Math.floor(recentErrors.length / 2);
    const firstHalf = recentErrors.slice(0, midpoint).length;
    const secondHalf = recentErrors.slice(midpoint).length;
    let trend: 'increasing' | 'stable' | 'decreasing' = 'stable';
    if (firstHalf > 0) {
      const ratio = secondHalf / firstHalf;
      if (ratio > 1.5) trend = 'increasing';
      else if (ratio < 0.67) trend = 'decreasing';
    }

    // TODO: bySymbol needs to be tracked separately
    const bySymbol: Record<string, number> = {};

    return { overall, byType, bySymbol, trend };
  }

  /**
   * Create metrics snapshot
   */
  createSnapshot(cycleId?: number): MetricsSnapshot {
    const errorRate = this.calculateErrorRate();
    const cycleTimeStats = this.calculatePercentiles(this.cycleTimes.values);

    const apiLatency: Record<string, { p50: number; p95: number; p99: number; count: number }> = {};
    for (const [endpoint, metric] of this.apiLatencies.entries()) {
      const stats = this.calculatePercentiles(metric.latencies);
      apiLatency[endpoint] = {
        p50: stats.p50,
        p95: stats.p95,
        p99: stats.p99,
        count: metric.latencies.length,
      };
    }

    const operationTime: Record<string, { p50: number; p95: number; p99: number; count: number }> =
      {};
    for (const [operationType, metric] of this.operationTimes.entries()) {
      const stats = this.calculatePercentiles(metric.durations);
      operationTime[operationType] = {
        p50: stats.p50,
        p95: stats.p95,
        p99: stats.p99,
        count: metric.durations.length,
      };
    }

    const snapshot: MetricsSnapshot = {
      timestamp: Date.now(),
      cycleId: cycleId || 0,
      errorRate,
      performance: {
        cycleTime: cycleTimeStats,
        apiLatency,
        operationTime,
      },
      business: {
        signalGenerationSuccess:
          this.signalGenerationTotal > 0
            ? this.signalGenerationSuccess / this.signalGenerationTotal
            : 0,
        orderExecutionSuccess:
          this.orderExecutionTotal > 0 ? this.orderExecutionSuccess / this.orderExecutionTotal : 0,
        positionProfitability:
          this.positionTotalCount > 0 ? this.positionProfitCount / this.positionTotalCount : 0,
      },
    };

    // Notify handlers
    for (const handler of this.handlers) {
      try {
        handler(snapshot);
      } catch (error) {
        console.error('Error in metrics snapshot handler:', error);
      }
    }

    return snapshot;
  }

  /**
   * Get current error rate
   */
  getErrorRate(): number {
    return this.calculateErrorRate().overall;
  }

  /**
   * Get current cycle time statistics
   */
  getCycleTimeStats(): { p50: number; p95: number; p99: number; avg: number } {
    const stats = this.calculatePercentiles(this.cycleTimes.values);
    return {
      p50: stats.p50,
      p95: stats.p95,
      p99: stats.p99,
      avg: stats.avg,
    };
  }

  /**
   * Get uptime
   */
  getUptime(): number {
    return Date.now() - this.startTime;
  }

  /**
   * Reset metrics (for testing)
   */
  reset(): void {
    this.cycleTimes = { values: [], timestamps: [], maxSize: 1000 };
    this.errorCounts.clear();
    this.errorTimestamps = [];
    this.apiLatencies.clear();
    this.operationTimes.clear();
    this.signalGenerationSuccess = 0;
    this.signalGenerationTotal = 0;
    this.orderExecutionSuccess = 0;
    this.orderExecutionTotal = 0;
    this.positionProfitCount = 0;
    this.positionTotalCount = 0;
    this.startTime = Date.now();
  }

  /**
   * Get snapshot interval (for cleanup if needed)
   */
  getSnapshotInterval(): NodeJS.Timeout | undefined {
    return this.snapshotInterval;
  }
}

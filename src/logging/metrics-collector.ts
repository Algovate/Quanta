/**
 * Metrics Collector - Collects and aggregates system metrics
 *
 * This module provides metrics collection and aggregation capabilities.
 * Currently implemented as a minimal interface.
 */

import type { MetricsSnapshot } from './types.js';

interface MetricValue {
  timestamp: number;
  value: number;
  metadata?: Record<string, unknown>;
}

export class MetricsCollector {
  private static instance: MetricsCollector;
  private metrics: Map<string, MetricValue[]> = new Map();
  private maxHistory: number = 1000;

  private constructor() {}

  static getInstance(): MetricsCollector {
    if (!MetricsCollector.instance) {
      MetricsCollector.instance = new MetricsCollector();
    }
    return MetricsCollector.instance;
  }

  /**
   * Record a metric value
   */
  recordMetric(name: string, value: number, metadata?: Record<string, unknown>): void {
    const history = this.metrics.get(name) || [];
    history.push({
      timestamp: Date.now(),
      value,
      metadata,
    });

    // Limit history size
    if (history.length > this.maxHistory) {
      history.shift();
    }

    this.metrics.set(name, history);
  }

  /**
   * Record cycle time
   */
  recordCycleTime(_cycleId: number, durationMs: number): void {
    this.recordMetric('cycle_time', durationMs);
  }

  /**
   * Record error
   */
  recordError(errorType: string, _cycleId: number): void {
    this.recordMetric(`error_${errorType}`, 1);
  }

  /**
   * Record API latency
   */
  recordAPILatency(endpoint: string, latencyMs: number): void {
    this.recordMetric(`api_latency_${endpoint}`, latencyMs);
  }

  /**
   * Record operation time
   */
  recordOperationTime(operation: string, durationMs: number): void {
    this.recordMetric(`operation_time_${operation}`, durationMs);
  }

  /**
   * Record signal generation result
   */
  recordSignalGeneration(success: boolean): void {
    this.recordMetric('signal_generation', success ? 1 : 0);
  }

  /**
   * Record order execution result
   */
  recordOrderExecution(success: boolean): void {
    this.recordMetric('order_execution', success ? 1 : 0);
  }

  /**
   * Record position profitability
   */
  recordPositionProfitability(pnl: number): void {
    this.recordMetric('position_profitability', pnl);
  }

  /**
   * Get all metrics
   */
  getAllMetrics(): Record<string, MetricValue[]> {
    const result: Record<string, MetricValue[]> = {};
    for (const [key, values] of this.metrics.entries()) {
      result[key] = [...values];
    }
    return result;
  }

  /**
   * Get cycle time statistics
   */
  getCycleTimeStats(): { p50: number; p95: number; avg: number } {
    const values = this.metrics.get('cycle_time') || [];
    if (values.length === 0) {
      return { p50: 0, p95: 0, avg: 0 };
    }
    const sorted = values.map(v => v.value).sort((a, b) => a - b);
    const count = sorted.length;
    const sum = sorted.reduce((s, v) => s + v, 0);
    return {
      p50: sorted[Math.floor(count * 0.5)],
      p95: sorted[Math.floor(count * 0.95)],
      avg: sum / count,
    };
  }

  /**
   * Calculate percentile statistics for a set of values
   */
  private calculatePercentiles(values: number[]): {
    p50: number;
    p95: number;
    p99: number;
    count: number;
  } {
    if (values.length === 0) return { p50: 0, p95: 0, p99: 0, count: 0 };
    const sorted = [...values].sort((a, b) => a - b);
    const count = sorted.length;
    return {
      p50: sorted[Math.floor(count * 0.5)],
      p95: sorted[Math.floor(count * 0.95)],
      p99: sorted[Math.floor(count * 0.99)],
      count,
    };
  }

  /**
   * Get metrics snapshot
   */
  createSnapshot(cycleId: number): MetricsSnapshot {
    const cycleTimeStats = this.getCycleTimeStats();
    const apiLatencyMap: Record<string, { p50: number; p95: number; p99: number; count: number }> =
      {};
    const operationTimeMap: Record<
      string,
      { p50: number; p95: number; p99: number; count: number }
    > = {};

    // Aggregate API latency metrics
    for (const [key, values] of this.metrics.entries()) {
      if (key.startsWith('api_latency_')) {
        const endpoint = key.replace('api_latency_', '');
        const numbers = values.map(v => v.value);
        apiLatencyMap[endpoint] = this.calculatePercentiles(numbers);
      } else if (key.startsWith('operation_time_')) {
        const operation = key.replace('operation_time_', '');
        const numbers = values.map(v => v.value);
        operationTimeMap[operation] = this.calculatePercentiles(numbers);
      }
    }

    // Calculate business metrics
    const signalGen = this.metrics.get('signal_generation') || [];
    const orderExec = this.metrics.get('order_execution') || [];
    const profit = this.metrics.get('position_profitability') || [];

    const signalSuccess = signalGen.filter(v => v.value === 1).length;
    const orderSuccess = orderExec.filter(v => v.value === 1).length;
    const totalProfit = profit.reduce((sum, v) => sum + v.value, 0);

    return {
      timestamp: Date.now(),
      cycleId,
      errorRate: {
        overall: 0,
        byType: {},
        bySymbol: {},
        trend: 'stable',
      },
      performance: {
        cycleTime: {
          p50: cycleTimeStats.p50,
          p75: cycleTimeStats.p50,
          p90: cycleTimeStats.p50,
          p95: cycleTimeStats.p95,
          p99: cycleTimeStats.p95,
          avg: cycleTimeStats.avg,
        },
        apiLatency: apiLatencyMap,
        operationTime: operationTimeMap,
      },
      business: {
        signalGenerationSuccess: signalSuccess,
        orderExecutionSuccess: orderSuccess,
        positionProfitability: totalProfit,
      },
    };
  }

  /**
   * Reset all metrics
   */
  reset(): void {
    this.metrics.clear();
  }

  /**
   * Set max history size
   */
  setMaxHistory(max: number): void {
    this.maxHistory = max;
  }
}

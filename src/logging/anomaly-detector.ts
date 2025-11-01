/**
 * Anomaly Detector - Real-time anomaly detection
 *
 * Features:
 * - Error rate spike detection
 * - Performance degradation detection
 * - Memory leak detection
 * - Automatic triggering of detailed logging
 */

import { MetricsCollector } from './metrics-collector.js';
import { StateSnapshotService } from './state-snapshot.js';
import { Sampler } from './sampler.js';
import type { MetricsSnapshot } from './types.js';

export interface AnomalyEvent {
  type: 'error_rate_spike' | 'performance_degradation' | 'memory_leak' | 'high_error_count';
  severity: 'warning' | 'critical';
  message: string;
  timestamp: number;
  metrics: {
    current: number;
    previous?: number;
    threshold: number;
  };
  actions: string[];
}

export class AnomalyDetector {
  private static instance: AnomalyDetector;
  private metricsCollector: MetricsCollector;
  private stateSnapshot: StateSnapshotService;
  private sampler: Sampler;
  private handlers: Array<(event: AnomalyEvent) => void> = [];
  private previousMetrics: MetricsSnapshot | null = null;
  private memoryHistory: Array<{ timestamp: number; heapUsed: number }> = [];
  private maxMemoryHistorySize: number = 60; // Keep last 60 minutes of memory data
  private checkInterval?: NodeJS.Timeout; // Keep for cleanup if needed

  private constructor() {
    this.metricsCollector = MetricsCollector.getInstance();
    this.stateSnapshot = StateSnapshotService.getInstance();
    this.sampler = Sampler.getInstance();

    // Start periodic anomaly checks
    this.checkInterval = setInterval(() => {
      this.checkForAnomalies();
    }, 60000); // Check every minute
  }

  static getInstance(): AnomalyDetector {
    if (!AnomalyDetector.instance) {
      AnomalyDetector.instance = new AnomalyDetector();
    }
    return AnomalyDetector.instance;
  }

  /**
   * Register a handler for anomaly events
   */
  onAnomalyDetected(handler: (event: AnomalyEvent) => void): void {
    this.handlers.push(handler);
  }

  /**
   * Check for anomalies
   */
  checkForAnomalies(): AnomalyEvent[] {
    const events: AnomalyEvent[] = [];

    // Check error rate spike
    const errorRateEvent = this.checkErrorRateSpike();
    if (errorRateEvent) {
      events.push(errorRateEvent);
    }

    // Check performance degradation
    const performanceEvent = this.checkPerformanceDegradation();
    if (performanceEvent) {
      events.push(performanceEvent);
    }

    // Check memory leak
    const memoryEvent = this.checkMemoryLeak();
    if (memoryEvent) {
      events.push(memoryEvent);
    }

    // Notify handlers
    for (const event of events) {
      for (const handler of this.handlers) {
        try {
          handler(event);
        } catch (error) {
          console.error('Error in anomaly handler:', error);
        }
      }
    }

    return events;
  }

  /**
   * Check for error rate spike
   */
  private checkErrorRateSpike(): AnomalyEvent | null {
    const current = this.metricsCollector.createSnapshot(0);
    const currentErrorRate = current.errorRate.overall;

    if (!this.previousMetrics) {
      this.previousMetrics = current;
      return null;
    }

    const previousErrorRate = this.previousMetrics.errorRate.overall;
    const threshold = 0.05; // 5% error rate threshold

    // Check if error rate increased significantly
    if (currentErrorRate > threshold && previousErrorRate < threshold) {
      // Spike detected: error rate crossed threshold
      const event: AnomalyEvent = {
        type: 'error_rate_spike',
        severity: currentErrorRate > 0.1 ? 'critical' : 'warning',
        message: `Error rate spike detected: ${(currentErrorRate * 100).toFixed(2)}% (was ${(previousErrorRate * 100).toFixed(2)}%)`,
        timestamp: Date.now(),
        metrics: {
          current: currentErrorRate,
          previous: previousErrorRate,
          threshold,
        },
        actions: ['increase_sampling', 'save_snapshot', currentErrorRate > 0.1 ? 'alert' : 'log'],
      };

      // Trigger actions
      this.triggerActions(event);

      this.previousMetrics = current;
      return event;
    }

    // Check if error rate increased by more than 50%
    if (previousErrorRate > 0 && currentErrorRate / previousErrorRate > 1.5) {
      const event: AnomalyEvent = {
        type: 'error_rate_spike',
        severity: currentErrorRate > 0.05 ? 'critical' : 'warning',
        message: `Error rate increased by ${((currentErrorRate / previousErrorRate - 1) * 100).toFixed(1)}%`,
        timestamp: Date.now(),
        metrics: {
          current: currentErrorRate,
          previous: previousErrorRate,
          threshold,
        },
        actions: ['increase_sampling', 'save_snapshot'],
      };

      this.triggerActions(event);
      this.previousMetrics = current;
      return event;
    }

    this.previousMetrics = current;
    return null;
  }

  /**
   * Check for performance degradation
   */
  private checkPerformanceDegradation(): AnomalyEvent | null {
    const current = this.metricsCollector.createSnapshot(0);
    const currentP95 = current.performance.cycleTime.p95;
    const currentAvg = current.performance.cycleTime.avg;

    if (!this.previousMetrics || currentAvg === 0) {
      this.previousMetrics = current;
      return null;
    }

    const previousP95 = this.previousMetrics.performance.cycleTime.p95;
    const previousAvg = this.previousMetrics.performance.cycleTime.avg;

    // Check if p95 increased significantly (50% increase)
    if (previousP95 > 0 && currentP95 / previousP95 > 1.5) {
      const degradation = ((currentP95 / previousP95 - 1) * 100).toFixed(1);

      const event: AnomalyEvent = {
        type: 'performance_degradation',
        severity: currentP95 / previousP95 > 2 ? 'critical' : 'warning',
        message: `Performance degradation detected: p95 latency increased by ${degradation}%`,
        timestamp: Date.now(),
        metrics: {
          current: currentP95,
          previous: previousP95,
          threshold: previousP95 * 1.5,
        },
        actions: ['record_profiling', 'increase_sampling'],
      };

      this.triggerActions(event);
      this.previousMetrics = current;
      return event;
    }

    // Check if average latency increased significantly
    if (previousAvg > 0 && currentAvg / previousAvg > 1.5) {
      const event: AnomalyEvent = {
        type: 'performance_degradation',
        severity: 'warning',
        message: `Average cycle time increased by ${((currentAvg / previousAvg - 1) * 100).toFixed(1)}%`,
        timestamp: Date.now(),
        metrics: {
          current: currentAvg,
          previous: previousAvg,
          threshold: previousAvg * 1.5,
        },
        actions: ['increase_sampling'],
      };

      this.triggerActions(event);
      this.previousMetrics = current;
      return event;
    }

    this.previousMetrics = current;
    return null;
  }

  /**
   * Check for memory leak
   */
  private checkMemoryLeak(): AnomalyEvent | null {
    const lastSnapshot = this.stateSnapshot.getLastSnapshot();
    if (!lastSnapshot) {
      return null;
    }

    const now = Date.now();
    const heapUsed = lastSnapshot.systemMetrics.memoryUsage.heapUsed;

    // Add to history
    this.memoryHistory.push({ timestamp: now, heapUsed });

    // Keep only recent history
    const oneHourAgo = now - 60 * 60 * 1000;
    this.memoryHistory = this.memoryHistory.filter(h => h.timestamp > oneHourAgo);

    // Keep only last N entries
    if (this.memoryHistory.length > this.maxMemoryHistorySize) {
      this.memoryHistory = this.memoryHistory.slice(-this.maxMemoryHistorySize);
    }

    // Need at least 5 data points to detect trend
    if (this.memoryHistory.length < 5) {
      return null;
    }

    // Calculate memory growth rate
    const first = this.memoryHistory[0];
    const last = this.memoryHistory[this.memoryHistory.length - 1];
    const timeSpan = (last.timestamp - first.timestamp) / (60 * 60 * 1000); // hours
    const growth = last.heapUsed - first.heapUsed;
    const growthRate = timeSpan > 0 ? growth / timeSpan : 0; // MB per hour

    // Check if memory is growing (more than 10% per hour)
    const initialMem = first.heapUsed;
    const growthPercentage = initialMem > 0 ? (growthRate / initialMem) * 100 : 0;

    if (growthPercentage > 10) {
      const event: AnomalyEvent = {
        type: 'memory_leak',
        severity: growthPercentage > 20 ? 'critical' : 'warning',
        message: `Memory leak detected: growing at ${growthRate.toFixed(2)} MB/hour (${growthPercentage.toFixed(1)}%)`,
        timestamp: now,
        metrics: {
          current: last.heapUsed,
          previous: first.heapUsed,
          threshold: initialMem * 1.1, // 10% growth
        },
        actions: [
          'save_heap_snapshot',
          'increase_sampling',
          growthPercentage > 20 ? 'alert' : 'log',
        ],
      };

      this.triggerActions(event);
      return event;
    }

    return null;
  }

  /**
   * Trigger actions based on anomaly event
   */
  private triggerActions(event: AnomalyEvent): void {
    for (const action of event.actions) {
      switch (action) {
        case 'increase_sampling':
          // Force sampler to critical state to increase logging
          this.sampler.forceState('critical');
          break;

        case 'save_snapshot': {
          // Save current state snapshot
          const lastSnapshot = this.stateSnapshot.getLastSnapshot();
          if (lastSnapshot) {
            // Snapshot already exists, but we can trigger another one
            console.log('[AnomalyDetector] Saving snapshot due to anomaly');
          }
          break;
        }

        case 'record_profiling':
          // Log performance profiling request
          console.log('[AnomalyDetector] Performance profiling requested');
          break;

        case 'save_heap_snapshot':
          // Log heap snapshot request
          console.log('[AnomalyDetector] Heap snapshot requested');
          break;

        case 'alert':
          // Critical alert - could integrate with alerting system
          console.error('[AnomalyDetector] CRITICAL:', event.message);
          break;

        case 'log':
          // Warning log
          console.warn('[AnomalyDetector] WARNING:', event.message);
          break;
      }
    }
  }

  /**
   * Get memory history (for debugging)
   */
  getMemoryHistory(): Array<{ timestamp: number; heapUsed: number }> {
    return [...this.memoryHistory];
  }

  /**
   * Get check interval (for cleanup if needed)
   */
  getCheckInterval(): NodeJS.Timeout | undefined {
    return this.checkInterval;
  }

  /**
   * Reset detector (for testing)
   */
  reset(): void {
    this.previousMetrics = null;
    this.memoryHistory = [];
  }
}

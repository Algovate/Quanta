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
  // Memory leak detection state
  private memoryLeakBaseline: number | null = null; // Fixed baseline after cooldown or reset
  private memoryLeakLastAlertTime: number | null = null; // Last time memory leak was detected
  private memoryLeakCooldownMs: number = 30 * 60 * 1000; // 30 minutes cooldown
  private memoryLeakMinTimeWindowMs: number = 30 * 60 * 1000; // Minimum 30 minutes to detect trend

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

    // Use snapshot's actual timestamp, not current time
    const snapshotTimestamp = lastSnapshot.timestamp;
    const heapUsed = lastSnapshot.systemMetrics.memoryUsage.heapUsed;

    // Add to history with snapshot's timestamp
    this.memoryHistory.push({ timestamp: snapshotTimestamp, heapUsed });

    // Keep only recent history (last 2 hours for trend analysis)
    const twoHoursAgo = snapshotTimestamp - 2 * 60 * 60 * 1000;
    this.memoryHistory = this.memoryHistory.filter(h => h.timestamp > twoHoursAgo);

    // Keep only last N entries
    if (this.memoryHistory.length > this.maxMemoryHistorySize) {
      this.memoryHistory = this.memoryHistory.slice(-this.maxMemoryHistorySize);
    }

    // Need at least 5 data points to detect trend
    if (this.memoryHistory.length < 5) {
      return null;
    }

    // Check cooldown period - don't alert again if we recently alerted
    const now = Date.now();
    if (this.memoryLeakLastAlertTime !== null) {
      const timeSinceLastAlert = now - this.memoryLeakLastAlertTime;
      if (timeSinceLastAlert < this.memoryLeakCooldownMs) {
        return null; // Still in cooldown
      }
    }

    // Calculate time window for trend detection
    const first = this.memoryHistory[0];
    const last = this.memoryHistory[this.memoryHistory.length - 1];
    const timeSpanMs = last.timestamp - first.timestamp;

    // Require minimum time window (30 minutes) to avoid false positives from short-term fluctuations
    if (timeSpanMs < this.memoryLeakMinTimeWindowMs) {
      return null;
    }

    // Use fixed baseline if available, otherwise use first entry
    let baselineMemory: number;
    let baselineTimestamp: number;

    if (this.memoryLeakBaseline !== null && this.memoryLeakLastAlertTime !== null) {
      // Use fixed baseline from last alert or reset point
      // Find the closest history entry to the baseline time
      const lastAlertTime = this.memoryLeakLastAlertTime;
      const baselineEntry = this.memoryHistory.find(h => h.timestamp >= lastAlertTime) || first;
      baselineMemory = this.memoryLeakBaseline;
      baselineTimestamp = baselineEntry.timestamp;
    } else {
      // First time or after reset - use first entry as baseline
      baselineMemory = first.heapUsed;
      baselineTimestamp = first.timestamp;
      this.memoryLeakBaseline = baselineMemory;
    }

    // Calculate growth from baseline
    const growth = last.heapUsed - baselineMemory;
    const effectiveTimeSpanMs = last.timestamp - baselineTimestamp;
    const effectiveTimeSpanHours = effectiveTimeSpanMs / (60 * 60 * 1000);

    // Add tolerance for normal fluctuations (±5MB or 5% of baseline, whichever is larger)
    const tolerance = Math.max(5, baselineMemory * 0.05);

    // Only consider significant growth beyond tolerance
    if (growth <= tolerance) {
      // Memory is stable or within normal fluctuation - reset baseline if we had one
      if (this.memoryLeakBaseline !== null && this.memoryLeakLastAlertTime !== null) {
        // Memory has stabilized, reset baseline to current value for future checks
        this.memoryLeakBaseline = last.heapUsed;
        this.memoryLeakLastAlertTime = null;
      }
      return null;
    }

    // Calculate growth rate only for significant growth
    const growthRate = effectiveTimeSpanHours > 0 ? growth / effectiveTimeSpanHours : 0; // MB per hour
    const growthPercentage = baselineMemory > 0 ? (growth / baselineMemory) * 100 : 0;

    // Check for sustained growth trend (not just a single spike)
    // Look at recent trend: check if last few points show consistent growth
    const recentPoints = this.memoryHistory.slice(-5); // Last 5 points
    const isConsistentGrowth = recentPoints.every((point, idx) => {
      if (idx === 0) return true;
      return point.heapUsed >= recentPoints[idx - 1].heapUsed - tolerance; // Allow small decreases within tolerance
    });

    // Only alert on consistent growth trend, not one-time spikes
    if (!isConsistentGrowth && growthPercentage < 25) {
      // Not a consistent trend and growth is moderate - don't alert
      return null;
    }

    // Alert if growth exceeds threshold (20% for warning, 40% for critical)
    // This is more conservative than before to reduce false positives
    const warningThreshold = 20; // 20% growth
    const criticalThreshold = 40; // 40% growth

    if (growthPercentage > warningThreshold) {
      const event: AnomalyEvent = {
        type: 'memory_leak',
        severity: growthPercentage > criticalThreshold ? 'critical' : 'warning',
        message: `Memory leak detected: growing at ${growthRate.toFixed(2)} MB/hour (${growthPercentage.toFixed(1)}% over ${effectiveTimeSpanHours.toFixed(1)} hours)`,
        timestamp: snapshotTimestamp,
        metrics: {
          current: last.heapUsed,
          previous: baselineMemory,
          threshold: baselineMemory * (1 + warningThreshold / 100),
        },
        actions: [
          'save_heap_snapshot',
          'increase_sampling',
          growthPercentage > criticalThreshold ? 'alert' : 'log',
        ],
      };

      // Update baseline and alert time
      this.memoryLeakBaseline = last.heapUsed;
      this.memoryLeakLastAlertTime = now;

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
    this.memoryLeakBaseline = null;
    this.memoryLeakLastAlertTime = null;
  }
}

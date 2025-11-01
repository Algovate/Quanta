/**
 * State Snapshot Service - Captures and saves system state
 *
 * Features:
 * - Periodic snapshots (every N cycles, every M minutes)
 * - Operation-level snapshots (before/after key operations)
 * - Automatic snapshots before errors
 * - State difference calculation
 * - State replay (query state at any time point)
 */

import { randomUUID } from 'crypto';
import type { SystemSnapshot, CircuitBreakerState, OperationStatus } from './types.js';
import { MetricsCollector } from './metrics-collector.js';

interface Account {
  equity: number;
  balance: number;
  marginUsed: number;
  availableMargin: number;
}

interface Position {
  symbol: string;
  side: string;
  size: number;
  entryPrice: number;
  unrealizedPnl: number;
}

interface CircuitBreakerInfo {
  name: string;
  state: CircuitBreakerState;
  failureCount: number;
  lastFailure?: number;
  lastSuccess?: number;
}

export class StateSnapshotService {
  private static instance: StateSnapshotService;
  private snapshots: SystemSnapshot[] = [];
  private maxSnapshots: number = 1000; // Keep last 1000 snapshots
  private lastSnapshot?: SystemSnapshot;
  private handlers: Array<(snapshot: SystemSnapshot) => void> = [];
  private metricsCollector: MetricsCollector;

  private constructor() {
    this.metricsCollector = MetricsCollector.getInstance();
  }

  static getInstance(): StateSnapshotService {
    if (!StateSnapshotService.instance) {
      StateSnapshotService.instance = new StateSnapshotService();
    }
    return StateSnapshotService.instance;
  }

  /**
   * Register a handler to receive snapshots
   */
  onSnapshot(handler: (snapshot: SystemSnapshot) => void): void {
    this.handlers.push(handler);
  }

  /**
   * Create a system snapshot
   */
  createSnapshot(
    cycleId: number,
    account: Account,
    positions: Position[],
    circuitBreakers: CircuitBreakerInfo[],
    recentOperations: Array<{
      operationId: string;
      type: string;
      status: OperationStatus;
      duration: number;
    }>
  ): SystemSnapshot {
    const now = Date.now();
    const metrics = this.metricsCollector.createSnapshot(cycleId);
    const memUsage = process.memoryUsage();

    const snapshot: SystemSnapshot = {
      snapshotId: randomUUID(),
      timestamp: now,
      cycleId,
      account,
      positions,
      systemMetrics: {
        uptime: this.metricsCollector.getUptime(),
        errorRate: metrics.errorRate.overall,
        avgCycleTime: metrics.performance.cycleTime.avg,
        memoryUsage: {
          heapUsed: Math.round(memUsage.heapUsed / 1024 / 1024), // MB
          heapTotal: Math.round(memUsage.heapTotal / 1024 / 1024),
          rss: Math.round(memUsage.rss / 1024 / 1024),
        },
        apiLatency: {
          p50: 0,
          p75: 0,
          p90: 0,
          p95: 0,
          p99: 0,
        },
      },
      circuitBreakers: circuitBreakers.map(cb => ({
        name: cb.name,
        state: cb.state,
        failureCount: cb.failureCount,
        lastFailure: cb.lastFailure,
        lastSuccess: cb.lastSuccess,
      })),
      recentOperations,
    };

    // Calculate changes if we have a previous snapshot
    if (this.lastSnapshot) {
      snapshot.changes = {
        equityChange: account.equity - this.lastSnapshot.account.equity,
        positionCountChange: positions.length - this.lastSnapshot.positions.length,
        errorRateChange:
          snapshot.systemMetrics.errorRate - this.lastSnapshot.systemMetrics.errorRate,
        performanceChange:
          this.lastSnapshot.systemMetrics.avgCycleTime > 0
            ? ((snapshot.systemMetrics.avgCycleTime -
                this.lastSnapshot.systemMetrics.avgCycleTime) /
                this.lastSnapshot.systemMetrics.avgCycleTime) *
              100
            : 0,
      };
    }

    // Store snapshot
    this.snapshots.push(snapshot);
    if (this.snapshots.length > this.maxSnapshots) {
      this.snapshots.shift();
    }

    this.lastSnapshot = snapshot;

    // Notify handlers
    for (const handler of this.handlers) {
      try {
        handler(snapshot);
      } catch (error) {
        console.error('Error in snapshot handler:', error);
      }
    }

    return snapshot;
  }

  /**
   * Get the most recent snapshot
   */
  getLastSnapshot(): SystemSnapshot | undefined {
    return this.lastSnapshot;
  }

  /**
   * Get snapshot by ID
   */
  getSnapshotById(snapshotId: string): SystemSnapshot | undefined {
    return this.snapshots.find(s => s.snapshotId === snapshotId);
  }

  /**
   * Get snapshot at or before a specific time
   */
  getSnapshotAtTime(timestamp: number): SystemSnapshot | undefined {
    // Find the closest snapshot before or at the timestamp
    let closest: SystemSnapshot | undefined;
    let closestDiff = Infinity;

    for (const snapshot of this.snapshots) {
      if (snapshot.timestamp <= timestamp) {
        const diff = timestamp - snapshot.timestamp;
        if (diff < closestDiff) {
          closestDiff = diff;
          closest = snapshot;
        }
      }
    }

    return closest;
  }

  /**
   * Get snapshot at or before a specific cycle
   */
  getSnapshotAtCycle(cycleId: number): SystemSnapshot | undefined {
    // Find the closest snapshot at or before the cycle
    let closest: SystemSnapshot | undefined;
    let closestCycle = -1;

    for (const snapshot of this.snapshots) {
      if (snapshot.cycleId <= cycleId && snapshot.cycleId > closestCycle) {
        closestCycle = snapshot.cycleId;
        closest = snapshot;
      }
    }

    return closest;
  }

  /**
   * Get all snapshots in a time range
   */
  getSnapshotsInRange(startTime: number, endTime: number): SystemSnapshot[] {
    return this.snapshots.filter(s => s.timestamp >= startTime && s.timestamp <= endTime);
  }

  /**
   * Get all snapshots in a cycle range
   */
  getSnapshotsInCycleRange(startCycle: number, endCycle: number): SystemSnapshot[] {
    return this.snapshots.filter(s => s.cycleId >= startCycle && s.cycleId <= endCycle);
  }

  /**
   * Get recent snapshots
   */
  getRecentSnapshots(count: number = 10): SystemSnapshot[] {
    return this.snapshots.slice(-count);
  }

  /**
   * Clear old snapshots (keep only recent N)
   */
  clearOldSnapshots(keepCount: number = 100): void {
    if (this.snapshots.length > keepCount) {
      this.snapshots = this.snapshots.slice(-keepCount);
    }
  }

  /**
   * Reset service (for testing)
   */
  reset(): void {
    this.snapshots = [];
    this.lastSnapshot = undefined;
  }
}

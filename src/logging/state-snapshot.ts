/**
 * State Snapshot Service - Captures system state snapshots
 *
 * This module provides state snapshot capture and management capabilities.
 * Currently implemented as a minimal interface.
 */

import { EventEmitter } from 'events';
import type { Position, Account } from '../exchange/types.js';
import type { TradingSignal } from '../types/index.js';
import type { SystemSnapshot } from './types.js';

export class StateSnapshotService extends EventEmitter {
  private static instance: StateSnapshotService;
  private snapshots: SystemSnapshot[] = [];
  private maxSnapshots: number = 100;

  private constructor() {
    super();
  }

  static getInstance(): StateSnapshotService {
    if (!StateSnapshotService.instance) {
      StateSnapshotService.instance = new StateSnapshotService();
    }
    return StateSnapshotService.instance;
  }

  /**
   * Create a snapshot of the current system state
   */
  createSnapshot(
    cycleId: number,
    account: Account,
    positions: Position[],
    _signals: TradingSignal[],
    metrics: Record<string, unknown> = {}
  ): SystemSnapshot {
    // Calculate changes from previous snapshot
    const previousSnapshot = this.snapshots[this.snapshots.length - 1];
    const changes = previousSnapshot
      ? {
          equityChange: account.equity - previousSnapshot.account.equity,
          positionCountChange: positions.length - previousSnapshot.positions.length,
          errorRateChange: 0,
          performanceChange: 0,
        }
      : undefined;

    const snapshot: SystemSnapshot = {
      snapshotId: `snapshot-${cycleId}-${Date.now()}`,
      timestamp: Date.now(),
      cycleId,
      account: {
        balance: account.balance,
        equity: account.equity,
        marginUsed: account.usedMargin,
        availableMargin: account.availableMargin,
      },
      positions: positions.map(p => ({
        symbol: p.symbol,
        side: p.side,
        size: p.size,
        entryPrice: p.entryPrice,
        unrealizedPnl: p.unrealizedPnl,
      })),
      systemMetrics: {
        uptime: process.uptime() * 1000,
        errorRate: 0,
        avgCycleTime: 0,
        memoryUsage: {
          heapUsed: 0,
          heapTotal: 0,
          rss: 0,
        },
        ...metrics,
      },
      circuitBreakers: [],
      recentOperations: [],
      changes,
    };

    this.snapshots.push(snapshot);

    // Limit history size
    if (this.snapshots.length > this.maxSnapshots) {
      this.snapshots.shift();
    }

    // Emit snapshot event
    this.emit('snapshot', snapshot);

    return snapshot;
  }

  /**
   * Get all snapshots
   */
  getAllSnapshots(): SystemSnapshot[] {
    return [...this.snapshots];
  }

  /**
   * Get recent snapshots
   */
  getRecentSnapshots(count: number): SystemSnapshot[] {
    return this.snapshots.slice(-count);
  }

  /**
   * Get snapshot by cycle ID
   */
  getSnapshotByCycleId(cycleId: number): SystemSnapshot | undefined {
    return this.snapshots.find(s => s.cycleId === cycleId);
  }

  /**
   * Get last snapshot
   */
  getLastSnapshot(): SystemSnapshot | undefined {
    return this.snapshots[this.snapshots.length - 1];
  }

  /**
   * Get snapshot by ID
   */
  getSnapshotById(snapshotId: string): SystemSnapshot | undefined {
    return this.snapshots.find(s => s.snapshotId === snapshotId);
  }

  /**
   * Get snapshot at cycle
   */
  getSnapshotAtCycle(cycleId: number): SystemSnapshot | undefined {
    return this.snapshots.find(s => s.cycleId === cycleId);
  }

  /**
   * Reset all snapshots
   */
  reset(): void {
    this.snapshots = [];
  }

  /**
   * Set max snapshots
   */
  setMaxSnapshots(max: number): void {
    this.maxSnapshots = max;
  }

  /**
   * Alias for addListener('snapshot', ...)
   */
  onSnapshot(listener: (snapshot: SystemSnapshot) => void): void {
    this.on('snapshot', listener);
  }

  /**
   * Cleanup old snapshots
   */
  clearOldSnapshots(maxToKeep: number): void {
    if (this.snapshots.length > maxToKeep) {
      this.snapshots = this.snapshots.slice(-maxToKeep);
    }
  }
}

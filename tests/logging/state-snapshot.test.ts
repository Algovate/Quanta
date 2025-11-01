/**
 * Tests for State Snapshot Service
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { StateSnapshotService } from '../../src/logging/state-snapshot.js';

describe('StateSnapshotService', () => {
  let service: StateSnapshotService;

  beforeEach(() => {
    service = StateSnapshotService.getInstance();
    service.reset();
  });

  describe('createSnapshot', () => {
    it('should create a snapshot with all required fields', () => {
      const snapshot = service.createSnapshot(
        1,
        {
          equity: 10000,
          balance: 10000,
          marginUsed: 0,
          availableMargin: 10000,
        },
        [],
        [],
        []
      );

      expect(snapshot.snapshotId).toBeDefined();
      expect(snapshot.timestamp).toBeDefined();
      expect(snapshot.cycleId).toBe(1);
      expect(snapshot.account.equity).toBe(10000);
      expect(snapshot.systemMetrics).toBeDefined();
      expect(snapshot.systemMetrics.uptime).toBeGreaterThanOrEqual(0);
      expect(snapshot.systemMetrics.memoryUsage).toBeDefined();
    });

    it('should include positions in snapshot', () => {
      const snapshot = service.createSnapshot(
        1,
        {
          equity: 10000,
          balance: 10000,
          marginUsed: 500,
          availableMargin: 9500,
        },
        [
          {
            symbol: 'BTC/USDT',
            side: 'long',
            size: 0.1,
            entryPrice: 45000,
            unrealizedPnl: 50,
          },
        ],
        [],
        []
      );

      expect(snapshot.positions).toHaveLength(1);
      expect(snapshot.positions[0].symbol).toBe('BTC/USDT');
      expect(snapshot.account.marginUsed).toBe(500);
    });

    it('should include circuit breaker states', () => {
      const snapshot = service.createSnapshot(
        1,
        {
          equity: 10000,
          balance: 10000,
          marginUsed: 0,
          availableMargin: 10000,
        },
        [],
        [
          {
            name: 'OpenRouter',
            state: 'CLOSED',
            failureCount: 0,
          },
          {
            name: 'Exchange',
            state: 'OPEN',
            failureCount: 5,
            lastFailure: Date.now() - 1000,
          },
        ],
        []
      );

      expect(snapshot.circuitBreakers).toHaveLength(2);
      expect(snapshot.circuitBreakers[0].state).toBe('CLOSED');
      expect(snapshot.circuitBreakers[1].state).toBe('OPEN');
    });
  });

  describe('change calculation', () => {
    it('should calculate changes between snapshots', () => {
      // First snapshot
      service.createSnapshot(
        1,
        {
          equity: 10000,
          balance: 10000,
          marginUsed: 0,
          availableMargin: 10000,
        },
        [],
        [],
        []
      );

      // Second snapshot with changes
      const snapshot2 = service.createSnapshot(
        2,
        {
          equity: 10100,
          balance: 10050,
          marginUsed: 100,
          availableMargin: 10000,
        },
        [
          {
            symbol: 'BTC/USDT',
            side: 'long',
            size: 0.1,
            entryPrice: 45000,
            unrealizedPnl: 50,
          },
        ],
        [],
        []
      );

      expect(snapshot2.changes).toBeDefined();
      expect(snapshot2.changes?.equityChange).toBe(100);
      expect(snapshot2.changes?.positionCountChange).toBe(1);
    });
  });

  describe('snapshot queries', () => {
    beforeEach(() => {
      // Create multiple snapshots
      for (let i = 1; i <= 10; i++) {
        service.createSnapshot(
          i,
          {
            equity: 10000 + i * 10,
            balance: 10000 + i * 10,
            marginUsed: 0,
            availableMargin: 10000 + i * 10,
          },
          [],
          [],
          []
        );
      }
    });

    it('should get last snapshot', () => {
      const last = service.getLastSnapshot();
      expect(last).toBeDefined();
      expect(last?.cycleId).toBe(10);
    });

    it('should get snapshot by ID', () => {
      const last = service.getLastSnapshot();
      if (!last) {
        throw new Error('No snapshot found');
      }

      const found = service.getSnapshotById(last.snapshotId);
      expect(found).toBeDefined();
      expect(found?.snapshotId).toBe(last.snapshotId);
    });

    it('should get snapshot at cycle', () => {
      const snapshot = service.getSnapshotAtCycle(5);
      expect(snapshot).toBeDefined();
      expect(snapshot?.cycleId).toBe(5);
    });

    it('should get snapshots in cycle range', () => {
      const snapshots = service.getSnapshotsInCycleRange(3, 7);
      expect(snapshots.length).toBe(5);
      expect(snapshots[0].cycleId).toBe(3);
      expect(snapshots[snapshots.length - 1].cycleId).toBe(7);
    });

    it('should get snapshots in time range', () => {
      const first = service.getSnapshotAtCycle(1);
      const last = service.getLastSnapshot();
      if (!first || !last) {
        throw new Error('Snapshots not found');
      }

      const snapshots = service.getSnapshotsInRange(first.timestamp, last.timestamp);
      expect(snapshots.length).toBe(10);
    });

    it('should get recent snapshots', () => {
      const recent = service.getRecentSnapshots(5);
      expect(recent.length).toBe(5);
      expect(recent[0].cycleId).toBe(6);
      expect(recent[recent.length - 1].cycleId).toBe(10);
    });
  });

  describe('handler notification', () => {
    it('should notify handlers on snapshot creation', () => {
      let handlerCalled = false;
      let receivedSnapshot: any = null;

      service.onSnapshot(snapshot => {
        handlerCalled = true;
        receivedSnapshot = snapshot;
      });

      const snapshot = service.createSnapshot(
        1,
        {
          equity: 10000,
          balance: 10000,
          marginUsed: 0,
          availableMargin: 10000,
        },
        [],
        [],
        []
      );

      expect(handlerCalled).toBe(true);
      expect(receivedSnapshot).toBeDefined();
      expect(receivedSnapshot.snapshotId).toBe(snapshot.snapshotId);
    });
  });

  describe('cleanup', () => {
    it('should clear old snapshots', () => {
      // Create many snapshots
      for (let i = 1; i <= 200; i++) {
        service.createSnapshot(
          i,
          {
            equity: 10000,
            balance: 10000,
            marginUsed: 0,
            availableMargin: 10000,
          },
          [],
          [],
          []
        );
      }

      service.clearOldSnapshots(100);

      const recent = service.getRecentSnapshots(200);
      expect(recent.length).toBeLessThanOrEqual(100);
    });
  });
});

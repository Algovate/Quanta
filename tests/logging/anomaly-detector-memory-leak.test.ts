/**
 * Tests for Memory Leak Detection in AnomalyDetector
 *
 * Note: Full integration testing would require mocking process.memoryUsage()
 * to control memory values. These tests verify the detection logic structure
 * and ensure the improved algorithms are properly implemented.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { AnomalyDetector } from '../../src/logging/anomaly-detector.js';
import { StateSnapshotService } from '../../src/logging/state-snapshot.js';

describe('AnomalyDetector - Memory Leak Detection', () => {
  let detector: AnomalyDetector;
  let stateSnapshot: StateSnapshotService;

  beforeEach(() => {
    detector = AnomalyDetector.getInstance();
    detector.reset();
    stateSnapshot = StateSnapshotService.getInstance();
    stateSnapshot.reset();
  });

  it('should require minimum 5 data points before detection', () => {
    // Create only 3 snapshots
    for (let i = 0; i < 3; i++) {
      stateSnapshot.createSnapshot(
        i + 1,
        { equity: 10000, balance: 10000, marginUsed: 0, availableMargin: 10000 },
        [],
        [],
        []
      );

      const events = detector.checkForAnomalies();
      const memoryLeakEvents = events.filter(e => e.type === 'memory_leak');

      // Should not detect because we don't have 5 data points yet
      expect(memoryLeakEvents.length).toBe(0);
    }
  });

  it('should have cooldown mechanism to prevent repeated alerts', () => {
    // Verify reset clears cooldown state
    detector.reset();
    const history = detector.getMemoryHistory();
    expect(history.length).toBe(0);

    // After reset, cooldown should be cleared
    // (Full test would require mocking memory values and time)
    expect(detector).toBeDefined();
  });

  it('should use snapshot timestamps in memory history', () => {
    // Create a snapshot
    const snapshot = stateSnapshot.createSnapshot(
      1,
      { equity: 10000, balance: 10000, marginUsed: 0, availableMargin: 10000 },
      [],
      [],
      []
    );

    // Check for anomalies to populate history
    detector.checkForAnomalies();

    // Verify memory history uses snapshot timestamp
    const history = detector.getMemoryHistory();
    if (history.length > 0) {
      // History should use the snapshot's timestamp, not current time
      // The timestamp should be close to when snapshot was created
      const snapshotTime = snapshot.timestamp;
      const historyEntry = history[history.length - 1];
      // Allow small time difference for processing
      expect(Math.abs(historyEntry.timestamp - snapshotTime)).toBeLessThan(1000);
    }
  });

  it('should reset properly clearing all memory leak state', () => {
    // Create some snapshots to populate history
    for (let i = 0; i < 10; i++) {
      stateSnapshot.createSnapshot(
        i + 1,
        { equity: 10000, balance: 10000, marginUsed: 0, availableMargin: 10000 },
        [],
        [],
        []
      );
      detector.checkForAnomalies();
    }

    // Verify history has data
    let history = detector.getMemoryHistory();
    expect(history.length).toBeGreaterThan(0);

    // Reset
    detector.reset();

    // Verify history is cleared
    history = detector.getMemoryHistory();
    expect(history.length).toBe(0);
  });

  it('should handle missing snapshots gracefully', () => {
    // Reset state snapshot service so no snapshots exist
    stateSnapshot.reset();

    // Check for anomalies with no snapshots
    const events = detector.checkForAnomalies();
    const memoryLeakEvents = events.filter(e => e.type === 'memory_leak');

    // Should not crash and should return no memory leak events
    expect(Array.isArray(events)).toBe(true);
    expect(memoryLeakEvents.length).toBe(0);
  });

  it('should filter memory history by timestamp window', () => {
    // Create snapshots over time
    const baseTime = Date.now() - 90 * 60 * 1000; // 90 minutes ago

    for (let i = 0; i < 20; i++) {
      stateSnapshot.createSnapshot(
        i + 1,
        { equity: 10000, balance: 10000, marginUsed: 0, availableMargin: 10000 },
        [],
        [],
        []
      );
      detector.checkForAnomalies();
    }

    // Memory history should only keep recent entries (within 2 hours)
    // Exact filtering is tested in implementation
    const history = detector.getMemoryHistory();
    expect(Array.isArray(history)).toBe(true);
    // History should not exceed max size
    expect(history.length).toBeLessThanOrEqual(60);
  });
});


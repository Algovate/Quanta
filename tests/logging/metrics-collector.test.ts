/**
 * Tests for Metrics Collector
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { MetricsCollector } from '../../src/logging/metrics-collector.js';

describe('MetricsCollector', () => {
  let collector: MetricsCollector;

  beforeEach(() => {
    collector = MetricsCollector.getInstance();
    collector.reset();
  });

  describe('cycle time tracking', () => {
    it('should track cycle execution times', () => {
      collector.recordCycleTime(1, 1000);
      collector.recordCycleTime(2, 1500);
      collector.recordCycleTime(3, 800);
      collector.recordCycleTime(4, 2000);
      collector.recordCycleTime(5, 1200);

      const stats = collector.getCycleTimeStats();
      expect(stats.avg).toBeCloseTo(1300, 0);
      expect(stats.p50).toBe(1200);
      expect(stats.p95).toBeGreaterThanOrEqual(1500);
      expect(stats.p99).toBeGreaterThanOrEqual(1800);
    });
  });

  describe('error rate calculation', () => {
    it('should calculate error rate', () => {
      collector.recordError('NetworkError', 1);
      collector.recordError('NetworkError', 2);
      collector.recordError('TimeoutError', 3);
      collector.recordCycleTime(1, 1000);
      collector.recordCycleTime(2, 1000);
      collector.recordCycleTime(3, 1000);

      const errorRate = collector.getErrorRate();
      expect(errorRate).toBeGreaterThan(0);
    });

    it('should track errors by type', () => {
      collector.recordError('NetworkError', 1);
      collector.recordError('NetworkError', 2);
      collector.recordError('TimeoutError', 3);

      const snapshot = collector.createSnapshot(1);
      expect(snapshot.errorRate.byType['NetworkError']).toBe(2);
      expect(snapshot.errorRate.byType['TimeoutError']).toBe(1);
    });
  });

  describe('API latency tracking', () => {
    it('should track API call latencies', () => {
      collector.recordAPILatency('exchange.getTicker', 50);
      collector.recordAPILatency('exchange.getTicker', 60);
      collector.recordAPILatency('exchange.getTicker', 70);
      collector.recordAPILatency('exchange.getTicker', 80);
      collector.recordAPILatency('exchange.getTicker', 100);

      const snapshot = collector.createSnapshot(1);
      const tickerLatency = snapshot.performance.apiLatency['exchange.getTicker'];
      expect(tickerLatency).toBeDefined();
      expect(tickerLatency.p50).toBe(70);
      expect(tickerLatency.p95).toBeGreaterThanOrEqual(90);
      expect(tickerLatency.count).toBe(5);
    });
  });

  describe('operation time tracking', () => {
    it('should track operation execution times', () => {
      collector.recordOperationTime('order_execution', 200);
      collector.recordOperationTime('order_execution', 250);
      collector.recordOperationTime('order_execution', 300);
      collector.recordOperationTime('signal_generation', 1500);
      collector.recordOperationTime('signal_generation', 1800);

      const snapshot = collector.createSnapshot(1);
      const orderTime = snapshot.performance.operationTime['order_execution'];
      const signalTime = snapshot.performance.operationTime['signal_generation'];

      expect(orderTime).toBeDefined();
      expect(orderTime.p50).toBe(250);
      expect(orderTime.count).toBe(3);

      expect(signalTime).toBeDefined();
      expect(signalTime.count).toBe(2);
    });
  });

  describe('business metrics', () => {
    it('should track signal generation success rate', () => {
      collector.recordSignalGeneration(true);
      collector.recordSignalGeneration(true);
      collector.recordSignalGeneration(false);
      collector.recordSignalGeneration(true);

      const snapshot = collector.createSnapshot(1);
      expect(snapshot.business.signalGenerationSuccess).toBeCloseTo(0.75, 2);
    });

    it('should track order execution success rate', () => {
      collector.recordOrderExecution(true);
      collector.recordOrderExecution(true);
      collector.recordOrderExecution(false);
      collector.recordOrderExecution(true);
      collector.recordOrderExecution(true);

      const snapshot = collector.createSnapshot(1);
      expect(snapshot.business.orderExecutionSuccess).toBeCloseTo(0.8, 2);
    });

    it('should track position profitability', () => {
      collector.recordPositionProfitability(100);
      collector.recordPositionProfitability(-50);
      collector.recordPositionProfitability(200);
      collector.recordPositionProfitability(50);

      const snapshot = collector.createSnapshot(1);
      expect(snapshot.business.positionProfitability).toBeCloseTo(0.75, 2); // 3 out of 4 profitable
    });
  });

  describe('snapshot creation', () => {
    it('should create complete metrics snapshot', () => {
      collector.recordCycleTime(1, 1000);
      collector.recordError('TestError', 1);
      collector.recordAPILatency('test.endpoint', 50);
      collector.recordOperationTime('test_op', 100);

      const snapshot = collector.createSnapshot(1);

      expect(snapshot.timestamp).toBeDefined();
      expect(snapshot.cycleId).toBe(1);
      expect(snapshot.errorRate).toBeDefined();
      expect(snapshot.performance).toBeDefined();
      expect(snapshot.business).toBeDefined();
      expect(snapshot.performance.cycleTime.p50).toBeDefined();
    });
  });

  describe('percentile calculation', () => {
    it('should calculate percentiles correctly', () => {
      // Add values in order to test percentile calculation
      const values = [10, 20, 30, 40, 50, 60, 70, 80, 90, 100];
      for (const value of values) {
        collector.recordCycleTime(1, value);
      }

      const stats = collector.getCycleTimeStats();
      expect(stats.p50).toBe(50);
      expect(stats.p90).toBe(90);
      expect(stats.p95).toBe(95);
      expect(stats.p99).toBe(99);
      expect(stats.avg).toBe(55);
    });
  });
});

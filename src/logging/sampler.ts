/**
 * Intelligent Sampler - Automatically adjusts logging verbosity
 *
 * Features:
 * - Adaptive sampling based on error rate
 * - Different sampling rates for different log types
 * - Automatic adjustment based on system state
 */

import type { SamplingConfig } from './types.js';
import { MetricsCollector } from './metrics-collector.js';

export type SamplingState = 'normal' | 'warning' | 'critical';

export class Sampler {
  private static instance: Sampler;
  private config: SamplingConfig;
  private metricsCollector: MetricsCollector;
  private currentState: SamplingState = 'normal';
  private lastStateChange: number = Date.now();

  private constructor() {
    this.metricsCollector = MetricsCollector.getInstance();
    this.config = this.createDefaultConfig();
  }

  static getInstance(): Sampler {
    if (!Sampler.instance) {
      Sampler.instance = new Sampler();
    }
    return Sampler.instance;
  }

  /**
   * Create default sampling configuration
   */
  private createDefaultConfig(): SamplingConfig {
    return {
      normal: {
        operationLogRate: 1.0, // 100% - Always log operations
        systemLogRate: 0.1, // 10% - Sample system logs
        apiLogRate: 0.0, // 0% - Only aggregate, don't log each call
        debugLogRate: 0.0, // 0% - Debug off by default
      },
      warning: {
        operationLogRate: 1.0, // 100% - Always log operations
        systemLogRate: 0.2, // 20% - More system logs
        apiLogRate: 0.1, // 10% - Log failed API calls
        debugLogRate: 0.3, // 30% - Some debug logs
      },
      critical: {
        operationLogRate: 1.0, // 100% - Always log operations
        systemLogRate: 1.0, // 100% - All system logs
        apiLogRate: 1.0, // 100% - All API logs
        debugLogRate: 1.0, // 100% - All debug logs
      },
    };
  }

  /**
   * Update sampling configuration
   */
  updateConfig(config: Partial<SamplingConfig>): void {
    this.config = {
      ...this.config,
      ...config,
    };
  }

  /**
   * Evaluate current system state based on error rate and metrics
   */
  private evaluateState(): SamplingState {
    const errorRate = this.metricsCollector.getErrorRate();
    const cycleTimeStats = this.metricsCollector.getCycleTimeStats();

    // Critical: Very high error rate or significant performance degradation
    if (
      errorRate > 0.05 ||
      (cycleTimeStats.p95 / cycleTimeStats.avg > 2 && cycleTimeStats.avg > 0)
    ) {
      return 'critical';
    }

    // Warning: Moderate error rate or slight performance issues
    if (errorRate > 0.01 || cycleTimeStats.p95 / cycleTimeStats.avg > 1.5) {
      return 'warning';
    }

    // Normal: Low error rate and good performance
    return 'normal';
  }

  /**
   * Update state based on current metrics
   */
  updateState(): SamplingState {
    const newState = this.evaluateState();

    if (newState !== this.currentState) {
      const oldState = this.currentState;
      this.currentState = newState;
      this.lastStateChange = Date.now();

      // Log state change if transitioning to warning or critical
      if (newState === 'warning' || newState === 'critical') {
        console.log(`[Sampler] State changed: ${oldState} -> ${newState}`, {
          errorRate: this.metricsCollector.getErrorRate(),
          timestamp: Date.now(),
        });
      }
    }

    return this.currentState;
  }

  /**
   * Should log based on log type and current state
   */
  shouldLog(
    logType: 'operation' | 'system' | 'api' | 'debug',
    errorOccurred: boolean = false
  ): boolean {
    // Always log errors regardless of sampling rate
    if (errorOccurred) {
      return true;
    }

    // Update state based on current metrics
    this.updateState();

    const stateConfig = this.config[this.currentState];
    let rate = 0;

    switch (logType) {
      case 'operation':
        rate = stateConfig.operationLogRate;
        break;
      case 'system':
        rate = stateConfig.systemLogRate;
        break;
      case 'api':
        rate = stateConfig.apiLogRate;
        break;
      case 'debug':
        rate = stateConfig.debugLogRate;
        break;
    }

    // 100% rate means always log
    if (rate >= 1.0) {
      return true;
    }

    // 0% rate means never log
    if (rate <= 0) {
      return false;
    }

    // Random sampling based on rate
    return Math.random() < rate;
  }

  /**
   * Get current sampling state
   */
  getState(): SamplingState {
    return this.currentState;
  }

  /**
   * Get current sampling configuration
   */
  getConfig(): SamplingConfig {
    return { ...this.config };
  }

  /**
   * Get sampling rate for a specific log type
   */
  getSamplingRate(logType: 'operation' | 'system' | 'api' | 'debug'): number {
    this.updateState();
    const stateConfig = this.config[this.currentState];

    switch (logType) {
      case 'operation':
        return stateConfig.operationLogRate;
      case 'system':
        return stateConfig.systemLogRate;
      case 'api':
        return stateConfig.apiLogRate;
      case 'debug':
        return stateConfig.debugLogRate;
    }
  }

  /**
   * Force state (for testing)
   */
  forceState(state: SamplingState): void {
    this.currentState = state;
    this.lastStateChange = Date.now();
  }

  /**
   * Get time since last state change
   */
  getTimeSinceStateChange(): number {
    return Date.now() - this.lastStateChange;
  }
}

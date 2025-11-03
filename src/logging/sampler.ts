/**
 * Sampler - Controls logging rates based on system state
 *
 * This module provides adaptive sampling capabilities.
 * Currently implemented as a minimal interface.
 */

import type { SamplingConfig } from './types.js';

export type SamplerState = 'normal' | 'warning' | 'critical';

export class Sampler {
  private static instance: Sampler;
  private config: SamplingConfig;
  private state: SamplerState = 'normal';

  private constructor() {
    this.config = {
      normal: {
        operationLogRate: 1.0,
        systemLogRate: 1.0,
        apiLogRate: 1.0,
        debugLogRate: 0.0,
      },
      warning: {
        operationLogRate: 1.5,
        systemLogRate: 1.5,
        apiLogRate: 1.5,
        debugLogRate: 0.5,
      },
      critical: {
        operationLogRate: 2.0,
        systemLogRate: 2.0,
        apiLogRate: 2.0,
        debugLogRate: 1.0,
      },
    };
  }

  static getInstance(): Sampler {
    if (!Sampler.instance) {
      Sampler.instance = new Sampler();
    }
    return Sampler.instance;
  }

  /**
   * Get current configuration
   */
  getConfig(): SamplingConfig {
    return this.config;
  }

  /**
   * Get current state
   */
  getState(): SamplerState {
    return this.state;
  }

  /**
   * Force a specific state (for testing)
   */
  forceState(state: SamplerState): void {
    this.state = state;
  }

  /**
   * Determine if log should be emitted
   */
  shouldLog(type: 'operation' | 'system' | 'api' | 'debug', isError: boolean): boolean {
    // Always log errors
    if (isError) return true;

    const config = this.config[this.state];
    switch (type) {
      case 'operation':
        return config.operationLogRate >= 1.0;
      case 'system':
        return config.systemLogRate >= 1.0;
      case 'api':
        return config.apiLogRate >= 1.0;
      case 'debug':
        return config.debugLogRate >= 1.0;
      default:
        return true;
    }
  }
}

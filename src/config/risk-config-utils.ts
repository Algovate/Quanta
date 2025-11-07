/**
 * Risk Configuration Utilities
 * Helper functions for extracting risk configuration from Config
 */

import type { Config } from './settings.js';
import type { RiskParams } from '../execution/risk.js';

export interface DynamicReserveConfig {
  enabled?: boolean;
  minReservePercent?: number;
  maxReservePercent?: number;
}

/**
 * Extract dynamic reserve configuration from Config
 */
export function extractDynamicReserveConfig(config: Config): DynamicReserveConfig | undefined {
  const riskConfig = (config.trading as any)?.risk;
  if (!riskConfig?.dynamicReserve) {
    return undefined;
  }

  return {
    enabled: riskConfig.dynamicReserve.enabled,
    minReservePercent: riskConfig.dynamicReserve.minReservePercent,
    maxReservePercent: riskConfig.dynamicReserve.maxReservePercent,
  };
}

/**
 * Build RiskParams from Config with dynamic reserve support
 */
export function buildRiskParams(config: Config, overrides?: Partial<RiskParams>): RiskParams {
  const dynamicReserve = extractDynamicReserveConfig(config);

  return {
    maxRiskPerTrade: config.trading.maxRisk,
    maxTotalRisk: 0.3,
    defaultStopLoss: config.trading.stopLoss,
    maxLeverage: config.trading.leverageRange[1],
    minLeverage: config.trading.leverageRange[0],
    maxPositions: config.trading.maxPositions,
    // Dynamic reserve configuration
    dynamicReserveEnabled: dynamicReserve?.enabled,
    minReservePercent: dynamicReserve?.minReservePercent,
    maxReservePercent: dynamicReserve?.maxReservePercent,
    ...overrides,
  };
}

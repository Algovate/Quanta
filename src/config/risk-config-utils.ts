/**
 * Risk Configuration Utilities
 * Helper functions for extracting risk configuration from Config
 */

import type { Config } from './settings.js';

export { type DynamicReserveConfig } from '../execution/risk/dynamic-reserve.js';

/**
 * Extract dynamic reserve configuration from Config
 */
export function extractDynamicReserveConfig(config: Config) {
  const riskConfig = config.trading.risk;
  if (!riskConfig?.dynamicReserve) {
    return undefined;
  }

  return {
    enabled: riskConfig.dynamicReserve.enabled,
    minReservePercent: riskConfig.dynamicReserve.minReservePercent,
    maxReservePercent: riskConfig.dynamicReserve.maxReservePercent,
    baseReservePercent: riskConfig.dynamicReserve.baseReservePercent,
  };
}

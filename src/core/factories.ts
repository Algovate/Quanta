import { MarketDataProvider } from '../data/market.js';
import { createAIClient } from '../ai/factory.js';
import type { IAIClient } from '../ai/types.js';
import { Exchange } from '../exchange/types.js';
import { UnifiedLogger } from '../logging/index.js';
import type { Config } from '../config/settings.js';
import type { WorkflowConfig } from '../types/index.js';
import { extractDynamicReserveConfig } from '../config/risk-config-utils.js';

export function createWorkflowDeps(
  exchange: Exchange,
  config: Config,
  coins: string[]
): {
  marketProvider: MarketDataProvider;
  aiClient: IAIClient;
  workflowConfig: WorkflowConfig;
} {
  const marketProvider = new MarketDataProvider(exchange);
  // Create AI client using factory
  const aiClient = createAIClient(config);
  // Log will be emitted by factory
  // Derive guard bands from market type
  const mt = (config.exchange?.marketType || '').toLowerCase();
  const bands =
    mt === 'swap' || mt === 'perp' || mt === 'perpetual'
      ? {
          levMin: 3,
          levMax: 10,
          slMin: 0.01,
          slMax: 0.02,
          riskMin: 0.01,
          riskMax: 0.02,
          posMin: 1,
          posMax: 4,
        }
      : mt === 'spot'
        ? {
            levMin: 1,
            levMax: 1,
            slMin: 0.03,
            slMax: 0.07,
            riskMin: 0.03,
            riskMax: 0.05,
            posMin: 6,
            posMax: 10,
          }
        : null;

  const clamp = (v: number, min: number, max: number) => Math.max(min, Math.min(max, v));

  const userLevMin = config.trading.leverageRange[0];
  const userLevMax = config.trading.leverageRange[1];
  const userSL = config.trading.stopLoss;
  const userRisk = config.trading.maxRisk;
  const userMaxPos = config.trading.maxPositions;

  const effLevMin = bands ? clamp(userLevMin, bands.levMin, bands.levMax) : userLevMin;
  const effLevMax = bands ? clamp(userLevMax, bands.levMin, bands.levMax) : userLevMax;
  const effSL = bands ? clamp(userSL, bands.slMin, bands.slMax) : userSL;
  const effRisk = bands ? clamp(userRisk, bands.riskMin, bands.riskMax) : userRisk;
  const effMaxPos = bands ? clamp(userMaxPos, bands.posMin, bands.posMax) : userMaxPos;

  const workflowConfig: WorkflowConfig = {
    coins,
    cyclePeriod: config.trading.cyclePeriod,
    maxPositions: effMaxPos,
    marketFetchParallel: (config as any)?.trading?.marketFetchParallel,
    riskParams: {
      maxRiskPerTrade: effRisk,
      maxTotalRisk: 0.3,
      defaultStopLoss: effSL,
      maxLeverage: effLevMax,
      minLeverage: effLevMin,
      maxPositions: effMaxPos,
      // Dynamic reserve configuration from config.trading.risk.dynamicReserve
      ...(extractDynamicReserveConfig(config) || {}),
    },
  };
  // Emit warnings when clamping altered user-provided values
  if (bands) {
    const logger = UnifiedLogger.getInstance();
    const context = 'RiskGuard';
    const formatPercent = (val: number, isPercent: boolean) => {
      if (isPercent) return `${(val * 100).toFixed(1)}%`;
      return val.toString();
    };
    const warn = (name: string, prev: number, next: number, isPercent = false) => {
      if (prev !== next) {
        logger.warn(
          `[risk-guard] Clamped ${name}: ${formatPercent(prev, isPercent)} -> ${formatPercent(next, isPercent)} for marketType=${mt}`,
          {},
          context
        );
      }
    };
    warn('leverage.min', userLevMin, effLevMin);
    warn('leverage.max', userLevMax, effLevMax);
    warn('stopLoss', userSL, effSL, true);
    warn('maxRisk', userRisk, effRisk, true);
    warn('maxPositions', userMaxPos, effMaxPos);

    // Show summary of all parameters after validation
    logger.info(`[risk-guard] Risk parameters for marketType=${mt}:`, {}, context);
    logger.info(`   Leverage: ${effLevMin}x - ${effLevMax}x`, {}, context);
    logger.info(
      `   Stop Loss: ${(effSL * 100).toFixed(1)}% (range: ${(bands.slMin * 100).toFixed(1)}% - ${(bands.slMax * 100).toFixed(1)}%)`,
      {},
      context
    );
    logger.info(
      `   Max Risk: ${(effRisk * 100).toFixed(1)}% (range: ${(bands.riskMin * 100).toFixed(1)}% - ${(bands.riskMax * 100).toFixed(1)}%)`,
      {},
      context
    );
    logger.info(
      `   Max Positions: ${effMaxPos} (range: ${bands.posMin} - ${bands.posMax})`,
      {},
      context
    );
  }
  return { marketProvider, aiClient, workflowConfig };
}

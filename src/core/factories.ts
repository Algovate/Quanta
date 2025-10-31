import { MarketDataProvider } from '../data/market.js';
import { OpenRouterClient } from '../ai/agent.js';
import { Exchange } from '../exchange/types.js';
import type { Config } from '../config/settings.js';
import type { WorkflowConfig } from '../types/index.js';

export function createWorkflowDeps(
  exchange: Exchange,
  config: Config,
  coins: string[]
): {
  marketProvider: MarketDataProvider;
  aiClient: OpenRouterClient;
  workflowConfig: WorkflowConfig;
} {
  const marketProvider = new MarketDataProvider(exchange);
  const aiClient = new OpenRouterClient(config.ai.apiKey);
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
    },
  };
  // Emit warnings when clamping altered user-provided values
  if (bands) {
    const warn = (name: string, prev: number, next: number) => {
      if (prev !== next)
        console.warn(`[risk-guard] Clamped ${name}: ${prev} -> ${next} for marketType=${mt}`);
    };
    warn('leverage.min', userLevMin, effLevMin);
    warn('leverage.max', userLevMax, effLevMax);
    warn('stopLoss', userSL, effSL);
    warn('maxRisk', userRisk, effRisk);
    warn('maxPositions', userMaxPos, effMaxPos);
  }
  return { marketProvider, aiClient, workflowConfig };
}

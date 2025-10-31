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
  const workflowConfig: WorkflowConfig = {
    coins,
    cyclePeriod: config.trading.cyclePeriod,
    maxPositions: config.trading.maxPositions,
    marketFetchParallel: (config as any)?.trading?.marketFetchParallel,
    riskParams: {
      maxRiskPerTrade: config.trading.maxRisk,
      maxTotalRisk: 0.3,
      defaultStopLoss: config.trading.stopLoss,
      maxLeverage: config.trading.leverageRange[1],
      minLeverage: config.trading.leverageRange[0],
      maxPositions: config.trading.maxPositions,
    },
  };
  return { marketProvider, aiClient, workflowConfig };
}

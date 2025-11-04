import { z } from 'zod';

/**
 * Zod schema for validating arena configuration
 */
export const ArenaConfigSchema = z.object({
  name: z.string(),
  mode: z.enum(['backtest', 'paper']),
  drones: z.array(
    z.object({
      id: z.string(),
      name: z.string(),
      coins: z.array(z.string()),
      promptPack: z.string(),
      initialBalance: z.number(),
      riskParams: z.object({
        maxRiskPerTrade: z.number(),
        maxTotalRisk: z.number(),
        defaultStopLoss: z.number(),
        maxLeverage: z.number(),
        minLeverage: z.number(),
        maxPositions: z.number(),
      }),
      aiConfig: z
        .object({
          model: z.string().optional(),
          temperature: z.number().optional(),
        })
        .optional(),
    })
  ),
  settings: z
    .object({
      maxConcurrentAICalls: z.number().optional(),
      cyclePeriod: z.number().optional(),
      maxDuration: z.number().optional(),
    })
    .optional(),
});

/**
 * Arena trade as returned by the API
 */
export interface ArenaTrade {
  id: string;
  timestamp: number;
  droneId: string;
  droneName: string;
  symbol: string;
  side: 'buy' | 'sell';
  size: number;
  entryPrice: number;
  exitPrice?: number;
  pnl?: number;
  pnlPercent?: number;
  leverage?: number;
  status: 'open' | 'closed' | 'partial';
}

/**
 * Arena config summary for listing
 */
export interface ArenaConfigSummary {
  name: string;
  fileName: string;
  configName: string;
  mode: 'backtest' | 'paper';
  droneCount: number;
  promptPacks: string[];
  modified: string;
}

/**
 * Standard API response wrapper
 */
export interface ApiResponse<T = unknown> {
  success: boolean;
  [key: string]: unknown;
  data?: T;
}

/**
 * Query parameters for paginated endpoints
 */
export interface PaginationParams {
  limit?: number;
  offset?: number;
}

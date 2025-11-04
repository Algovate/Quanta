import type { ArenaOrchestrator } from '../../../arena/index.js';
import type { ArenaManager } from '../../../arena/index.js';
import { UnifiedLogger } from '../../../logging/index.js';
import { getArenaOrThrow, getArenaConfigDir } from './utils.js';
import type { ArenaTrade, ArenaConfigSummary } from './types.js';
import type { ArenaConfig } from '../../../arena/types.js';
import { readdirSync, statSync, readFileSync } from 'fs';
import { join } from 'path';

/**
 * Service layer for arena-related business logic
 */
export class ArenaService {
  constructor(public readonly arenaManager: ArenaManager) {}

  /**
   * Get arena by ID or throw error
   */
  getArena(arenaId: string): ArenaOrchestrator {
    return getArenaOrThrow(this.arenaManager, arenaId);
  }

  /**
   * Collect completed trades from all drones in an arena
   */
  collectTradesFromDrones(arena: ArenaOrchestrator, limit: number): ArenaTrade[] {
    const allTrades: ArenaTrade[] = [];
    const drones = arena.getAllDrones();

    for (const drone of drones) {
      try {
        const workflow = drone.getWorkflow();
        const exchange = workflow.getExchange();
        const config = drone.getConfig();

        // Get completed trades if exchange supports it
        if (exchange && typeof exchange.getCompletedTrades === 'function') {
          const completedTrades = exchange.getCompletedTrades();
          if (completedTrades && Array.isArray(completedTrades)) {
            for (const trade of completedTrades) {
              // Convert CompletedTrade format to API format
              // CompletedTrade has: { id, symbol, side: 'long'|'short', entryTime, exitTime, entryPrice, exitPrice, size, pnl, pnlPercent, holdingPeriod, reason }
              // Note: CompletedTrade.side is the position side (long/short), not the exit order side
              // For display: long position exit = sell order, short position exit = buy order
              // API needs: { id, timestamp, droneId, droneName, symbol, side: 'buy'|'sell', size, entryPrice, exitPrice, pnl, pnlPercent, leverage?, status }
              allTrades.push({
                id: `${config.id}-${trade.id}`,
                timestamp: trade.exitTime, // Use exit time as timestamp for completed trades
                droneId: config.id,
                droneName: config.name,
                symbol: trade.symbol,
                side: trade.side === 'long' ? 'sell' : 'buy', // Convert position side to exit order side: long exit = sell, short exit = buy
                size: trade.size,
                entryPrice: trade.entryPrice,
                exitPrice: trade.exitPrice,
                pnl: trade.pnl,
                pnlPercent: trade.pnlPercent,
                leverage: trade.leverage, // Use leverage from CompletedTrade
                status: 'closed', // All completed trades are closed
              });
            }
          }
        }
      } catch (error) {
        // Log error but continue with other drones
        const logger = UnifiedLogger.getInstance();
        logger.warn(
          `Failed to get completed trades for drone ${drone.getConfig().id}`,
          {
            error: error instanceof Error ? error.message : String(error),
            arenaId: arena.getState().arenaId,
          },
          'arena-service'
        );
      }
    }

    // Sort by timestamp descending and limit
    allTrades.sort((a, b) => b.timestamp - a.timestamp);
    return allTrades.slice(0, limit);
  }

  /**
   * Collect positions from all drones in an arena
   */
  async collectPositionsFromDrones(arena: ArenaOrchestrator): Promise<
    Array<{
      droneId: string;
      droneName: string;
      positions: Array<{
        symbol: string;
        side: string;
        size: number;
        entryPrice: number;
        markPrice: number;
        unrealizedPnl: number;
        marginUsed: number;
        notional: number;
        leverage?: number;
        timestamp: number;
      }>;
      totalUnrealizedPnl: number;
      availableCash: number;
    }>
  > {
    const drones = arena.getAllDrones();

    return Promise.all(
      drones.map(async drone => {
        try {
          const workflow = drone.getWorkflow();
          const exchange = workflow.getExchange();
          const positions = await exchange.getPositions();
          const account = await exchange.getAccount();

          // Calculate total unrealized P&L for this drone
          const totalUnrealizedPnl = positions.reduce((sum, p) => sum + (p.unrealizedPnl || 0), 0);

          return {
            droneId: drone.getMetrics().droneId,
            droneName: drone.getMetrics().name,
            positions: positions.map(p => ({
              symbol: p.symbol,
              side: p.side,
              size: p.size,
              entryPrice: p.entryPrice,
              markPrice: p.markPrice,
              unrealizedPnl: p.unrealizedPnl,
              marginUsed: p.marginUsed,
              notional: p.notional,
              leverage: p.leverage,
              timestamp: p.timestamp,
            })),
            totalUnrealizedPnl,
            availableCash: account.balance,
          };
        } catch {
          // If a drone fails, return empty positions for it
          return {
            droneId: drone.getMetrics().droneId,
            droneName: drone.getMetrics().name,
            positions: [],
            totalUnrealizedPnl: 0,
            availableCash: 0,
          };
        }
      })
    );
  }

  /**
   * Calculate cutoff time from time range string
   */
  calculateCutoffTime(timeRange?: string): number {
    const now = Date.now();

    switch (timeRange) {
      case '1H':
        return now - 60 * 60 * 1000;
      case '4H':
        return now - 4 * 60 * 60 * 1000;
      case '24H':
        return now - 24 * 60 * 60 * 1000;
      case '72H':
        return now - 72 * 60 * 60 * 1000;
      case '7D':
        return now - 7 * 24 * 60 * 60 * 1000;
      case 'ALL':
        return 0;
      default:
        return now - 24 * 60 * 60 * 1000; // Default to 24 hours
    }
  }

  /**
   * Collect performance history snapshots from all drones
   */
  collectPerformanceHistory(
    arena: ArenaOrchestrator,
    timeRange?: string
  ): Array<{
    timestamp: number;
    drones: Array<{ droneId: string; equity: number; pnl: number; pnlPercent: number }>;
  }> {
    const cutoffTime = this.calculateCutoffTime(timeRange);
    const drones = arena.getAllDrones();
    const snapshotMap = new Map<
      number,
      Map<string, { equity: number; pnl: number; pnlPercent: number }>
    >();

    for (const drone of drones) {
      const metrics = drone.getMetrics();
      const config = drone.getConfig();

      // Get historical snapshots from drone
      const droneSnapshots = drone.getSnapshots();

      if (droneSnapshots.length > 0) {
        // Add all historical snapshots from this drone
        for (const snapshot of droneSnapshots) {
          if (snapshot.timestamp >= cutoffTime) {
            if (!snapshotMap.has(snapshot.timestamp)) {
              snapshotMap.set(snapshot.timestamp, new Map());
            }

            // Calculate PnL and PnL percent from snapshot equity
            const initialBalance = config.initialBalance;
            const pnl = snapshot.equity - initialBalance;
            const pnlPercent = (pnl / initialBalance) * 100;

            snapshotMap.get(snapshot.timestamp)!.set(metrics.droneId, {
              equity: snapshot.equity,
              pnl,
              pnlPercent,
            });
          }
        }
      } else {
        // Fallback: use current metrics if no snapshots available yet
        const currentEquity = metrics.equity;
        const currentPnl = metrics.pnl;
        const currentPnlPercent = metrics.pnlPercent;
        const now = Date.now();

        if (now >= cutoffTime) {
          if (!snapshotMap.has(now)) {
            snapshotMap.set(now, new Map());
          }

          snapshotMap.get(now)!.set(metrics.droneId, {
            equity: currentEquity,
            pnl: currentPnl,
            pnlPercent: currentPnlPercent,
          });
        }
      }
    }

    // Convert map to array format
    const allSnapshots: Array<{
      timestamp: number;
      drones: Array<{ droneId: string; equity: number; pnl: number; pnlPercent: number }>;
    }> = [];

    for (const [timestamp, dronesMap] of snapshotMap.entries()) {
      if (timestamp >= cutoffTime) {
        allSnapshots.push({
          timestamp,
          drones: Array.from(dronesMap.entries()).map(([droneId, data]) => ({
            droneId,
            ...data,
          })),
        });
      }
    }

    // Sort by timestamp
    allSnapshots.sort((a, b) => a.timestamp - b.timestamp);
    return allSnapshots;
  }

  /**
   * Collect ticker prices for arena symbols
   */
  async collectTickerPrices(arena: ArenaOrchestrator): Promise<
    Record<
      string,
      {
        symbol: string;
        last: number;
        bid: number;
        ask: number;
        timestamp: number;
      }
    >
  > {
    const drones = arena.getAllDrones();
    const symbolSet = new Set<string>();

    // Collect all unique symbols from all drones
    for (const drone of drones) {
      const config = drone.getConfig();
      if (config.coins) {
        for (const coin of config.coins) {
          symbolSet.add(coin);
        }
      }
    }

    // Get ticker prices from first drone's exchange (assuming all use same exchange)
    if (drones.length === 0) {
      return {};
    }

    try {
      const firstDrone = drones[0];
      const workflow = firstDrone.getWorkflow();
      const exchange = workflow.getExchange();
      const tickerPrices: Record<
        string,
        {
          symbol: string;
          last: number;
          bid: number;
          ask: number;
          timestamp: number;
        }
      > = {};

      if (exchange && typeof exchange.getTicker === 'function') {
        for (const symbol of symbolSet) {
          try {
            const ticker = await exchange.getTicker(symbol);
            if (ticker) {
              tickerPrices[symbol] = {
                symbol,
                last: ticker.price || 0,
                bid: ticker.price || 0, // Exchange interface only provides price
                ask: ticker.price || 0, // Exchange interface only provides price
                timestamp: ticker.timestamp || Date.now(),
              };
            }
          } catch {
            // Skip symbols that fail
          }
        }
      }

      return tickerPrices;
    } catch {
      return {};
    }
  }

  /**
   * Clean reasoning text by removing common prefixes
   */
  private cleanReasoning(reasoning: string): string {
    if (!reasoning) {
      return '';
    }

    reasoning = reasoning.trim();
    const prefixes = ['Reasoning:', 'Reason:', 'Analysis:', 'Rationale:'];

    for (const prefix of prefixes) {
      if (reasoning.startsWith(prefix)) {
        reasoning = reasoning.substring(prefix.length).trim();
        // Also remove colon if present
        if (reasoning.startsWith(':')) {
          reasoning = reasoning.substring(1).trim();
        }
        break;
      }
    }

    return reasoning;
  }

  /**
   * Collect AI commentary from arena events
   */
  collectAICommentary(
    arena: ArenaOrchestrator,
    limit: number
  ): Array<{
    id: string;
    timestamp: number;
    droneId: string;
    droneName: string;
    type: 'signal' | 'execution' | 'analysis';
    symbol?: string;
    action?: string;
    reasoning: string;
    confidence?: number;
    price?: number;
    strategy?: string;
    status?: string;
    metadata?: Record<string, any>;
  }> {
    const events = arena.getEvents(limit * 2); // Get more events to filter for AI-related ones
    const commentary: Array<{
      id: string;
      timestamp: number;
      droneId: string;
      droneName: string;
      type: 'signal' | 'execution' | 'analysis';
      symbol?: string;
      action?: string;
      reasoning: string;
      confidence?: number;
      price?: number;
      strategy?: string;
      status?: string;
      metadata?: Record<string, any>;
    }> = [];

    for (const event of events) {
      if (event.type === 'signal' && event.details) {
        // Extract signal reasoning from details
        const signal = event.details;
        let reasoning =
          signal.reasoning ||
          signal.message ||
          signal.description ||
          (signal.signal && signal.signal.reasoning) ||
          '';

        reasoning = this.cleanReasoning(reasoning);

        const confidence = signal.confidence || (signal.signal && signal.signal.confidence);
        const action = signal.action || (signal.signal && signal.signal.action) || event.action;
        const symbol =
          event.symbol || signal.symbol || signal.coin || (signal.signal && signal.signal.coin);

        // If reasoning is empty or just "Signal generated", try to build more informative message
        if (!reasoning || reasoning === 'Signal generated' || reasoning.trim().length < 10) {
          const parts: string[] = [];
          if (action && action !== 'HOLD') {
            parts.push(`${action} signal`);
          } else if (action === 'HOLD') {
            parts.push('HOLD position');
          } else {
            parts.push('Trading signal');
          }

          reasoning = parts.join(' ');

          if (!reasoning || reasoning.trim().length < 5) {
            reasoning = 'Signal generated';
          }
        }

        commentary.push({
          id: event.id,
          timestamp: event.timestamp,
          droneId: event.droneId || '',
          droneName: event.droneName || '',
          type: 'signal',
          symbol,
          action,
          reasoning,
          confidence,
          price: signal.price || (signal.signal && signal.signal.price),
          strategy: signal.strategy || (signal.signal && signal.signal.strategy),
          status: signal.status || (signal.signal && signal.signal.status),
          metadata: signal,
        });
      } else if (event.type === 'trade' && event.details) {
        // Extract trade execution insights
        const trade = event.details;
        commentary.push({
          id: event.id,
          timestamp: event.timestamp,
          droneId: event.droneId || '',
          droneName: event.droneName || '',
          type: 'execution',
          symbol: event.symbol || trade.symbol,
          action: trade.action || event.action,
          reasoning: trade.reason || trade.message || 'Trade executed',
          metadata: trade,
        });
      }
    }

    // Sort by timestamp descending and limit
    commentary.sort((a, b) => b.timestamp - a.timestamp);
    return commentary.slice(0, limit);
  }

  /**
   * List all available arena configs
   */
  listArenaConfigs(): ArenaConfigSummary[] {
    const arenaConfigDir = getArenaConfigDir();
    const files = readdirSync(arenaConfigDir).filter(f => f.endsWith('.json'));
    const configs: ArenaConfigSummary[] = [];

    for (const file of files) {
      const filePath = join(arenaConfigDir, file);
      try {
        const content = readFileSync(filePath, 'utf-8');
        const config = JSON.parse(content) as ArenaConfig;
        const stats = statSync(filePath);

        configs.push({
          name: file.replace('.json', ''),
          fileName: file,
          configName: config.name || file.replace('.json', ''),
          mode: config.mode || 'paper',
          droneCount: config.drones?.length || 0,
          promptPacks: config.drones ? [...new Set(config.drones.map(d => d.promptPack))] : [],
          modified: stats.mtime.toISOString(),
        });
      } catch {
        // Skip invalid JSON files
      }
    }

    return configs.sort((a, b) => a.name.localeCompare(b.name));
  }

  /**
   * Get a specific arena config by name
   */
  getArenaConfig(configName: string): ArenaConfig {
    const arenaConfigDir = getArenaConfigDir();
    const fileName = configName.endsWith('.json') ? configName : `${configName}.json`;
    const filePath = join(arenaConfigDir, fileName);

    try {
      const content = readFileSync(filePath, 'utf-8');
      return JSON.parse(content) as ArenaConfig;
    } catch (error) {
      if (error instanceof Error && 'code' in error && error.code === 'ENOENT') {
        throw new Error(`Config not found: ${configName}`);
      }
      throw error;
    }
  }

  /**
   * Start an arena with the given configuration
   */
  async startArena(config: ArenaConfig, apiKey: string): Promise<string> {
    return this.arenaManager.startArena(config, apiKey);
  }

  /**
   * Stop an arena by ID
   */
  async stopArena(arenaId: string): Promise<void> {
    await this.arenaManager.stopArena(arenaId);
  }
}

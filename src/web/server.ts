import express from 'express';
import { WebSocketServer, WebSocket } from 'ws';
import cors from 'cors';
import http from 'http';
import { TradingManager } from './trading-manager.js';
import { HealthCheckService } from './health-check.js';
import type { OutboundMessage } from './types.js';
import {
  registerTradeRoutes,
  registerSystemRoutes,
  registerDataRoutes,
  registerMarketRoutes,
  registerBacktestRoutes,
  registerActivityRoutes,
  registerArenaRoutes,
} from './routes/index.js';
import { createPriceCache, createKlineCache } from './utils/cache.js';
import { createLogger } from './utils/logger.js';
import { EventBus } from '../core/event-bus.js';

const { logger, context: loggerContext } = createLogger('Server');

export class APIServer {
  private app: express.Application;
  private server: http.Server;
  private wss: WebSocketServer;
  private tradingManager: TradingManager;
  private healthCheckService: HealthCheckService;
  private clients: Set<WebSocket> = new Set();
  private heartbeatInterval?: NodeJS.Timeout;
  // Lightweight in-memory caches (stored on tradingManager for access by routes)
  private readonly priceCache = createPriceCache();
  private readonly klineCache = createKlineCache();

  constructor(port: number = 3001) {
    this.app = express();
    this.server = http.createServer(this.app);
    this.wss = new WebSocketServer({ server: this.server });
    this.tradingManager = TradingManager.getInstance();

    // Initialize health check service
    // Dependencies will be available after trading starts
    this.healthCheckService = new HealthCheckService();

    // Attach caches to tradingManager for route access
    this.tradingManager._priceCache = this.priceCache;
    this.tradingManager._klineCache = this.klineCache;

    this.setupMiddleware();
    this.setupRoutes();
    this.setupWebSocket();

    this.server.listen(port, () => {
      logger.info(`API Server running on http://localhost:${port}`, {}, loggerContext);
      logger.info(`WebSocket server running on ws://localhost:${port}`, {}, loggerContext);
    });
  }

  private setupMiddleware(): void {
    const isProduction = process.env.NODE_ENV === 'production';
    if (isProduction) {
      const allowedOrigins = (process.env.CORS_ORIGIN || 'http://localhost:3000')
        .split(',')
        .map(o => o.trim())
        .filter(Boolean);
      this.app.use(
        cors({
          origin: allowedOrigins,
          credentials: true,
        })
      );
    } else {
      // Default to permissive CORS in development for ease of local testing
      this.app.use(cors());
    }
    this.app.use(express.json());
  }

  private setupRoutes(): void {
    // Quick health check (no async operations)
    this.app.get('/health', (_req, res) => {
      const quickHealth = this.healthCheckService.quickCheck();
      res.json(quickHealth);
    });

    // Comprehensive health check
    this.app.get('/health/detailed', async (_req, res) => {
      try {
        // Update health check service with latest dependencies
        const exchange = this.tradingManager.getExchange();
        const marketDataProvider = this.tradingManager.getMarketDataProvider();
        const aiAgent = this.tradingManager.getAIAgent();

        // Create a new health check with current dependencies
        const healthCheck = new HealthCheckService(exchange, aiAgent, marketDataProvider);
        const status = await healthCheck.check();

        // Set appropriate HTTP status code based on health
        const httpStatus =
          status.status === 'healthy' ? 200 : status.status === 'degraded' ? 200 : 503;

        res.status(httpStatus).json(status);
      } catch (error) {
        logger.error(
          'Health check failed',
          error instanceof Error ? error : new Error(String(error)),
          loggerContext
        );
        res.status(503).json({
          status: 'unhealthy',
          timestamp: Date.now(),
          error: error instanceof Error ? error.message : String(error),
        });
      }
    });

    // Register route modules
    registerTradeRoutes(this.app, this.tradingManager);
    registerSystemRoutes(this.app, this.tradingManager);
    registerDataRoutes(this.app, this.tradingManager);
    registerMarketRoutes(this.app, this.tradingManager);
    registerBacktestRoutes(this.app);
    registerActivityRoutes(this.app, this.tradingManager);
    registerArenaRoutes(this.app);
  }

  private setupWebSocket(): void {
    this.wss.on('connection', (ws: WebSocket) => {
      logger.info('WebSocket client connected', {}, loggerContext);
      this.clients.add(ws);

      // Heartbeat tracking
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (ws as any).isAlive = true;
      ws.on('pong', () => {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (ws as any).isAlive = true;
      });

      // Send initial state
      const state = this.tradingManager.getState();
      ws.send(JSON.stringify({ type: 'system:state', data: state }));

      ws.on('close', () => {
        logger.info('WebSocket client disconnected', {}, loggerContext);
        this.clients.delete(ws);
      });

      ws.on('error', error => {
        logger.error(
          'WebSocket error',
          error instanceof Error ? error : new Error(String(error)),
          loggerContext
        );
      });
    });

    // Periodic heartbeat to terminate dead connections
    this.heartbeatInterval = setInterval(() => {
      this.wss.clients.forEach(ws => {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const socket = ws as any;
        if (socket.isAlive === false) {
          try {
            ws.terminate();
          } catch (_e) {
            void _e;
            // ignore terminate errors
          }
          return;
        }
        socket.isAlive = false;
        try {
          ws.ping();
        } catch (_e) {
          void _e;
          // ignore ping errors
        }
      });
    }, 30000);

    // Listen to trading manager events and broadcast to clients
    this.tradingManager.on('system:state', data => {
      this.broadcast({ type: 'system:state', data });
    });

    this.tradingManager.on('account:update', data => {
      this.broadcast({ type: 'account:update', data });
    });

    this.tradingManager.on('position:update', data => {
      this.broadcast({ type: 'position:update', data });
    });

    this.tradingManager.on('signal:generated', data => {
      this.broadcast({ type: 'signal:generated', data });
    });

    this.tradingManager.on('trade:executed', data => {
      this.broadcast({ type: 'trade:executed', data });
    });

    this.tradingManager.on('cycle:complete', data => {
      this.broadcast({ type: 'cycle:complete', data });
      // Also broadcast latest kline for active symbols (default timeframe: 1h)
      // Run asynchronously and aggregate errors per-symbol
      void (async () => {
        try {
          const workflow = this.tradingManager.getWorkflow();
          if (!workflow) return;
          const exchange = workflow.getExchange();
          const coins: string[] = workflow.getConfig().coins || [];
          if (!Array.isArray(coins) || coins.length === 0) return;

          const timeframe = '1h';
          await Promise.all(
            coins.map(async (coin: string) => {
              const symbol = `${coin}/USDT`;
              try {
                const candles = await exchange.getCandlesticks(symbol, timeframe, 1);
                const last = candles && candles.length ? candles[candles.length - 1] : null;
                if (!last) return;
                // Update cache for downstream consumers
                const cacheKey = `${symbol}:${timeframe}`;
                this.klineCache.set(cacheKey, { candle: last, ts: Date.now() });
                // Notify subscribers
                this.broadcast({
                  type: 'kline:update',
                  data: { symbol, timeframe, candle: last },
                });
              } catch (e) {
                logger.warn(
                  `Failed to fetch klines for ${symbol}: ${(e as Error)?.message}`,
                  {},
                  loggerContext
                );
              }
            })
          );
        } catch (error) {
          // Klines fetching can fail for various reasons (network, exchange, etc.)
          // This is non-critical for the server, so we log and continue
          logger.warn(
            'Failed to fetch klines for WebSocket broadcast',
            error instanceof Error ? { error: error.message } : { error: String(error) },
            loggerContext
          );
        }
      })();
    });

    // NEW: forward risk and order updates
    this.tradingManager.on('risk:update', data => {
      this.broadcast({ type: 'risk:update', data });
    });

    this.tradingManager.on('order:update', data => {
      this.broadcast({ type: 'order:update', data });
    });

    // Arena event broadcasting - subscribe to EventBus for arena events
    EventBus.on('arena:started' as any, (payload: any) => {
      this.broadcast({ type: 'arena:started', data: payload });
    });

    EventBus.on('arena:stopped' as any, (payload: any) => {
      this.broadcast({ type: 'arena:stopped', data: payload });
    });

    // Note: arena:update events are emitted by ArenaOrchestrator via EventEmitter,
    // not EventBus, so those will be handled through ArenaManager if needed
  }

  private broadcast(message: OutboundMessage): void {
    const data = JSON.stringify(message);
    this.clients.forEach(client => {
      if (client.readyState === WebSocket.OPEN) {
        client.send(data);
      }
    });
  }

  stop(): void {
    if (this.heartbeatInterval) {
      clearInterval(this.heartbeatInterval);
      this.heartbeatInterval = undefined;
    }
    try {
      this.wss.close();
    } catch (_e) {
      void _e;
    }
    this.server.close();
    logger.info('API Server stopped', {}, loggerContext);
  }
}

import express from 'express';
import { WebSocketServer, WebSocket } from 'ws';
import cors from 'cors';
import http from 'http';
import { Logger } from '../utils/logger.js';
import { TradingManager } from './trading-manager.js';
import type { OutboundMessage } from './types.js';
import {
  registerTradeRoutes,
  registerSystemRoutes,
  registerDataRoutes,
  registerMarketRoutes,
  registerBacktestRoutes,
} from './routes/index.js';

const logger = Logger.getInstance('Server');

export class APIServer {
  private app: express.Application;
  private server: http.Server;
  private wss: WebSocketServer;
  private tradingManager: TradingManager;
  private clients: Set<WebSocket> = new Set();
  private heartbeatInterval?: NodeJS.Timeout;
  // lightweight in-memory caches (stored on tradingManager for access by routes)
  private priceCache = new Map<string, { price: number; ts: number }>();
  private klineCache = new Map<
    string,
    {
      candle: {
        timestamp: number;
        open: number;
        high: number;
        low: number;
        close: number;
        volume: number;
      };
      ts: number;
    }
  >();

  constructor(port: number = 3001) {
    this.app = express();
    this.server = http.createServer(this.app);
    this.wss = new WebSocketServer({ server: this.server });
    this.tradingManager = TradingManager.getInstance();

    // Attach caches to tradingManager for route access
    this.tradingManager._priceCache = this.priceCache;
    this.tradingManager._klineCache = this.klineCache;

    this.setupMiddleware();
    this.setupRoutes();
    this.setupWebSocket();

    this.server.listen(port, () => {
      logger.info(`API Server running on http://localhost:${port}`);
      logger.info(`WebSocket server running on ws://localhost:${port}`);
    });
  }

  private setupMiddleware(): void {
    this.app.use(cors());
    this.app.use(express.json());
  }

  private setupRoutes(): void {
    // Health check
    this.app.get('/health', (_req, res) => {
      res.json({ status: 'ok', timestamp: Date.now() });
    });

    // Register route modules
    registerTradeRoutes(this.app, this.tradingManager);
    registerSystemRoutes(this.app, this.tradingManager);
    registerDataRoutes(this.app, this.tradingManager);
    registerMarketRoutes(this.app, this.tradingManager);
    registerBacktestRoutes(this.app);
  }

  private setupWebSocket(): void {
    this.wss.on('connection', (ws: WebSocket) => {
      logger.info('WebSocket client connected');
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
        logger.info('WebSocket client disconnected');
        this.clients.delete(ws);
      });

      ws.on('error', error => {
        logger.error('WebSocket error', error);
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
                logger.warn(`Failed to fetch klines for ${symbol}: ${(e as Error)?.message}`);
              }
            })
          );
        } catch (error) {
          // Klines fetching can fail for various reasons (network, exchange, etc.)
          // This is non-critical for the server, so we log and continue
          logger.warn('Failed to fetch klines for WebSocket broadcast', error);
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
    logger.info('API Server stopped');
  }
}

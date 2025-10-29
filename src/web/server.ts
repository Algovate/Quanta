import express from 'express';
import { WebSocketServer, WebSocket } from 'ws';
import cors from 'cors';
import http from 'http';
import { Logger } from '../utils/logger.js';
import { TradingManager } from './trading-manager.js';
import type { OutboundMessage } from './types.js';
import { getConfig } from '../config/settings.js';
import {
  startTradingService,
  getPositionsService,
  getAccountService,
  closePositionService,
  placeOrderService,
  runBacktestService,
} from './api-service.js';

const logger = Logger.getInstance('Server');

export class APIServer {
  private app: express.Application;
  private server: http.Server;
  private wss: WebSocketServer;
  private tradingManager: TradingManager;
  private clients: Set<WebSocket> = new Set();

  constructor(port: number = 3001) {
    this.app = express();
    this.server = http.createServer(this.app);
    this.wss = new WebSocketServer({ server: this.server });
    this.tradingManager = TradingManager.getInstance();

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

    // Get system status
    this.app.get('/api/status', async (_req, res) => {
      try {
        const state = this.tradingManager.getState();
        const workflow = this.tradingManager.getWorkflow();

        let account = null;
        let positions: { symbol: string; side: 'long' | 'short'; size: number }[] = [];

        if (workflow) {
          const exchange = workflow.getExchange();
          account = await exchange.getAccount();
          positions = await exchange.getPositions();
        }

        res.json({
          state,
          account,
          positions,
        });
      } catch (error) {
        logger.error('Error getting status', error);
        res.status(500).json({ error: 'Failed to get status' });
      }
    });

    // Start trading
    this.app.post('/api/trade/start', async (req, res) => {
      try {
        const { coins } = req.body;
        await startTradingService(this.tradingManager, coins);

        res.json({ success: true, message: 'Trading started' });
      } catch (error) {
        logger.error('Error starting trade', error);
        res.status(500).json({ error: 'Failed to start trading' });
      }
    });

    // Stop trading
    this.app.post('/api/trade/stop', async (_req, res) => {
      try {
        await this.tradingManager.stop();
        res.json({ success: true, message: 'Trading stopped' });
      } catch (error) {
        logger.error('Error stopping trade', error);
        res.status(500).json({ error: 'Failed to stop trading' });
      }
    });

    // Pause trading
    this.app.post('/api/trade/pause', async (_req, res) => {
      try {
        await this.tradingManager.pause();
        res.json({ success: true, message: 'Trading paused' });
      } catch (error) {
        logger.error('Error pausing trade', error);
        res.status(500).json({ error: 'Failed to pause trading' });
      }
    });

    // Get positions
    this.app.get('/api/positions', async (_req, res) => {
      try {
        const workflow = this.tradingManager.getWorkflow();
        if (!workflow) {
          return res.json([]);
        }

        const positions = await getPositionsService(this.tradingManager);
        res.json(positions);
      } catch (error) {
        logger.error('Error getting positions', error);
        res.status(500).json({ error: 'Failed to get positions' });
      }
    });

    // Get account
    this.app.get('/api/account', async (_req, res) => {
      try {
        const workflow = this.tradingManager.getWorkflow();
        if (!workflow) {
          return res.json(null);
        }

        const account = await getAccountService(this.tradingManager);
        res.json(account);
      } catch (error) {
        logger.error('Error getting account', error);
        res.status(500).json({ error: 'Failed to get account' });
      }
    });

    // Close position (by symbol and side)
    this.app.post('/api/position/close', async (req, res) => {
      try {
        const { symbol, side } = req.body || {};
        if (!symbol || !side) {
          return res.status(400).json({ error: 'Missing symbol or side' });
        }

        const workflow = this.tradingManager.getWorkflow();
        if (!workflow) return res.status(400).json({ error: 'Trading workflow is not running' });

        try {
          const order = await closePositionService(this.tradingManager, { symbol, side });
          res.json({ success: true, order });
        } catch (e) {
          return res.status(404).json({ error: e instanceof Error ? e.message : 'Not found' });
        }
      } catch (error) {
        logger.error('Error closing position', error);
        res.status(500).json({ error: 'Failed to close position' });
      }
    });

    // Get config
    this.app.get('/api/config', (_req, res) => {
      try {
        const config = getConfig();
        res.json(config);
      } catch (error) {
        logger.error('Error getting config', error);
        res.status(500).json({ error: 'Failed to get config' });
      }
    });

    // Update config (simplified for now)
    this.app.put('/api/config', (_req, res) => {
      res.status(501).json({ error: 'Config update not yet implemented' });
    });

    // Signals (recent)
    this.app.get('/api/signals', (req, res) => {
      try {
        const limit = Math.max(1, Math.min(200, parseInt(String(req.query.limit || '50'), 10)));
        const items = this.tradingManager.getSignals(limit) || [];
        res.json(items);
      } catch (error) {
        logger.error('Error getting signals', error);
        res.status(500).json({ error: 'Failed to get signals' });
      }
    });

    // Orders (recent)
    this.app.get('/api/orders', (req, res) => {
      try {
        const limit = Math.max(1, Math.min(200, parseInt(String(req.query.limit || '50'), 10)));
        const items = this.tradingManager.getOrders(limit) || [];
        res.json(items);
      } catch (error) {
        logger.error('Error getting orders', error);
        res.status(500).json({ error: 'Failed to get orders' });
      }
    });

    // Risk snapshot
    this.app.get('/api/risk', (_req, res) => {
      try {
        const risk = this.tradingManager.getRisk();
        res.json(risk || null);
      } catch (error) {
        logger.error('Error getting risk', error);
        res.status(500).json({ error: 'Failed to get risk' });
      }
    });

    // Run backtest
    this.app.post('/api/backtest/run', async (req, res) => {
      try {
        const { start, end, coins, initialBalance } = req.body || {};

        // Basic validation
        if (!start || !end || !coins || !initialBalance) {
          return res
            .status(400)
            .json({ message: 'Missing required fields: start, end, coins, initialBalance' });
        }

        const startDate = new Date(start);
        const endDate = new Date(end);
        if (isNaN(startDate.getTime()) || isNaN(endDate.getTime())) {
          return res.status(400).json({ message: 'Invalid date format. Use YYYY-MM-DD' });
        }
        if (startDate >= endDate) {
          return res.status(400).json({ message: 'Start date must be before end date' });
        }

        const parsedInitial = Number(initialBalance);
        if (!isFinite(parsedInitial) || parsedInitial <= 0) {
          return res.status(400).json({ message: 'Invalid initialBalance' });
        }

        // Lazy import to keep startup light
        const result = await runBacktestService({
          start,
          end,
          coins,
          initialBalance: parsedInitial,
        });
        res.json(result);
      } catch (error) {
        logger.error('Error running backtest', error);
        const msg = error instanceof Error ? error.message : 'Failed to run backtest';
        res.status(500).json({ message: msg });
      }
    });

    // Place manual order
    this.app.post('/api/order', async (req, res) => {
      try {
        const { symbol, side, amount, price, leverage } = req.body || {};
        if (!symbol || !side || !amount || (side !== 'buy' && side !== 'sell')) {
          return res.status(400).json({ error: 'Invalid order payload' });
        }

        const workflow = this.tradingManager.getWorkflow();
        if (!workflow) {
          return res.status(409).json({
            error: 'Trading workflow is not running',
            code: 'WORKFLOW_NOT_RUNNING',
            hint: 'Start trading via POST /api/trade/start or the dashboard control, then retry.',
          });
        }

        const order = await placeOrderService(this.tradingManager, {
          symbol,
          side,
          amount: Number(amount),
          price: price ? Number(price) : undefined,
          leverage: leverage ? Number(leverage) : undefined,
        });
        res.json({ success: true, order });
      } catch (error) {
        logger.error('Error placing order', error);
        res.status(500).json({ error: 'Failed to place order' });
      }
    });

    // Get K-lines (candlestick data)
    this.app.get('/api/klines/:symbol', async (req, res) => {
      try {
        const { symbol } = req.params;
        const timeframe = (req.query.timeframe as string) || '1h';
        const limit = Math.max(1, Math.min(1000, parseInt(String(req.query.limit || '100'), 10)));

        const workflow = this.tradingManager.getWorkflow();
        if (!workflow) {
          return res.status(400).json({ error: 'Trading workflow is not running' });
        }

        const exchange = workflow.getExchange();
        const candlesticks = await exchange.getCandlesticks(symbol, timeframe, limit);
        res.json(candlesticks);
      } catch (error) {
        logger.error('Error getting K-lines', error);
        res.status(500).json({ error: 'Failed to get K-lines data' });
      }
    });
  }

  private setupWebSocket(): void {
    this.wss.on('connection', (ws: WebSocket) => {
      logger.info('WebSocket client connected');
      this.clients.add(ws);

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
      try {
        const workflow = this.tradingManager.getWorkflow();
        if (workflow) {
          const exchange = workflow.getExchange();
          const coins: string[] = workflow.getConfig().coins || [];
          if (Array.isArray(coins) && coins.length) {
            const timeframe = '1h';
            coins.forEach(async (coin: string) => {
              const symbol = `${coin}/USDT`;
              try {
                const candles = await exchange.getCandlesticks(symbol, timeframe, 1);
                const last = candles && candles.length ? candles[candles.length - 1] : null;
                if (last) {
                  this.broadcast({
                    type: 'kline:update',
                    data: { symbol, timeframe, candle: last },
                  });
                }
              } catch (e) {
                logger.warn(`Failed to fetch klines for ${symbol}: ${(e as Error)?.message}`);
              }
            });
          }
        }
      } catch {
        // Silently ignore errors in klines fetching
      }
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
    this.server.close();
    logger.info('API Server stopped');
  }
}

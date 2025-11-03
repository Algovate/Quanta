import type { Router } from 'express';
import type { TradingManager } from '../trading-manager.js';

type ActivityType = 'order' | 'trade' | 'execution' | 'signal';

interface ActivityEventBase {
  id: string;
  type: ActivityType;
  timestamp: number;
  symbol: string;
  side?: 'buy' | 'sell' | 'long' | 'short';
  orderId?: string; // link back to originating order when applicable
  cycleId?: number; // trading cycle number when available
}

interface OrderActivityEvent extends ActivityEventBase {
  type: 'order';
  status: string;
  price?: number;
  amount?: number;
  source?: string;
  reason?: string;
}

interface TradeActivityEvent extends ActivityEventBase {
  type: 'trade';
  price: number;
  amount: number;
  pnl?: number;
  fees?: number;
  position?: {
    side: 'long' | 'short';
    size: number;
    entryPrice: number;
    leverage?: number;
    notional?: number;
    marginUsed?: number;
    markPrice?: number;
    unrealizedPnl?: number;
  };
}

// Execution is a semantic alias; currently mapped from trade/order fill
interface ExecutionActivityEvent extends ActivityEventBase {
  type: 'execution';
  price: number;
  amount: number;
}

type AnyActivityEvent = OrderActivityEvent | TradeActivityEvent | ExecutionActivityEvent;
interface SignalActivityEvent extends ActivityEventBase {
  type: 'signal';
  action?: string;
  confidence?: number;
  status?: string;
  price?: number;
  strategy?: string;
  reasoning?: string;
}

type AnyActivityEventUnion = AnyActivityEvent | SignalActivityEvent;

// Simple in-memory ring buffer for recent activity (non-persistent)
const MAX_ACTIVITY_HISTORY = 1000;
const activityBuffer: AnyActivityEventUnion[] = [];

function pushActivity(event: AnyActivityEventUnion): void {
  activityBuffer.unshift(event);
  if (activityBuffer.length > MAX_ACTIVITY_HISTORY) {
    activityBuffer.pop();
  }
}

export function registerActivityRoutes(router: Router, tradingManager: TradingManager): void {
  // Attach listeners once to feed the history buffer (idempotent registration)
  // We guard by checking a symbol on the function to avoid duplicate listeners if called again
  const anyRouter = router as unknown as { __activityListenersAttached?: boolean };
  if (!anyRouter.__activityListenersAttached) {
    tradingManager.on('order:update', order => {
      const evt: OrderActivityEvent = {
        id: String(order.id),
        type: 'order',
        timestamp: order.timestamp ?? Date.now(),
        symbol: order.symbol,
        side: order.side,
        orderId: String(order.id),
        cycleId: (order as any).cycleId,
        status: order.status,
        price: order.price,
        amount: order.amount,
        source: (order as any).source,
        reason: (order as any).reason,
      };
      pushActivity(evt);

      // If order filled/executed, also push an execution event
      if (order.status === 'filled' || order.status === 'executed') {
        const execEvt: ExecutionActivityEvent = {
          id: `${order.id}:exec:${order.timestamp ?? Date.now()}`,
          type: 'execution',
          timestamp: order.timestamp ?? Date.now(),
          symbol: order.symbol,
          side: order.side,
          price: order.price ?? 0,
          amount: order.amount ?? 0,
          orderId: String(order.id),
          cycleId: (order as any).cycleId,
        };
        pushActivity(execEvt);
      }
    });

    tradingManager.on('trade:executed', async trade => {
      const evt: TradeActivityEvent = {
        id: String(trade.id ?? `${trade.symbol}:${trade.timestamp}`),
        type: 'trade',
        timestamp: trade.timestamp ?? Date.now(),
        symbol: trade.symbol,
        side: trade.side,
        price: trade.price,
        amount: trade.amount,
        orderId: (trade as any).orderId ? String((trade as any).orderId) : undefined,
        cycleId: (trade as any).cycleId,
        pnl: (trade as any).pnl,
        fees: (trade as any).fees,
      };
      try {
        const wf = tradingManager.getWorkflow();
        const ex = wf?.getExchange?.();
        const positions = ex ? await ex.getPositions() : [];
        const pos = positions.find((p: any) => p.symbol === trade.symbol);
        if (pos) {
          evt.position = {
            side: pos.side,
            size: pos.size,
            entryPrice: pos.entryPrice,
            leverage: pos.leverage,
            notional: pos.notional,
            marginUsed: pos.marginUsed,
            markPrice: pos.markPrice,
            unrealizedPnl: pos.unrealizedPnl,
          };
        }
      } catch {}
      pushActivity(evt);
    });

    // Signals
    tradingManager.on('signal:generated', (signal: any) => {
      const evt: SignalActivityEvent = {
        id: String(signal.id ?? `${signal.symbol}:${signal.timestamp}`),
        type: 'signal',
        timestamp: signal.timestamp ?? Date.now(),
        symbol: signal.symbol,
        side: undefined,
        orderId: undefined,
        cycleId: signal.cycleId,
        action: signal.action,
        confidence: signal.confidence,
        status: signal.status,
        price: signal.price,
        strategy: signal.strategy,
        reasoning: signal.reasoning,
      };
      pushActivity(evt);
    });

    anyRouter.__activityListenersAttached = true;
  }

  // Server-Sent Events stream
  router.get('/api/activity/stream', (req, res) => {
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');

    // Send a comment to keep connection alive and indicate start
    res.write(': connected\n\n');

    const send = (event: AnyActivityEventUnion) => {
      const sseEvent = `event: ${event.type}\n` + `data: ${JSON.stringify(event)}\n\n`;
      res.write(sseEvent);
    };

    const orderListener = (order: any) => {
      const evt: OrderActivityEvent = {
        id: String(order.id),
        type: 'order',
        timestamp: order.timestamp ?? Date.now(),
        symbol: order.symbol,
        side: order.side,
        orderId: String(order.id),
        cycleId: order.cycleId,
        status: order.status,
        price: order.price,
        amount: order.amount,
        source: (order as any).source,
        reason: (order as any).reason,
      };
      send(evt);

      if (order.status === 'filled' || order.status === 'executed') {
        const execEvt: ExecutionActivityEvent = {
          id: `${order.id}:exec:${order.timestamp ?? Date.now()}`,
          type: 'execution',
          timestamp: order.timestamp ?? Date.now(),
          symbol: order.symbol,
          side: order.side,
          price: order.price ?? 0,
          amount: order.amount ?? 0,
          orderId: String(order.id),
          cycleId: order.cycleId,
        };
        send(execEvt);
      }
    };

    const tradeListener = async (trade: any) => {
      const evt: TradeActivityEvent = {
        id: String(trade.id ?? `${trade.symbol}:${trade.timestamp}`),
        type: 'trade',
        timestamp: trade.timestamp ?? Date.now(),
        symbol: trade.symbol,
        side: trade.side,
        price: trade.price,
        amount: trade.amount,
        orderId: trade.orderId ? String(trade.orderId) : undefined,
        cycleId: trade.cycleId,
        pnl: (trade as any).pnl,
        fees: (trade as any).fees,
      };
      try {
        const wf = tradingManager.getWorkflow();
        const ex = wf?.getExchange?.();
        const positions = ex ? await ex.getPositions() : [];
        const pos = positions.find((p: any) => p.symbol === trade.symbol);
        if (pos) {
          evt.position = {
            side: pos.side,
            size: pos.size,
            entryPrice: pos.entryPrice,
            leverage: pos.leverage,
            notional: pos.notional,
            marginUsed: pos.marginUsed,
            markPrice: pos.markPrice,
            unrealizedPnl: pos.unrealizedPnl,
          };
        }
      } catch {}
      send(evt);
    };

    tradingManager.on('order:update', orderListener);
    tradingManager.on('trade:executed', tradeListener);
    const signalListener = (signal: any) => {
      const evt: SignalActivityEvent = {
        id: String(signal.id ?? `${signal.symbol}:${signal.timestamp}`),
        type: 'signal',
        timestamp: signal.timestamp ?? Date.now(),
        symbol: signal.symbol,
        action: signal.action,
        confidence: signal.confidence,
        status: signal.status,
        price: signal.price,
        strategy: signal.strategy,
        reasoning: signal.reasoning,
        cycleId: signal.cycleId,
      };
      send(evt);
    };
    tradingManager.on('signal:generated', signalListener);

    req.on('close', () => {
      tradingManager.off('order:update', orderListener);
      tradingManager.off('trade:executed', tradeListener);
      tradingManager.off('signal:generated', signalListener);
      res.end();
    });
  });

  // Simple history endpoint with optional filters
  router.get('/api/activity/history', (req, res) => {
    const limit = Math.min(parseInt(String(req.query.limit || '200'), 10) || 200, 1000);
    const typesParam = String(req.query.types || '').trim();
    const types = typesParam
      ? new Set(typesParam.split(',').map(t => t.trim() as ActivityType))
      : null;
    const symbol = (req.query.symbol as string | undefined)?.trim();

    const filtered = activityBuffer.filter(evt => {
      if (types && !types.has(evt.type)) return false;
      if (symbol && evt.symbol !== symbol) return false;
      return true;
    });

    res.json({ items: filtered.slice(0, limit) });
  });
}

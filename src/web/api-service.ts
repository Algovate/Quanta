import { TradingManager } from './trading-manager.js';
import { getConfig } from '../config/settings.js';
import { createExchangeForMode, describeExchange } from './exchange-factory.js';
import { createWorkflowDeps } from '../core/factories.js';
import type { BacktestConfig } from '../types/index.js';
import type { Exchange } from '../exchange/types.js';
import { createLogger } from './utils/logger.js';

// Type guard to check if exchange supports order metadata
function supportsOrderMetadata(exchange: Exchange): exchange is Exchange & {
  setOrderMetadata: (orderId: string, source: string, reason: string) => void;
} {
  return typeof (exchange as any).setOrderMetadata === 'function';
}

export async function startTradingService(
  tradingManager: TradingManager,
  coins?: string | string[],
  opts?: { env?: 'simulate' | 'simulation' | 'paper' | 'live'; mode?: 'arena' | 'strategy' }
) {
  const config = getConfig();
  const exchange = await createExchangeForMode(opts?.env);

  // Log effective configuration and exchange selection (parity with CLI output)
  const { logger, context: loggerContext } = createLogger('TradingService');
  try {
    logger.info('📊 Configuration:', {}, loggerContext);
    logger.info(`   Mode: ${opts?.mode ?? (config as any).mode}`, {}, loggerContext);
    logger.info(`   Env: ${opts?.env ?? (config as any).env}`, {}, loggerContext);
    const friendly = describeExchange(exchange, config.exchange?.testnet ?? true);
    if (friendly) logger.info(`   Exchange: ${friendly}`, {}, loggerContext);
    if (config.exchange?.marketType) {
      logger.info(`   Market Type: ${config.exchange.marketType}`, {}, loggerContext);
    }
  } catch {
    // best-effort logging only
  }

  const tradingCoins = coins || config.trading.coins;
  const coinsArray: string[] =
    typeof tradingCoins === 'string'
      ? (tradingCoins as string).split(',')
      : (tradingCoins as string[]);
  const { marketProvider, aiClient, workflowConfig } = createWorkflowDeps(
    exchange,
    config,
    coinsArray
  );
  await tradingManager.start(exchange, marketProvider, aiClient, workflowConfig);
}

export async function getPositionsService(tradingManager: TradingManager) {
  const workflow = tradingManager.getWorkflow();
  if (!workflow) return [];
  const exchange = workflow.getExchange();
  const positions = await exchange.getPositions();
  // Enrich positions with any custom exit plan configured via TradingManager
  return positions.map(p => {
    const custom = tradingManager.getCustomExitPlan(p.symbol, p.side);
    let customStopLoss = custom.stopLoss;
    let customTakeProfit = custom.takeProfit;
    // If not set, derive defaults from workflow config (if activated)
    if (!customStopLoss && !p.trailingStopPrice) {
      try {
        const cfg = tradingManager.getWorkflow()?.getConfig();
        const slPct = cfg?.riskParams?.defaultStopLoss;
        if (typeof slPct === 'number' && slPct > 0) {
          const isLong = p.side === 'long';
          const entry = p.entryPrice;
          const defaultSL = isLong ? entry * (1 - slPct) : entry * (1 + slPct);
          customStopLoss = defaultSL;
          const tpPct = slPct * 2; // default TP = 2x SL distance
          const defaultTP = isLong ? entry * (1 + tpPct) : entry * (1 - tpPct);
          customTakeProfit = customTakeProfit ?? defaultTP;
        }
      } catch {
        // best-effort
      }
    }
    return {
      ...p,
      customStopLoss,
      customTakeProfit,
    };
  });
}

export async function getAccountService(tradingManager: TradingManager) {
  const workflow = tradingManager.getWorkflow();
  if (!workflow) return null;
  const exchange = workflow.getExchange();
  return exchange.getAccount();
}

export async function closePositionService(
  tradingManager: TradingManager,
  params: { symbol: string; side: 'long' | 'short' }
) {
  const workflow = tradingManager.getWorkflow();
  if (!workflow) throw new Error('Trading workflow is not running');
  const exchange = workflow.getExchange();
  const positions = await exchange.getPositions();
  const target = positions.find(p => p.symbol === params.symbol && p.side === params.side);
  if (!target) throw new Error('Position not found');
  const oppositeSide = params.side === 'long' ? 'sell' : 'buy';
  const order = await exchange.placeOrder(params.symbol, oppositeSide, target.size);
  // Set metadata for simulator exchange if applicable
  if (supportsOrderMetadata(exchange) && order?.id) {
    exchange.setOrderMetadata(order.id, 'manual', 'manual-close');
  }
  tradingManager.pushOrder({
    id: order?.id ?? `${params.symbol}-${Date.now()}`,
    timestamp: Date.now(),
    symbol: params.symbol,
    side: oppositeSide,
    amount: target.size,
    status: order?.status ?? 'open',
    source: 'manual',
    reason: 'manual-close',
  });
  return order;
}

export async function placeOrderService(
  tradingManager: TradingManager,
  params: {
    symbol: string;
    side: 'buy' | 'sell';
    amount: number;
    price?: number;
    leverage?: number;
  }
) {
  const workflow = tradingManager.getWorkflow();
  if (!workflow) throw new Error('Trading workflow is not running');
  const exchange = workflow.getExchange();
  const order = await exchange.placeOrder(
    params.symbol,
    params.side,
    params.amount,
    params.price,
    params.leverage
  );
  // Set metadata for simulator exchange if applicable
  if (supportsOrderMetadata(exchange) && order?.id) {
    exchange.setOrderMetadata(order.id, 'manual', 'manual-order');
  }
  tradingManager.pushOrder({
    id: order?.id ?? `${params.symbol}-${Date.now()}`,
    timestamp: Date.now(),
    symbol: params.symbol,
    side: params.side,
    amount: params.amount,
    price: params.price,
    status: order?.status ?? 'open',
    source: 'manual',
    reason: 'manual-order',
  });
  return order;
}

export async function runBacktestService(params: {
  start: string;
  end: string;
  coins: string | string[];
  initialBalance: number;
}) {
  const { BacktestEngine } = await import('../core/backtest-engine.js');
  const coinsList = (typeof params.coins === 'string' ? params.coins : params.coins.join(','))
    .split(',')
    .map(c => c.trim().toUpperCase())
    .filter(c => c.length > 0);

  const backtestConfig: BacktestConfig = {
    startDate: params.start,
    endDate: params.end,
    initialBalance: params.initialBalance,
    coins: coinsList,
    cyclePeriod: 180000,
    maxPositions: 6,
    leverage: 1,
  };

  const engine = new BacktestEngine(backtestConfig);
  const result = await engine.runBacktest();

  const equityCurve = (result.equitySnapshots || []).map(s => ({
    timestamp: s.timestamp,
    equity: s.equity,
  }));
  const trades = (result.trades || []).map(t => ({
    id: t.id,
    time: t.exitTime || t.entryTime,
    symbol: t.symbol,
    side: t.side,
    qty: t.size,
    price: t.exitPrice ?? t.entryPrice,
    pnl: t.pnl,
  }));

  const metrics = result.metrics;
  const summary = {
    totalPnl: metrics?.totalPnL ?? result.finalEquity - result.config.initialBalance,
    winRate: (metrics?.winRate ?? 0) / 100,
    sharpe: metrics?.sharpeRatio ?? 0,
    avgTradePnl: trades.length
      ? trades.reduce((s: number, t: { pnl?: number }) => s + (t.pnl || 0), 0) / trades.length
      : 0,
    maxDrawdown: metrics?.maxDrawdown ?? 0,
  };

  return { equityCurve, trades, summary };
}

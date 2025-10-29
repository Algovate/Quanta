import { TradingManager } from './trading-manager.js';
import { getConfig } from '../config/settings.js';
import type { BacktestConfig } from '../types/index.js';

export async function startTradingService(
  tradingManager: TradingManager,
  coins?: string | string[]
) {
  const config = getConfig();
  const { SimulatorExchange } = await import('../exchange/simulator.js');
  const { MarketDataProvider } = await import('../data/market.js');
  const { OpenRouterClient } = await import('../ai/agent.js');

  const exchange = new SimulatorExchange(10000);
  const marketProvider = new MarketDataProvider(exchange);
  const aiClient = new OpenRouterClient(config.ai.apiKey);

  const tradingCoins = coins || config.trading.coins;
  const coinsArray: string[] =
    typeof tradingCoins === 'string'
      ? (tradingCoins as string).split(',')
      : (tradingCoins as string[]);
  const workflowConfig = {
    coins: coinsArray,
    cyclePeriod: config.trading.cyclePeriod,
    maxPositions: config.trading.maxPositions,
    riskParams: {
      maxRiskPerTrade: config.trading.maxRisk,
      maxTotalRisk: 0.3,
      defaultStopLoss: config.trading.stopLoss,
      maxLeverage: config.trading.leverageRange[1],
      minLeverage: config.trading.leverageRange[0],
      maxPositions: config.trading.maxPositions,
    },
  };

  await tradingManager.start(exchange, marketProvider, aiClient, workflowConfig);
}

export async function getPositionsService(tradingManager: TradingManager) {
  const workflow = tradingManager.getWorkflow();
  if (!workflow) return [];
  const exchange = workflow.getExchange();
  return exchange.getPositions();
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
  tradingManager.pushOrder({
    id: order?.id ?? `${params.symbol}-${Date.now()}`,
    timestamp: Date.now(),
    symbol: params.symbol,
    side: oppositeSide,
    amount: target.size,
    status: order?.status ?? 'open',
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
  tradingManager.pushOrder({
    id: order?.id ?? `${params.symbol}-${Date.now()}`,
    timestamp: Date.now(),
    symbol: params.symbol,
    side: params.side,
    amount: params.amount,
    price: params.price,
    status: order?.status ?? 'open',
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

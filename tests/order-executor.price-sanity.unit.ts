import assert from 'node:assert';

// Minimal types to satisfy imports
type Order = { id: string; symbol: string; side: 'buy' | 'sell'; amount: number; price?: number; status: 'open' | 'filled' | 'rejected'; timestamp: number };

// Fake Exchange capturing the price used
class FakeExchange {
  lastPlaced?: { symbol: string; side: 'buy' | 'sell'; amount: number; price?: number; leverage?: number };
  async placeOrder(symbol: string, side: 'buy' | 'sell', amount: number, price?: number, leverage?: number): Promise<Order> {
    this.lastPlaced = { symbol, side, amount, price, leverage };
    return {
      id: `${symbol}-${Date.now()}`,
      symbol,
      side,
      amount,
      price,
      status: 'filled',
      timestamp: Date.now(),
    };
  }
  async cancelOrder(): Promise<boolean> { return true; }
  async getTicker(_symbol: string) { return { price: 100, timestamp: Date.now() }; }
}

// Fake RiskManager with permissive sizing
class FakeRiskManager {
  validateSignal() { return { valid: true } as any; }
  calculatePositionSizing(_signal: any, _account: any, _positions: any[], _currentPrice: number) {
    return { suggestedSize: 1, leverage: 10 };
  }
}

async function testConvertsStaleEntryToMarket() {
  const { OrderExecutor } = await import('../src/execution/orders.js');

  const ex = new FakeExchange() as any;
  const rm = new FakeRiskManager() as any;
  const ox = new OrderExecutor(ex, rm, { forceMarketOrders: false });

  const signal = {
    coin: 'BTC',
    action: 'SHORT',
    entry_price: 60, // 40% away from current (100)
    confidence: 0.8,
  } as any;

  const res = await ox.executeSignal(signal, { equity: 10000 } as any, [], 100);
  assert.ok(res.success, 'execution succeeds');
  assert.strictEqual(ex.lastPlaced?.price, undefined, 'price should be undefined (market)');
}

async function testUsesWithinThresholdEntry() {
  const { OrderExecutor } = await import('../src/execution/orders.js');

  const ex = new FakeExchange() as any;
  const rm = new FakeRiskManager() as any;
  const ox = new OrderExecutor(ex, rm, { forceMarketOrders: false });

  const signal = {
    coin: 'BTC',
    action: 'SHORT',
    entry_price: 104, // 4% away from current (100)
    confidence: 0.8,
  } as any;

  const res = await ox.executeSignal(signal, { equity: 10000 } as any, [], 100);
  assert.ok(res.success, 'execution succeeds');
  assert.ok(Math.abs((ex.lastPlaced?.price ?? 0) - 104) < 1e-6, 'price should use provided entry');
}

async function run() {
  try {
    await testConvertsStaleEntryToMarket();
    // eslint-disable-next-line no-console
    console.log('✓ stale price converts to market');
  } catch (e) {
    // eslint-disable-next-line no-console
    console.error('✗ stale price converts to market:', (e as Error)?.message);
    process.exitCode = 1;
  }

  try {
    await testUsesWithinThresholdEntry();
    // eslint-disable-next-line no-console
    console.log('✓ within threshold uses provided entry price');
  } catch (e) {
    // eslint-disable-next-line no-console
    console.error('✗ within threshold uses provided entry price:', (e as Error)?.message);
    process.exitCode = 1;
  }
}

void run();



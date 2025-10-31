import assert from 'node:assert';

const { BacktestExchange } = await import('../src/exchange/backtest.js');

async function testSlippageBoundedToFiveBps() {
  const start = Date.now();
  // Deterministic RNG that returns 1, yielding max slippage 0.0005
  const rng = () => 1;
  const ex = new BacktestExchange(10000, start, rng);

  const symbol = 'ETH/USDT';
  const key3m = `${symbol}_3m`;
  const baseTs = start - 5 * 60 * 1000;
  const candles3m = [
    { timestamp: baseTs, open: 2000, high: 2001, low: 1999, close: 2000, volume: 1 },
    {
      timestamp: baseTs + 3 * 60 * 1000,
      open: 2000,
      high: 2002,
      low: 1998,
      close: 2010,
      volume: 1,
    },
  ];
  ex.loadHistoricalData(key3m, candles3m as any);
  ex.setCurrentTime(baseTs + 4 * 60 * 1000);

  const before = await ex.getTicker(symbol);
  const order = await ex.placeOrder(symbol, 'buy', 1);
  assert.strictEqual(order.status, 'filled');

  const executed = order.price;
  const maxUp = before.price * 1.0005 + 1e-9;
  assert.ok(executed <= maxUp && executed >= before.price, 'buy executed price within 5 bps');
}

async function run() {
  try {
    await testSlippageBoundedToFiveBps();
    console.log('✓ slippage bounded to 5 bps');
  } catch (e) {
    console.error('✗ slippage bounded to 5 bps:', (e as Error)?.message);
    process.exitCode = 1;
  }
}

void run();

import assert from 'node:assert';

async function testBacktestPriceLookupUsesTimeframeKey() {
  const { BacktestExchange } = await import('../src/exchange/backtest.js');

  const start = Date.UTC(2024, 0, 1, 0, 0, 0);
  const t0 = start;
  const t1 = start + 3 * 60 * 1000; // +3m
  const t2 = start + 6 * 60 * 1000; // +6m

  // Build simple 3m candles with known closes
  const candles = [
    { timestamp: t0, open: 100, high: 101, low: 99, close: 100, volume: 1000 },
    { timestamp: t1, open: 100, high: 102, low: 100, close: 101, volume: 1100 },
    { timestamp: t2, open: 101, high: 103, low: 101, close: 102, volume: 1200 },
  ];

  const rng = () => 0; // deterministic
  const ex = new BacktestExchange(10000, start, rng);
  ex.loadHistoricalData('BTC/USDT_3m', candles as any);

  // At t1, price should be close of second candle (101)
  ex.setCurrentTime(t1);
  const { price } = await ex.getTicker('BTC/USDT');
  assert.strictEqual(price, 101);
}

async function run() {
  try {
    await testBacktestPriceLookupUsesTimeframeKey();
    // eslint-disable-next-line no-console
    console.log('✓ backtest price lookup uses timeframe key');
  } catch (e) {
    // eslint-disable-next-line no-console
    console.error('✗ backtest price lookup uses timeframe key:', (e as Error)?.message);
    process.exitCode = 1;
  }
}

void run();

import assert from 'node:assert';

const { BacktestExchange } = await import('../src/exchange/backtest.js');

async function testPriceUses3mWhenAvailable() {
  const start = Date.now();
  const ex = new BacktestExchange(1000, start);

  const symbol = 'BTC/USDT';
  const key3m = `${symbol}_3m`;
  const baseTs = start - 10 * 60 * 1000; // 10 minutes ago
  const candles3m = [
    { timestamp: baseTs, open: 100, high: 105, low: 95, close: 100, volume: 1 },
    { timestamp: baseTs + 3 * 60 * 1000, open: 100, high: 106, low: 99, close: 102, volume: 1 },
    { timestamp: baseTs + 6 * 60 * 1000, open: 102, high: 110, low: 101, close: 108, volume: 1 },
  ];

  ex.loadHistoricalData(key3m, candles3m as any);
  ex.setCurrentTime(baseTs + 7 * 60 * 1000);

  const t = await ex.getTicker(symbol);
  assert.strictEqual(t.price, 108, 'ticker price should use latest 3m candle close');
}

async function run() {
  try {
    await testPriceUses3mWhenAvailable();
    console.log('✓ backtest price lookup prefers 3m timeframe');
  } catch (e) {
    console.error('✗ backtest price lookup prefers 3m timeframe:', (e as Error)?.message);
    process.exitCode = 1;
  }
}

void run();

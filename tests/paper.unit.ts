import assert from 'node:assert';

class FakeRealExchange {
  name = 'okx';
  getExchangeName() { return 'okx'; }
  isTestnetMode() { return true; }
  async getTicker(symbol: string) {
    // Deterministic mid
    return { price: symbol.startsWith('ETH') ? 3800 : 1000, timestamp: Date.now() };
  }
  async getCandlesticks(_s: string, _tf: string, _l: number) {
    return [];
  }
}

const { PaperExchange } = await import('../src/exchange/paper.js');

async function testPaperExecAtMid() {
  const real = new FakeRealExchange() as any;
  const paper = new PaperExchange(real, 10000);

  const order = await paper.placeOrder('ETH/USDT', 'buy', 0.5, undefined, 10);
  assert.strictEqual(order.status, 'filled');
  assert.ok(Math.abs(order.price - 3800) < 1e-6, 'executed at mid');

  const positions = await paper.getPositions();
  assert.strictEqual(positions.length, 1);
  const p = positions[0];
  assert.strictEqual(p.symbol, 'ETH/USDT');
  assert.strictEqual(p.side, 'long');
  assert.strictEqual(p.leverage, 10);
  assert.ok(p.size - 0.5 < 1e-8);

  const account = await paper.getAccount();
  // Used margin approximately (size*price)/leverage
  const expectedUsed = (0.5 * 3800) / 10;
  assert.ok(Math.abs(account.usedMargin - expectedUsed) < 0.01);
}

async function run() {
  try {
    await testPaperExecAtMid();
    // eslint-disable-next-line no-console
    console.log('✓ paper executes at mid and updates state');
  } catch (e) {
    // eslint-disable-next-line no-console
    console.error('✗ paper executes at mid and updates state:', (e as Error)?.message);
    process.exitCode = 1;
  }
}

void run();



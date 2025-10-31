import assert from 'node:assert';

type Ticker = { last?: number; close?: number; timestamp?: number };

class FakeOKX {
  public apiKey?: string;
  public secret?: string;
  public calls: Record<string, number> = {};
  private sandbox = false;
  private loadShouldFailOnce = false;
  private ticker: Ticker = { last: 123, timestamp: 111 };
  private positions: Array<Record<string, unknown>> = [];

  constructor(opts: Record<string, unknown>) {
    this.apiKey = opts.apiKey as string | undefined;
    this.secret = opts.secret as string | undefined;
  }

  setSandboxMode(flag: boolean) {
    this.sandbox = flag;
    this.calls.setSandboxMode = (this.calls.setSandboxMode || 0) + 1;
  }

  getSandboxMode() {
    return this.sandbox;
  }

  setLoadMarketsFailOnce() {
    this.loadShouldFailOnce = true;
  }

  setTicker(t: Ticker) {
    this.ticker = t;
  }

  setPositions(p: Array<Record<string, unknown>>) {
    this.positions = p;
  }

  async loadMarkets() {
    this.calls.loadMarkets = (this.calls.loadMarkets || 0) + 1;
    if (this.loadShouldFailOnce) {
      this.loadShouldFailOnce = false;
      throw new Error('loadMarkets failed');
    }
  }

  async fetchTicker(_symbol: string) {
    this.calls.fetchTicker = (this.calls.fetchTicker || 0) + 1;
    return this.ticker;
  }

  async fetchPositions() {
    this.calls.fetchPositions = (this.calls.fetchPositions || 0) + 1;
    return this.positions;
  }

  async createOrder(
    symbol: string,
    _type: string,
    side: 'buy' | 'sell',
    amount: number,
    price?: number
  ) {
    this.calls.createOrder = (this.calls.createOrder || 0) + 1;
    return {
      id: 'order-1',
      symbol,
      side,
      amount,
      price,
      status: 'closed',
    };
  }

  async cancelOrder(_orderId: string, _symbol: string) {
    this.calls.cancelOrder = (this.calls.cancelOrder || 0) + 1;
    return true;
  }
}

const { OKXExchange } = await import('../../src/exchange/okx.js');

async function testSandboxMode() {
  const ex = new OKXExchange('key', 'secret', true, FakeOKX as unknown as new (o: Record<string, unknown>) => never);
  // @ts-expect-error accessing private for test
  const fake: FakeOKX = (ex as unknown as { exchange: FakeOKX }).exchange;
  assert.strictEqual(fake.getSandboxMode(), true, 'Sandbox mode should be enabled');
  assert.strictEqual(fake.calls.setSandboxMode, 1, 'setSandboxMode should be called once');
}

async function testEnsureMarketsRetry() {
  const ex = new OKXExchange('key', 'secret', true, FakeOKX as unknown as new (o: Record<string, unknown>) => never);
  // @ts-expect-error accessing private for test
  const fake: FakeOKX = (ex as unknown as { exchange: FakeOKX }).exchange;
  fake.setLoadMarketsFailOnce();
  // First call should trigger load failure then retry on second invocation
  let failed = false;
  try {
    await ex.getTicker('BTC/USDT');
  } catch {
    failed = true;
  }
  assert.strictEqual(failed, true, 'First ticker call should fail due to loadMarkets error');

  // Second call should succeed and loadMarkets called twice total
  fake.setTicker({ last: 1000, timestamp: 222 });
  const t = await ex.getTicker('BTC/USDT');
  assert.strictEqual(t.price, 1000);
  assert.strictEqual(typeof t.timestamp, 'number');
  assert.strictEqual(fake.calls.loadMarkets, 2, 'loadMarkets should be called twice');
}

async function testGetPositionsNoCreds() {
  const ex = new OKXExchange(undefined, undefined, true, FakeOKX as unknown as new (o: Record<string, unknown>) => never);
  const positions = await ex.getPositions();
  assert.ok(Array.isArray(positions));
  assert.strictEqual(positions.length, 0);
}

async function testTickerBasic() {
  const ex = new OKXExchange('key', 'secret', false, FakeOKX as unknown as new (o: Record<string, unknown>) => never);
  // @ts-expect-error accessing private for test
  const fake: FakeOKX = (ex as unknown as { exchange: FakeOKX }).exchange;
  fake.setTicker({ close: 321, timestamp: 333 });
  const t = await ex.getTicker('ETH/USDT');
  assert.strictEqual(t.price, 321);
  assert.ok(t.timestamp > 0);
}

async function testPlaceOrderRequiresCreds() {
  const ex = new OKXExchange(undefined, undefined, false, FakeOKX as unknown as new (o: Record<string, unknown>) => never);
  let threw = false;
  try {
    await ex.placeOrder('BTC/USDT', 'buy', 1);
  } catch {
    threw = true;
  }
  assert.strictEqual(threw, true, 'placeOrder should throw without credentials');
}

async function run() {
  const origError = console.error;
  const origWarn = console.warn;
  // Silence noisy logger output during intentional failure scenarios
  // eslint-disable-next-line no-console
  console.error = () => {};
  // eslint-disable-next-line no-console
  console.warn = () => {};
  const tests = [
    ['sandbox mode', testSandboxMode],
    ['ensureMarketsLoaded retry', testEnsureMarketsRetry],
    ['positions without creds', testGetPositionsNoCreds],
    ['ticker basic', testTickerBasic],
    ['placeOrder requires creds', testPlaceOrderRequiresCreds],
    [
      'resolveInstrument mapping',
      async () => {
        const ex = new OKXExchange('key', 'secret', true, FakeOKX as unknown as new (o: Record<string, unknown>) => never);
        assert.strictEqual(ex.resolveInstrument('BTC', 'perp'), 'BTC/USDT:USDT');
        assert.strictEqual(ex.resolveInstrument('BTC/USDT', 'perp'), 'BTC/USDT:USDT');
        assert.strictEqual(ex.resolveInstrument('BTC-USDT-SWAP', 'perp'), 'BTC/USDT:USDT');
        assert.strictEqual(ex.resolveInstrument('BTC/USDT:USDT', 'spot'), 'BTC/USDT');
      },
    ],
  ] as const;

  try {
    for (const [name, fn] of tests) {
      try {
        await fn();
        // eslint-disable-next-line no-console
        console.log(`✓ ${name}`);
      } catch (e) {
        // eslint-disable-next-line no-console
        console.error(`✗ ${name}:`, (e as Error)?.message);
        process.exitCode = 1;
      }
    }
  } finally {
    // Restore console methods
    // eslint-disable-next-line no-console
    console.error = origError;
    // eslint-disable-next-line no-console
    console.warn = origWarn;
  }
}

void run();



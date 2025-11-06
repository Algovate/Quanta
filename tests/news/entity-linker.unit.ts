import assert from 'node:assert';
import { ensureEntities } from '../../src/analytics/news/entity-linker.js';

describe('news entity linker', () => {
  it('links BTC and ETH from title text', () => {
    const ev = ensureEntities({
      id: '1',
      ts: Date.now(),
      source: 'test',
      title: 'Bitcoin and Ethereum surge on ETF news',
      entities: [],
      topics: [],
    });
    const syms = new Set(ev.entities.map(e => e.symbol));
    assert.ok(syms.has('BTC/USDT'));
    assert.ok(syms.has('ETH/USDT'));
  });
});

#!/usr/bin/env node

import 'dotenv/config';
import { OKXExchange } from '../../src/exchange/okx.js';

function parseArgs(argv: string[]): { symbol: string; live: boolean } {
  const args = new Map<string, string | boolean>();
  for (let i = 2; i < argv.length; i++) {
    const arg = argv[i];
    if (arg.startsWith('--')) {
      const [key, value] = arg.split('=');
      const cleanKey = key.replace(/^--/, '');
      if (value === undefined) {
        // Support "--key value" form
        const next = argv[i + 1];
        if (next && !next.startsWith('--')) {
          args.set(cleanKey, next);
          i += 1;
        } else {
          // Boolean flag
          args.set(cleanKey, true);
        }
      } else {
        // Support "--key=value" form
        args.set(cleanKey, value);
      }
    } else if (!args.has('symbol')) {
      args.set('symbol', arg);
    }
  }

  const symbol = (args.get('symbol') as string) || 'BTC/USDT:USDT';
  const live = Boolean(args.get('live'));
  return { symbol, live };
}

async function main() {
  const { symbol, live } = parseArgs(process.argv);

  // Auth is not required for public ticker, but passphrase is read from env when provided
  const apiKey = process.env.OKX_API_KEY;
  const apiSecret = process.env.OKX_API_SECRET;

  const exchange = new OKXExchange(apiKey, apiSecret, !live);

  console.log(`Fetching ticker from OKX (${live ? 'live' : 'testnet'}) for ${symbol}...`);
  const { price, timestamp } = await exchange.getTicker(symbol);
  console.log(JSON.stringify({ exchange: 'okx', symbol, price, timestamp }, null, 2));
}

main().catch(error => {
  console.error('Failed to fetch OKX ticker:', error);
  process.exit(1);
});



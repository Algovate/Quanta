import assert from 'node:assert';
import { updateAccountEquity } from '../src/exchange/position-calculations.js';
import { calculateMargin, createPosition } from '../src/exchange/position-calculations.js';
import { Account, Position } from '../src/exchange/types.js';

function makeAccount(initialBalance = 10000): Account {
  return {
    balance: initialBalance,
    equity: initialBalance,
    availableMargin: initialBalance,
    usedMargin: 0,
    marginRatio: 0,
    timestamp: Date.now(),
  };
}

async function run() {
  // Setup account and one long position
  const account = makeAccount(10000);
  const price = 2000;
  const size = 0.5; // notional 1000
  const leverage = 5;

  const pos: Position = createPosition('ETH/USDT', 'long', size, price, leverage, Date.now());
  const positions: Position[] = [pos];

  // Opening reduces available and increases used margin
  const marginRequired = calculateMargin(size, price, leverage);
  account.availableMargin -= marginRequired;
  account.usedMargin += marginRequired;

  // Initial recompute
  updateAccountEquity(account, positions);
  assert.ok(Math.abs(account.equity - (account.balance + 0)) < 0.01);
  assert.ok(
    Math.abs(account.availableMargin - Math.max(0, account.equity - account.usedMargin)) < 0.01
  );

  // Apply a fee and partial close (simulate)
  const fee = 1.23;
  account.balance -= fee;

  // Partial close 20% of size at slightly higher price
  const closeAmount = size * 0.2;
  const exitPrice = 2020;
  // Release margin proportional to close
  const ratio = closeAmount / pos.size;
  const marginToReturn = pos.marginUsed * ratio;
  pos.size -= closeAmount;
  pos.marginUsed -= marginToReturn;

  // Account updates for partial close: return margin + add realized pnl to balance
  const realized = (exitPrice - pos.entryPrice) * closeAmount;
  account.balance += realized;
  account.usedMargin -= marginToReturn;
  account.availableMargin += marginToReturn + realized;

  // Recompute (this mirrors code we added after partial close)
  updateAccountEquity(account, positions);

  // Invariants hold within tolerance
  assert.ok(Math.abs(account.equity - (account.balance + 0)) < 0.01);
  assert.ok(
    Math.abs(account.availableMargin - Math.max(0, account.equity - account.usedMargin)) < 0.01
  );

  console.log('✓ account-equity invariants');
}

void run();

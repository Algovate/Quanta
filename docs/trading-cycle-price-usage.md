# Trading Cycle Price Usage Documentation

This document details all price types used in the Trading Cycle execution process, their timing, and rationale.

## Overview

Trading Cycle is the core execution flow of the system. Each cycle:
1. Fetches account and position snapshots
2. Monitors existing positions
3. Fetches market data
4. Generates trading signals
5. Executes trading signals

Throughout the flow, different stages use different price types. Understanding these distinctions is crucial for system correctness.

## Price Type Definitions

### 1. Mark Price
- **Definition**: Fair price used by exchanges to calculate unrealized PnL, especially important for derivatives
- **Source**: `Position.markPrice`, obtained via `exchange.getSnapshot()` or `exchange.refreshMarks()`
- **Update Frequency**: Updated on each snapshot fetch
- **Usage**:
  - Calculate position unrealized PnL
  - Calculate account equity (Equity = Balance + Σ(Unrealized PnL))
  - Risk checks and margin calculations

### 2. Current Price / Ticker Price
- **Definition**: Latest market price from exchange, typically from `getTicker()`
- **Source**: Price returned by `exchange.getTicker(symbol)` 
  - **OKX**: Returns mark price (for derivatives PnL accuracy)
  - **Binance/Coinbase/Hyperliquid**: Returns last/close price (spot market price)
  - **Paper/Simulator**: Delegates to underlying exchange's `getTicker()`
- **Update Frequency**: Fetched on-demand, typically before signal execution
- **Usage**:
  - Signal validation (check if price is available)
  - Position sizing calculations
  - Order execution decisions (Market vs Limit Order)
  - Slippage calculations (compare expected vs execution price)
- **Important**: For OKX derivatives, this returns mark price (same as markPrice), but the term "currentPrice" is used to indicate it's the current/latest price available, which happens to be mark price for derivatives exchanges

### 3. Entry Price
- **Definition**: Position opening price, or entry price specified in signal
- **Source**:
  - Position: `Position.entryPrice`
  - Signal: `TradingSignal.entry_price`
  - Order execution: Actual fill price
- **Update Frequency**: Set when position opens, unchanged afterward
- **Usage**:
  - Stop loss/take profit calculations (based on entry price)
  - PnL percentage calculations
  - Price reference for position sizing

### 4. Actual Price / Execution Price
- **Definition**: Actual fill price of the order
- **Source**: `Order.price` (Market Order may be 0, needs fallback to currentPrice)
- **Update Frequency**: Determined when order fills
- **Usage**:
  - Slippage calculations (actualPrice vs currentPrice)
  - Logging
  - Performance analysis

### 5. Signal Entry Price
- **Definition**: Entry price suggested in AI signal (optional)
- **Source**: `TradingSignal.entry_price`
- **Update Frequency**: Each signal generation
- **Usage**:
  - Limit Order price setting
  - Price reasonableness check (stale price guard)

## Trading Cycle Price Usage Flow

### Phase 1: Fetch Account and Position Snapshot (getSnapshot)

**Timing**: At cycle start, in `executeCycle()` method

**Code Location**: `workflow.ts` → `executeCycle()` → `snapshotService.getSnapshot()`

```typescript
const { account, positions } = await this.snapshotService.getSnapshot();
```

**Prices Used**:
- `Position.markPrice` - Mark price for each position
- `Position.entryPrice` - Entry price for each position

**Rationale**:
- Mark Price is used to calculate account equity (Equity = Balance + Σ(Unrealized PnL))
- Entry Price is used for subsequent stop loss/take profit calculations
- Snapshot ensures data consistency (account and positions at the same point in time)

**Price Source**:
- `Exchange.getSnapshot()` preferred (atomic snapshot)
- Otherwise: `exchange.getAccount()` + `exchange.getPositions()`

**Notes**:
- Mark Price must be valid (> 0, finite), otherwise PnL calculation will be incorrect
- Snapshot service validates consistency: Equity = Balance + Σ(Unrealized PnL)

---

### Phase 2: Monitor Existing Positions (monitorPositions)

**Timing**: After snapshot fetch, if positions exist

**Code Location**: `workflow.ts` → `executeCycle()` → `positionMonitor.monitorPositions()`

```typescript
positionDecisionInfos = await this.positionMonitor.monitorPositions(
  enrichedPositions,
  this.exchange
);
```

**Prices Used**:
- `Position.markPrice` - From snapshot (current PnL calculation)
- `currentPrice` - Via `exchange.getTicker(position.symbol)` (latest market price)

**Rationale**:
- **Mark Price**:
  - Already fetched from snapshot, reflects current position state
  - Used for risk assessment (Maintenance Margin checks)
  - Used to calculate current PnL percentage
  
- **Current Price (Ticker)**:
  - Used for stop loss/take profit trigger decisions
  - Used for maintenance margin checks (requires latest market price)
  - Used for TP1, Breakeven, Auto-Close strategies

**Price Fetch Flow** (`monitor.ts` → `monitorPositions()` method):
```typescript
const ticker = await exchange.getTicker(position.symbol);
const currentPrice = ticker.price; // Strictly validated (> 0, finite)

// Validation: throws error if invalid (must be > 0, finite)
if (currentPrice === undefined || currentPrice === null || 
    !isFinite(currentPrice) || currentPrice <= 0) {
  throw new Error(`Invalid price received: ${currentPrice}`);
}
```

**Important Note**: For OKX, `getTicker()` returns mark price, so `currentPrice` here is actually mark price. However, the terminology "currentPrice" is used because it represents the current/latest available price, which for derivatives exchanges is the mark price.

**Use Cases**:

1. **Maintenance Margin Check** (`monitor.ts` → `monitorPositions()`)
   - Uses: `currentPrice` from `getTicker()` (latest market price, mark price for OKX)
   - Rationale: Need real-time price to determine if close to liquidation
   - Implementation: `riskManager.checkMaintenance(position, currentPrice)`

2. **Stop Loss Check** (`monitor.ts` → `monitorPositions()`)
   - Uses: `currentPrice` vs `position.entryPrice`
   - Rationale: Compare current price vs entry price to determine stop loss trigger
   - Note: For OKX, `currentPrice` is actually mark price, which is correct for derivatives

3. **Take Profit Check** (`monitor.ts` → `monitorPositions()`)
   - Uses: `currentPrice` vs `position.entryPrice`
   - Rationale: Compare current price vs entry price to determine take profit trigger

4. **TP1 Strategy** (`monitor.ts` → `monitorPositions()`)
   - Uses: `currentPrice` vs `position.entryPrice`
   - Rationale: Calculate PnL percentage (R-multiple), decide on partial close (50%)
   - Implementation: If R-multiple >= 1.0, close 50% and move stop to breakeven

5. **Breakeven Strategy** (`monitor.ts` → `monitorPositions()`)
   - Uses: `currentPrice` vs `position.entryPrice`
   - Rationale: Determine if reached breakeven point, adjust stop loss
   - Implementation: After TP1, stop loss moved to entry price (breakeven)

6. **Auto-Close Conditions** (`monitor.ts` → `monitorPositions()`)
   - Uses: `currentPrice` + `position.markPrice`
   - Rationale: Decide auto-close based on latest price and market state
   - Implementation: Flat positions (R <= threshold) for N cycles trigger auto-close

**Notes**:
- Monitoring stage re-fetches ticker price because position monitoring needs latest market price
- **Mark Price** used for displaying current PnL (from snapshot, already fetched)
- **Current Price** used for trigger condition decisions (freshly fetched via `getTicker()`)
- **For OKX**: Both markPrice and currentPrice are mark price (same source), but fetched at different times
- **For other exchanges**: markPrice may come from position data, currentPrice is latest market price

---

### Phase 3: Fetch Market Data (fetchMarketData)

**Timing**: After monitoring positions

**Code Location**: `workflow.ts` → `executeCycle()` → `fetchMarketDataParallel()` or `fetchMarketDataSequential()`

```typescript
const marketDataResult = await this.fetchMarketDataParallel(
  this.config.coins,
  timeframes,
  tickerCache,
  getTickerPrice
);
```

**Prices Used**:
- `Ticker Price` - Fetched via `getTickerPrice()` and cached

**Rationale**:
- Provide price context for signal generation
- Cache prices to avoid redundant API calls
- Used for technical indicator calculations (though mainly uses kline data)

**Price Fetch** (`workflow.ts` → `executeCycle()` → `getTickerPrice()` helper):
```typescript
const getTickerPrice = async (symbol: string): Promise<number | undefined> => {
  // 1. Check cache
  const cached = tickerCache.get(symbol);
  if (cached && cached.price > 0 && isFinite(cached.price)) {
    return cached.price;
  }
  
  // 2. Fetch from exchange via snapshot service
  const ticker = await this.snapshotService.getTicker(symbol);
  const price = ticker.price;
  
  // 3. Validate and cache
  if (price !== undefined && price !== null && isFinite(price) && price > 0) {
    tickerCache.set(symbol, { price, timestamp: Date.now() });
    return price;
  }
  
  // Log warning and return undefined for invalid prices
  this.logger.warn(`Invalid price from ticker for ${symbol}: ${price}`);
  return undefined; // Don't cache invalid prices
};
```

**Exchange-Specific Behavior**:
- **OKX**: `getTicker()` returns mark price (via `getMarkAndBestPrices()`)
- **Binance/Coinbase/Hyperliquid**: Returns last/close price (spot market price)
- **Paper**: Delegates to underlying exchange (may be OKX, Binance, etc.)
- **Simulator/Backtest**: Returns price from market data or base price

**Notes**:
- Only cache valid prices (> 0, finite)
- Return `undefined` instead of 0, forcing callers to handle invalid cases
- Cache TTL is implicit (no explicit expiration, refreshed per cycle)

---

### Phase 4: Generate Trading Signals (generateSignals)

**Timing**: After fetching market data

**Code Location**: `workflow.ts` → `executeCycle()` → `aiClient.generateSignals()`

```typescript
const signals = await this.aiClient.generateSignals(context);
```

**Prices Used**:
- Signal may contain `entry_price` (optional)
- AI generates suggestions based on market data (kline + indicators)

**Price Information**:
- `TradingSignal.entry_price` - Suggested entry price (optional)
- Technical analysis calculated from historical kline data

**Rationale**:
- Entry Price used for subsequent Limit Order price setting
- If signal contains entry_price, it will be used during execution (if reasonable)

**Notes**:
- Entry Price will be validated (stale price guard)
- If deviation from current price is too large, will be converted to Market Order

---

### Phase 5: Execute Signal (executeSignal)

**Timing**: After signal generation, executed one by one in a loop

**Code Location**: `workflow.ts` → `executeCycle()` → signal execution loop → `executeSignal()`

**Stage 5.1: Get Execution Price** (`workflow.ts` → `executeCycle()` → `getCachedPrice()` helper)

```typescript
const currentPrice = await getCachedPrice(symbol);
```

**getCachedPrice Implementation**:
```typescript
const getCachedPrice = async (symbol: string): Promise<number | undefined> => {
  // Check ticker cache first
  const cached = tickerCache.get(symbol);
  if (cached && cached.price > 0 && isFinite(cached.price)) {
    return cached.price;
  }
  
  // Fetch fresh if not cached or invalid
  const ticker = await this.snapshotService.getTicker(symbol);
  const price = ticker.price;
  
  // Validate and cache
  if (price !== undefined && price !== null && isFinite(price) && price > 0) {
    tickerCache.set(symbol, { price, timestamp: Date.now() });
    return price;
  }
  
  return undefined;
};
```

**Prices Used**:
- `currentPrice` - From ticker cache or real-time fetch

**Rationale**:
- Validate price availability (must be > 0, finite)
- Used for position sizing
- Used for order execution decisions

**Price Validation** (`workflow.ts` → `executeCycle()` → signal execution loop):
```typescript
if (currentPrice === undefined || currentPrice <= 0) {
  // Skip signal execution - log warning and continue with next signal
  this.logger.warn('Signal execution skipped due to unavailable price', {
    coin: signal.coin,
    symbol,
    action: signal.action,
    price: currentPrice,
  });
  continue;
}
```

---

**Stage 5.2: Position Sizing** (`workflow.ts` → `executeSignal()` → `riskManager.calculatePositionSizing()`)

```typescript
const sizing = this.riskManager.calculatePositionSizing(
  signal,
  account,
  positions,
  currentPrice,  // Used for calculation
  atr14,
  indicators
);
```

**Prices Used**:
- `currentPrice` - Current market price (required, validated)
- `signal.entry_price` - Entry price from signal (optional)
- `Position.markPrice` - Mark price of existing positions (for risk calculation)

**Rationale**:
- **Current Price**:
  - Used to calculate position size (based on current market price)
  - Used for risk amount calculation ($ risk = % risk × equity)
  - Used for stop loss distance calculation (ATR-based stop loss)

- **Entry Price**:
  - If signal provides entry_price, use it preferentially
  - Otherwise use currentPrice as entry price
  - Used for stop loss/take profit calculations

**Calculation Flow** (`risk.ts` → `calculatePositionSizing()`):
```typescript
// 1. Validate currentPrice
if (currentPrice <= ACCOUNT_VALIDATION.MIN_VALID_PRICE) return null;

// 2. Use entry_price or currentPrice as entry price
const entryPrice = signal.entry_price || currentPrice;

// 3. Calculate stop loss distance (ATR-based if available)
const stopLoss = signal.stop_loss || this.params.defaultStopLoss;
let stopLossPercent = stopLoss; // Percentage-based default

// If ATR available, calculate ATR-based stop loss
if (atr14 && atr14 > 0 && entryPrice > 0) {
  const atrBasedStopLoss = (atr14 * ATR_STOP_LOSS_MULTIPLIER) / entryPrice;
  // Adjust based on market regime (trending vs ranging)
  stopLossPercent = regime === 'trending' 
    ? atrBasedStopLoss * 1.5  // Wider stops in trending markets
    : atrBasedStopLoss * 1.0;  // Tighter stops in ranging markets
}

// 4. Calculate position size based on risk
const riskAmount = safePercentage(account.equity, this.params.maxRiskPerTrade).toNumber();
const priceDistance = entryPrice * stopLossPercent;
const positionSize = riskAmount / Math.abs(priceDistance);

// 5. Apply leverage and max position constraints
const leverage = this.calculateLeverage(signal, account, positions);
const maxSize = this.calculateMaxSize(account, currentPrice, leverage);
```

---

**Stage 5.3: Order Execution** (`workflow.ts` → `executeSignal()` → `orderExecutor.executeSignal()`)

```typescript
const result = await this.orderExecutor.executeSignal(
  signal,
  account,
  positions,
  currentPrice  // Passed to executor (validated, > 0, finite)
);
```

**Prices Used**:
- `currentPrice` - Passed to OrderExecutor (validated)
- `signal.entry_price` - For Limit Order price setting (if reasonable)

**Execution Logic** (`orders.ts` → `executeSignal()` → `executeDirectionalOrder()`):

1. **Price Validation** (`orders.ts` → `executeDirectionalOrder()`):
   ```typescript
   // Validate current price before proceeding
   if (currentPrice <= 0 || !isFinite(currentPrice)) {
     return {
       success: false,
       error: `Invalid current price: ${currentPrice}`,
     };
   }
   ```

2. **Decide Order Type and Price** (`orders.ts` → `executeDirectionalOrder()`):
   ```typescript
   // Determine intended price
   let price = this.forceMarketOrders 
     ? undefined  // Force market orders
     : signal.entry_price || currentPrice;  // Use entry_price or currentPrice
   
   // Stale price guard: if entry_price deviates too much, convert to Market Order
   if (!this.forceMarketOrders && this.priceSanityEnabled && 
       signal.entry_price !== undefined) {
     const denom = currentPrice;
     const relDiff = denom > 0 
       ? Math.abs(signal.entry_price - denom) / denom 
       : 0;
     if (relDiff > this.priceSanityMaxDeviation) {
       this.logger.warn('Overriding stale entry price with market due to deviation', {
         coin: signal.coin,
         side,
         entryPrice: signal.entry_price,
         currentPrice: denom,
         relativeDiff: relDiff,
         maxAllowed: this.priceSanityMaxDeviation,
       });
       price = undefined; // Force market order
     }
   }
   ```

3. **Execute Order** (`orders.ts` → `executeDirectionalOrder()`):
   ```typescript
   const order = await this.exchange.placeOrder(
     symbol,
     side,
     amount,
     price,      // Limit price or undefined (Market Order)
     leverage
   );
   ```

**Notes**:
- Market Order: `price = undefined`, execution price determined by exchange
- Limit Order: `price = signal.entry_price` or `currentPrice`
- For Market Orders, `order.price` may be 0 or undefined

---

**Stage 5.4: Execution Result Processing** (`workflow.ts` → `executeSignal()` → result processing)

```typescript
// Use actual order execution price, not estimated ticker price
// For market orders, order.price may be 0 or undefined - use currentPrice as fallback
// For limit orders, order.price should be the execution price
const actualPrice = result.order.price && result.order.price > 0
  ? result.order.price      // Limit Order or Market Order (exchange returned price)
  : currentPrice;            // Market Order (price unavailable) - fallback

// Calculate slippage (only if we have valid prices)
const slippage = currentPrice > 0 && actualPrice > 0
  ? ((actualPrice - currentPrice) / currentPrice) * 100
  : 0;
const slippageAbs = Math.abs(slippage);
```

**Prices Used**:
- `actualPrice` - Actual order execution price
- `currentPrice` - Expected price (for slippage calculation)

**Rationale**:
- **Actual Price**:
  - Actual fill price (for logging and performance analysis)
  - If unavailable (Market Order), use currentPrice as approximation

- **Slippage Calculation**:
  - Compare actual price vs expected price
  - Used to monitor execution quality
  - If deviation > 5%, log warning

**Price Fallback Logic** (`workflow.ts` → `executeSignal()`):
```typescript
// Market Order's order.price may be 0 or undefined (exchange doesn't return fill price immediately)
// Use currentPrice (ticker price) as best approximation for slippage calculation
const actualPrice = result.order.price && result.order.price > 0
  ? result.order.price      // Limit Order or Market Order (exchange returned fill price)
  : currentPrice;            // Market Order (fill price unavailable) - use ticker price as approximation

// Warn if execution price deviates significantly from current ticker (possible symbol mismatch)
const relDiff = currentPrice > 0 
  ? Math.abs(actualPrice - currentPrice) / currentPrice 
  : 0;
if (relDiff > 0.05) {  // 5% tolerance
  this.logger.warn('Symbol/price mismatch suspected', {
    coin: signal.coin,
    symbol,
    executionPrice: actualPrice,
    tickerPrice: currentPrice,
    relativeDiff: relDiff,
  });
}
```

---

**Stage 5.5: Refresh Positions and Account** (`workflow.ts` → `executeCycle()` → snapshot refresh)

**Timing 1**: After each signal execution success (in signal execution loop)
```typescript
// Refresh positions and account after successful signal execution
// This ensures subsequent signals see the updated state
if (result.success && 
    (signal.action === 'LONG' || signal.action === 'SHORT' || signal.action === 'CLOSE')) {
  try {
    const snapshot = await this.snapshotService.getSnapshot();
    currentPositions = snapshot.positions;  // Contains updated markPrice
    currentAccount = snapshot.account;
  } catch (error) {
    // If refresh fails, abort remaining signals to prevent stale state
    this.logger.warn('Failed to refresh positions after signal execution', { error });
    break; // Exit signal loop
  }
}
```

**Timing 2**: After all signal executions complete (after signal loop)
```typescript
// Final snapshot refresh after all signal executions
const { account: updatedAccount, positions: updatedPositions } =
  await this.snapshotService.getSnapshot();
```

**Prices Used**:
- `Position.markPrice` - From snapshot (updated mark price)
- `Position.entryPrice` - Entry price of newly opened positions

**Rationale**:
- Ensure subsequent signals see latest position state
- Use updated markPrice for risk calculations
- Use actual entryPrice (may be execution price) instead of signal price

**Notes**:
- Each snapshot fetch updates all positions' markPrice
- New positions' entryPrice = actualPrice (actual fill price)
- Snapshot service may internally call `refreshMarks()` to update markPrice (depends on exchange implementation)

---

### Additional Note: refreshMarks() Invocation

**Invocation Timing**:
- **PaperExchange**: Automatically called after `placeOrder()` execution completes
  - Location: `paper.ts` → `placeOrder()` → after order execution
  - Purpose: Immediately update markPrice so PnL reflects latest market price within same cycle
- **PaperExchange**: Also called in `getAccount()`, `getPositions()`, and `getSnapshot()`
  - Location: `paper.ts` → `getAccount()` / `getPositions()` / `getSnapshot()`
  - Purpose: Ensure fresh markPrice when accessing account/position data
- **SimulatorExchange**: Called immediately after order execution
  - Location: `simulator.ts` → `placeOrder()` → after order execution
- **Snapshot Service**: If exchange supports `getSnapshot()`, may update during snapshot fetch
  - Note: Most exchanges' `getSnapshot()` returns positions with already-updated markPrice from exchange

**Purpose**:
- Update all positions' `markPrice`
- Ensure PnL calculations use latest prices
- Reflect market changes immediately after order execution

**Implementation** (`paper.ts` → `refreshMarks()` method):
```typescript
private async refreshMarks(): Promise<void> {
  const priceCache = new Map<string, number>();
  
  // 1. Get mark price for all position symbols
  const symbols = Array.from(new Set(this.positions.map(p => p.symbol)));
  
  // 2. Fetch all prices in parallel
  await Promise.all(
    symbols.map(async s => {
      try {
        const t = await this.real.getTicker(s);
        // getTicker() returns mark price for OKX, or appropriate price for other exchanges
        const price = validatePrice(t.price, `refreshMarks(${s})`);
        priceCache.set(s, price);
        // Update last known valid price for fallback
        this.lastKnownPrices.set(s, price);
      } catch (e) {
        // Try to use last known valid price as fallback
        const lastKnown = this.lastKnownPrices.get(s);
        try {
          const price = getValidPriceWithFallback(
            undefined,
            lastKnown,
            `refreshMarks(${s}) - ticker fetch failed`
          );
          priceCache.set(s, price);
          this.logger.warn(`Failed to fetch ticker for ${s}, using last known price ${price}`);
        } catch (fallbackError) {
          // No valid price - log error but don't update this position
          // Position will keep its previous markPrice
          this.logger.error(`Cannot refresh marks for ${s}: no valid price available`);
        }
      }
    })
  );
  
  // 3. Update all positions' markPrice via position manager
  const getPrice = (symbol: string): number => {
    const price = priceCache.get(symbol);
    if (price !== undefined) return price;
    
    // Try last known price as fallback
    const lastKnown = this.lastKnownPrices.get(symbol);
    if (lastKnown !== undefined) {
      try {
        return validatePrice(lastKnown, `refreshMarks.getPrice(${symbol})`);
      } catch {
        return 0; // PositionUpdateManager will skip if price is 0
      }
    }
    
    // No valid price available - return 0 (PositionUpdateManager will skip this position)
    this.logger.error(`No price available for ${symbol} in refreshMarks`);
    return 0; // PositionUpdateManager should handle this gracefully
  };
  
  // Only update positions with valid prices
  const positionsWithValidPrices = this.positions.filter(p => {
    const price = priceCache.get(p.symbol);
    return price !== undefined && price > 0;
  });
  
  if (positionsWithValidPrices.length > 0) {
    this.positionManager.updateAllPositions(getPrice);
  } else if (this.positions.length > 0) {
    this.logger.warn('No valid prices available for any position during refreshMarks');
  }
}
```

**Notes**:
- `refreshMarks()` uses `getTicker()`, which returns mark price for OKX
- Price validation: only update positions with valid prices
- Price fallback: use last known valid price to avoid invalid prices

---

## Exchange-Specific getTicker() Behavior

| Exchange | getTicker() Returns | Price Type | Use Case | Notes |
|----------|-------------------|------------|----------|-------|
| **OKX** | Mark Price | `markPx` from ticker.info, fallback to last/close | PnL calculation, position valuation | Critical for derivatives PnL accuracy |
| **Binance** | Last/Close Price | `ticker.last` or `ticker.close` | Spot market price | Not mark price (spot exchange) |
| **Coinbase** | Last/Close Price | `ticker.last` or `ticker.close` | Spot market price | Not mark price (spot exchange) |
| **Hyperliquid** | Last/Close Price | `ticker.last` or `ticker.close` | Market price | May return mark price if exchange provides it |
| **Paper** | Delegates to underlying | Depends on wrapped exchange | Same as underlying | Wraps OKX, Binance, etc. |
| **Simulator** | From market data or base price | Historical/simulated price | Simulation only | Uses provided market data |

**Important**: For derivatives trading (OKX), `getTicker()` returning mark price is intentional and correct for PnL calculations. However, when used for order execution decisions, the code may use this as "currentPrice" for reference, but the actual execution may differ.

---

## Price Usage Summary Table

| Stage | Price Types Used | Source | Purpose | Validation Requirements |
|-------|-----------------|--------|---------|------------------------|
| **1. Get Snapshot** | `markPrice` | `Position.markPrice` | Calculate Equity, PnL | Must be > 0, finite |
| | `entryPrice` | `Position.entryPrice` | Reference, stop loss calculation | Must be > 0, finite |
| **2. Monitor Positions** | `markPrice` | `Position.markPrice` from snapshot | Current PnL display | Already fetched (validated) |
| | `currentPrice` | `exchange.getTicker()` | Stop loss/take profit triggers, maintenance margin checks | Must be > 0, finite (strict validation) |
| | **Note**: For OKX, `currentPrice` is actually mark price | | | |
| **3. Fetch Market Data** | `tickerPrice` | `getTickerPrice()` → `snapshotService.getTicker()` | Signal generation context, caching | Only cache valid prices |
| **4. Generate Signals** | `entry_price` | AI signal (optional) | Limit Order price suggestion | Will be validated (stale price guard) |
| **5.1 Signal Validation** | `currentPrice` | Ticker Cache (via `getCachedPrice()`) | Validate price availability | Must be > 0, finite |
| **5.2 Position Sizing** | `currentPrice` | Ticker Cache | Position size calculation, risk calculation | Must be > 0, finite |
| | `entry_price` | `TradingSignal.entry_price` | Preferred entry price | Optional, will be validated |
| | `markPrice` | `Position.markPrice` | Existing position risk calculation | Already fetched from snapshot |
| **5.3 Order Execution** | `currentPrice` | Ticker Cache | Market Order reference price, stale price guard | Validated |
| | `entry_price` | Signal | Limit Order price (if reasonable) | Stale price guard checks deviation |
| **5.4 Result Processing** | `actualPrice` | `Order.price` | Slippage calculation, logging | May be 0/undefined (Market Order) → fallback to currentPrice |
| | `currentPrice` | Ticker Cache | Slippage calculation (expected price) | Validated |
| **5.5 Refresh Snapshot** | `markPrice` | `Position.markPrice` (updated) | Subsequent signal risk calculation | Already fetched from snapshot |
| | `entryPrice` | `Position.entryPrice` (new position) | Actual entry price | Already fetched from snapshot |

## Key Design Decisions

### 1. Why Use Mark Price for PnL Calculation?

**Rationale**:
- Derivative exchanges use Mark Price to calculate unrealized PnL, preventing price manipulation
- Mark Price is usually a weighted average from multiple sources (spot price, futures price, index price, etc.)
- Ensures PnL calculation consistency with exchange
- Prevents unfair liquidations due to price manipulation

**Implementation**:
- `OKXExchange.getTicker()` returns mark price (via `getMarkAndBestPrices()`)
- `OKXExchange.getMarkAndBestPrices()` prefers `ticker.info.markPx`, falls back to `last/close`
- `Position.markPrice` updated via:
  - `refreshMarks()` in PaperExchange (after order execution)
  - `getSnapshot()` / `getPositions()` (exchange returns updated markPrice)
  - Real-time updates from exchange position data

**Exchange Support**:
- **OKX**: Provides mark price via `ticker.info.markPx`
- **Binance/Coinbase/Hyperliquid**: Spot exchanges, use last/close price (not mark price)
- **Paper**: Delegates to underlying exchange (OKX provides mark price)

---

### 2. Why Use Current Price for Order Execution?

**Rationale**:
- Order Execution needs latest market price to:
  - Decide whether to use Limit Order (entry_price vs currentPrice)
  - Set Market Order reference price
  - Perform Stale Price Guard checks

**Implementation**:
- Fetch from Ticker Cache (avoid redundant API calls)
- If cache invalid or expired, re-fetch
- Strict validation (> 0, finite)

---

### 3. Why May Actual Price Fall Back to Current Price?

**Rationale**:
- Market Order's `order.price` may be 0 or undefined (exchange doesn't return it)
- Need actual price for slippage calculation and logging
- Use current price as best approximation

**Implementation**:
```typescript
const actualPrice = order.price && order.price > 0
  ? order.price          // Limit Order or Market Order (has price)
  : currentPrice;        // Market Order (no price) - fallback
```

---

### 4. Why Price Validation is Needed?

**Rationale**:
- Prevent using invalid prices (0, NaN, Infinity) for calculations
- Avoid causing incorrect position sizing, risk calculations, PnL calculations
- Improve system robustness

**Implementation**:
- `price-validation.ts` utility module for unified validation
- All price fetch points validated
- Invalid prices return `undefined` instead of 0

---

### 5. Why Snapshot Atomicity is Needed?

**Rationale**:
- Equity calculation depends on Balance and all positions' Unrealized PnL
- If account and positions fetched at different times, may cause inconsistency
- Example: Balance from time T1, Positions from time T2, Equity calculation may be inaccurate

**Implementation**:
- Prefer `exchange.getSnapshot()` (atomic snapshot)
- Otherwise fetch sequentially and warn
- Validate Equity = Balance + Σ(Unrealized PnL)

---

## Best Practices

### 1. Price Fetch Order
1. **Prefer Cache**: If cache valid and not expired, use cache
2. **Validate Price**: All prices must be validated before use (> 0, finite)
3. **Handle Failures**: If price fetch fails, return `undefined` and let caller decide how to handle

### 2. Price Type Selection
- **PnL Calculation**: Use `markPrice` (consistent with exchange)
- **Order Execution**: Use `currentPrice` (latest market price)
- **Risk Calculation**: Use `markPrice` (accurate position value)
- **Trigger Conditions**: Use `currentPrice` (real-time market price)

### 3. Error Handling
- Invalid price: Skip operation, log warning, don't return error result
- Price fetch failure: Use last valid price (if available), otherwise fail
- Snapshot inconsistency: Log warning, but continue execution (avoid complete failure)

### 4. Caching Strategy
- **Price Cache**: No explicit TTL, refreshed per cycle
  - Cache location: `tickerCache` Map in `executeCycle()`
  - Cache key: Symbol string
  - Cache value: `{ price: number, timestamp: number }`
  - Validation: Only cache valid prices (> 0, finite)
  - Refresh: On-demand when cache miss or invalid price
  
- **Kline Cache**: No explicit TTL, refreshed per cycle
  - Cache location: `klineCache` Map (for market summary API)
  - Cache key: `${symbol}_${timeframe}`
  - Cache value: `{ candle: Candlestick, ts: number }`
  - Used by: Market summary API routes
  
- **Cache Validation**: Check price validity before using cached value
  - Valid if: `price > 0 && isFinite(price) && (now - ts < implicit_ttl)`
  - If invalid: Remove from cache and fetch fresh

## Common Issues and Pitfalls

### 1. Mark Price vs Current Price Confusion
**Issue**: Using current price for PnL calculation, causing inconsistency with exchange
**Solution**: Always use `Position.markPrice` for PnL calculation

### 2. Price Fallback to 0
**Issue**: Returning 0 when price fetch fails, causing incorrect calculations
**Solution**: Return `undefined`, forcing caller to handle

### 3. Price Cache Expiration
**Issue**: Using expired cached prices
**Solution**: Validate cache TTL and price effectiveness before each use

### 4. Snapshot Inconsistency
**Issue**: Account and positions fetched at different times
**Solution**: Prefer atomic snapshot, otherwise fetch sequentially and warn

## Related Files

- `Quanta/src/core/workflow.ts` - Trading Cycle main flow
- `Quanta/src/core/exchange-snapshot.ts` - Snapshot service
- `Quanta/src/execution/orders.ts` - Order execution
- `Quanta/src/execution/risk.ts` - Risk calculation
- `Quanta/src/execution/monitor.ts` - Position monitoring
- `Quanta/src/utils/price-validation.ts` - Price validation utilities
- `Quanta/src/exchange/okx.ts` - OKX exchange implementation (mark price)
- `Quanta/src/exchange/paper.ts` - Paper exchange implementation

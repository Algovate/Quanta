# Trading Cycle Price Usage

This document details price types used in the Trading Cycle execution process.

## Overview

Trading Cycle execution flow:

1. Fetch account and position snapshots
2. Monitor existing positions
3. Fetch market data
4. Generate trading signals
5. Execute trading signals

Throughout the flow, different stages use different price types.

## Price Type Definitions

### 1. Mark Price

- **Definition**: Fair price used by exchanges to calculate unrealized PnL (especially important for derivatives)
- **Source**: `Position.markPrice`, obtained via `exchange.getSnapshot()` or `exchange.refreshMarks()`
- **Usage**: Calculate position unrealized PnL, account equity, risk checks, margin calculations

### 2. Current Price / Ticker Price

- **Definition**: Latest market price from exchange, typically from `getTicker()`
- **Source**: Price returned by `exchange.getTicker(symbol)`
  - **OKX**: Returns mark price (for derivatives PnL accuracy)
  - **Binance/Coinbase/Hyperliquid**: Returns last/close price (spot market price)
  - **Paper/Simulator**: Delegates to underlying exchange's `getTicker()`
- **Usage**: Signal validation, position sizing calculations, order execution decisions, slippage calculations

### 3. Entry Price

- **Definition**: Position opening price, or entry price specified in signal
- **Source**: `Position.entryPrice`, `TradingSignal.entry_price`, or actual order fill price
- **Usage**: Stop loss/take profit calculations, PnL percentage calculations, price reference for position sizing

### 4. Actual Price / Execution Price

- **Definition**: Actual fill price of the order
- **Source**: `Order.price` (Market Order may be 0, needs fallback to currentPrice)
- **Usage**: Slippage calculations, logging, performance analysis

### 5. Signal Entry Price

- **Definition**: Entry price suggested in AI signal (optional)
- **Source**: `TradingSignal.entry_price`
- **Usage**: Limit Order price setting, price reasonableness check (stale price guard)

## Trading Cycle Price Usage Flow

### Phase 1: Fetch Account and Position Snapshot

**Timing**: At cycle start

**Prices Used:**

- `Position.markPrice` - Mark price for each position
- `Position.entryPrice` - Entry price for each position

**Rationale:**

- Mark Price used to calculate account equity (Equity = Balance + Σ(Unrealized PnL))
- Entry Price used for subsequent stop loss/take profit calculations
- Snapshot ensures data consistency

### Phase 2: Monitor Existing Positions

**Timing**: After snapshot fetch, if positions exist

**Prices Used:**

- `Position.markPrice` - From snapshot (current PnL calculation)
- `currentPrice` - Via `exchange.getTicker(position.symbol)` (latest market price)

**Rationale:**

- **Mark Price**: Already fetched from snapshot, reflects current position state, used for risk assessment
- **Current Price**: Used for stop loss/take profit trigger decisions, maintenance margin checks

**Note**: For OKX, `getTicker()` returns mark price, so `currentPrice` here is actually mark price.

**Use Cases:**

1. **Maintenance Margin Check** - Uses `currentPrice` from `getTicker()` (latest market price)
2. **Stop Loss Check** - Uses `currentPrice` vs `position.entryPrice`
3. **Take Profit Check** - Uses `currentPrice` vs `position.entryPrice`
4. **TP1 Strategy** - Uses `currentPrice` vs `position.entryPrice` (calculate R-multiple, partial close)
5. **Breakeven Strategy** - Uses `currentPrice` vs `position.entryPrice` (adjust stop loss)
6. **Auto-Close Conditions** - Uses `currentPrice` + `position.markPrice`

### Phase 3: Fetch Market Data

**Timing**: After monitoring positions

**Prices Used:**

- `Ticker Price` - Fetched via `getTickerPrice()` and cached

**Rationale:**

- Provide price context for signal generation
- Cache prices to avoid redundant API calls
- Used for technical indicator calculations

### Phase 4: Generate Trading Signals

**Timing**: After fetching market data

**Prices Used:**

- Signal may contain `entry_price` (optional)
- AI generates suggestions based on market data

**Rationale:**

- Entry Price used for subsequent Limit Order price setting
- If signal contains entry_price, it will be used during execution (if reasonable)

**Notes:**

- Entry Price will be validated (stale price guard)
- If deviation from current price is too large, will be converted to Market Order

### Phase 5: Execute Signal

**Stage 5.1: Get Execution Price**

**Prices Used:**

- `currentPrice` - From ticker cache or real-time fetch

**Rationale:**

- Validate price availability (must be > 0, finite)
- Used for position sizing
- Used for order execution decisions

**Stage 5.2: Position Sizing**

**Prices Used:**

- `currentPrice` - Current market price (required, validated)
- `signal.entry_price` - Entry price from signal (optional)
- `Position.markPrice` - Mark price of existing positions (for risk calculation)

**Rationale:**

- **Current Price**: Used to calculate position size, risk amount calculation, stop loss distance calculation
- **Entry Price**: If signal provides entry_price, use it preferentially; otherwise use currentPrice as entry price

**Stage 5.3: Order Execution**

**Prices Used:**

- `currentPrice` - Passed to OrderExecutor (validated)
- `signal.entry_price` - For Limit Order price setting (if reasonable)

**Execution Logic:**

1. **Price Validation**: Validate current price before proceeding
2. **Decide Order Type and Price**: Use entry_price or currentPrice; stale price guard converts to Market Order if deviation > 5%
3. **Execute Order**: Market Order (`price = undefined`) or Limit Order (`price = signal.entry_price` or `currentPrice`)

**Stage 5.4: Execution Result Processing**

**Prices Used:**

- `actualPrice` - Actual order execution price
- `currentPrice` - Expected price (for slippage calculation)

**Rationale:**

- **Actual Price**: Actual fill price (for logging and performance analysis); if unavailable (Market Order), use currentPrice as approximation
- **Slippage Calculation**: Compare actual price vs expected price; if deviation > 5%, log warning

**Stage 5.5: Refresh Positions and Account**

**Timing**: After each signal execution success and after all signal executions complete

**Prices Used:**

- `Position.markPrice` - From snapshot (updated mark price)
- `Position.entryPrice` - Entry price of newly opened positions

**Rationale:**

- Ensure subsequent signals see latest position state
- Use updated markPrice for risk calculations
- Use actual entryPrice (may be execution price) instead of signal price

## Exchange-Specific getTicker() Behavior

| Exchange        | getTicker() Returns     | Price Type                      | Use Case                            |
| --------------- | ----------------------- | ------------------------------- | ----------------------------------- |
| **OKX**         | Mark Price              | `markPx` from ticker.info       | PnL calculation, position valuation |
| **Binance**     | Last/Close Price        | `ticker.last` or `ticker.close` | Spot market price                   |
| **Coinbase**    | Last/Close Price        | `ticker.last` or `ticker.close` | Spot market price                   |
| **Hyperliquid** | Last/Close Price        | `ticker.last` or `ticker.close` | Market price                        |
| **Paper**       | Delegates to underlying | Depends on wrapped exchange     | Same as underlying                  |
| **Simulator**   | From market data        | Historical/simulated price      | Simulation only                     |

**Important**: For derivatives trading (OKX), `getTicker()` returning mark price is intentional and correct for PnL calculations.

## Price Usage Summary Table

| Stage                     | Price Types Used                           | Source                                             | Purpose                                |
| ------------------------- | ------------------------------------------ | -------------------------------------------------- | -------------------------------------- |
| **1. Get Snapshot**       | `markPrice`, `entryPrice`                  | `Position.markPrice`, `Position.entryPrice`        | Calculate Equity, PnL                  |
| **2. Monitor Positions**  | `markPrice`, `currentPrice`                | Snapshot, `exchange.getTicker()`                   | Current PnL display, trigger decisions |
| **3. Fetch Market Data**  | `tickerPrice`                              | `getTickerPrice()` → `snapshotService.getTicker()` | Signal generation context              |
| **4. Generate Signals**   | `entry_price`                              | AI signal (optional)                               | Limit Order price suggestion           |
| **5.1 Signal Validation** | `currentPrice`                             | Ticker Cache                                       | Validate price availability            |
| **5.2 Position Sizing**   | `currentPrice`, `entry_price`, `markPrice` | Ticker Cache, Signal, Snapshot                     | Position size calculation              |
| **5.3 Order Execution**   | `currentPrice`, `entry_price`              | Ticker Cache, Signal                               | Market/Limit Order decision            |
| **5.4 Result Processing** | `actualPrice`, `currentPrice`              | `Order.price`, Ticker Cache                        | Slippage calculation, logging          |
| **5.5 Refresh Snapshot**  | `markPrice`, `entryPrice`                  | Snapshot (updated)                                 | Subsequent signal risk calculation     |

## Key Design Decisions

### 1. Why Use Mark Price for PnL Calculation?

**Rationale:**

- Derivative exchanges use Mark Price to calculate unrealized PnL, preventing price manipulation
- Mark Price is usually a weighted average from multiple sources
- Ensures PnL calculation consistency with exchange
- Prevents unfair liquidations due to price manipulation

**Implementation:**

- `OKXExchange.getTicker()` returns mark price (via `getMarkAndBestPrices()`)
- `Position.markPrice` updated via `refreshMarks()` or `getSnapshot()`

### 2. Why Use Current Price for Order Execution?

**Rationale:**

- Order Execution needs latest market price to:
  - Decide whether to use Limit Order (entry_price vs currentPrice)
  - Set Market Order reference price
  - Perform Stale Price Guard checks

**Implementation:**

- Fetch from Ticker Cache (avoid redundant API calls)
- If cache invalid or expired, re-fetch
- Strict validation (> 0, finite)

### 3. Why May Actual Price Fall Back to Current Price?

**Rationale:**

- Market Order's `order.price` may be 0 or undefined (exchange doesn't return it)
- Need actual price for slippage calculation and logging
- Use current price as best approximation

**Implementation:**

```typescript
const actualPrice =
  order.price && order.price > 0
    ? order.price // Limit Order or Market Order (has price)
    : currentPrice; // Market Order (no price) - fallback
```

### 4. Why Price Validation is Needed?

**Rationale:**

- Prevent using invalid prices (0, NaN, Infinity) for calculations
- Avoid causing incorrect position sizing, risk calculations, PnL calculations
- Improve system robustness

**Implementation:**

- All price fetch points validated
- Invalid prices return `undefined` instead of 0

### 5. Why Snapshot Atomicity is Needed?

**Rationale:**

- Equity calculation depends on Balance and all positions' Unrealized PnL
- If account and positions fetched at different times, may cause inconsistency
- Example: Balance from time T1, Positions from time T2, Equity calculation may be inaccurate

**Implementation:**

- Prefer `exchange.getSnapshot()` (atomic snapshot)
- Otherwise fetch sequentially and warn
- Validate Equity = Balance + Σ(Unrealized PnL)

## Best Practices

### 1. Price Fetch Order

1. **Prefer Cache**: If cache valid and not expired, use cache
2. **Validate Price**: All prices must be validated before use (> 0, finite)
3. **Handle Failures**: If price fetch fails, return `undefined` and let caller decide

### 2. Price Type Selection

- **PnL Calculation**: Use `markPrice` (consistent with exchange)
- **Order Execution**: Use `currentPrice` (latest market price)
- **Risk Calculation**: Use `markPrice` (accurate position value)
- **Trigger Conditions**: Use `currentPrice` (real-time market price)

### 3. Error Handling

- Invalid price: Skip operation, log warning, don't return error result
- Price fetch failure: Use last valid price (if available), otherwise fail
- Snapshot inconsistency: Log warning, but continue execution

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

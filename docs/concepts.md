# Core Concepts

Guide to key terms, concepts, and algorithms in Quanta.

## Architecture

### Three-Phase Trading System

```
Perception → Decision → Execution
  ↓          ↓          ↓
Market Data → AI Analysis → Risk Management + Orders
```

### Core Components

1. **Exchange Interface** - Unified API for multiple exchanges (Simulator, OKX, Binance, Coinbase, Hyperliquid)
2. **Market Data Provider** - Fetches candlestick data and calculates technical indicators
3. **AI Agent** - Generates trading signals with confidence scores
4. **Risk Manager** - Position sizing and risk validation
5. **Order Executor** - Order placement and execution management
6. **Position Monitor** - Tracks positions and P&L

## Trading Concepts

### Execution Mode vs Environment

**Execution Mode** (`mode`): How trading is executed

- `single`: Single trading workflow (default)
- `arena`: Multi-drone trading arena (strategy comparison)

**Environment** (`env`): Trading environment and data source

- `simulate`: Synthetic data, risk-free learning
- `paper`: Real market data, simulated execution
- `live`: Real trading with actual funds

### Order Types

**Long (Buy)**: Expect price to rise, buy, profit when price increases

**Short (Sell)**: Expect price to fall, sell, profit when price decreases

### Position Lifecycle

```
Open → Monitor → Close
  ↓      ↓        ↓
Signal  P&L Update  Stop Loss/Take Profit
```

### Partial Close Execution

Quanta supports partial position closes with intelligent batching:

**Multi-Level Take Profit Strategy:**

- **TP1**: Close 50% at 1R (risk-reward ratio of 1)
- **TP2**: Close 30% at 2R (of remaining position)
- **TP3**: Close 20% at 3R (of remaining position)

**Tiny Partial Batching:**

- Partial closes below minimum notional are accumulated
- When accumulated value reaches minimum, batched order is executed
- Prevents spam from tiny orders while ensuring execution
- Minimum notional: Max of configured value (default $5) and symbol metadata

**Error Handling:**

- `TINY_PARTIAL_ACCUMULATED`: Partial close too small, accumulating
- `BATCH_TOO_SMALL_AFTER_CLAMP`: Batched order still too small after rounding
- `VALIDATION_FAILED`: Order validation failed
- `EXECUTION_FAILED`: Order execution failed

## Profit & Loss Calculation

### Core Formulas

**Long Position:**

```typescript
PnL = (Current Price - Entry Price) × Position Size
```

**Short Position:**

```typescript
PnL = (Entry Price - Current Price) × Position Size
```

### Realized vs Unrealized P&L

- **Unrealized P&L**: Profit/loss in open positions (fluctuates with price)
- **Realized P&L**: Profit/loss locked when positions are closed (actual cash)

### Leverage and Margin

Leverage affects margin requirements, not PnL calculation:

```typescript
Margin = (Position Size × Price) / Leverage
```

### Account Equity

```typescript
Equity = Balance + Unrealized P&L;
Balance = Initial Capital + All Realized P&L;
Available Margin = Equity - Used Margin;
Margin Ratio = Used Margin / Equity;
```

## Technical Indicators

### Moving Averages

**EMA (Exponential Moving Average)**: More weight on recent prices  
Formula: `EMA = (Price × α) + (Previous EMA × (1 - α))`, α = 2 / (n + 1)

**SMA (Simple Moving Average)**: Arithmetic mean of last n closing prices

### MACD

**Components:**

- MACD Line: EMA(12) - EMA(26)
- Signal Line: EMA(9) of MACD line
- Histogram: MACD Line - Signal Line

**Signals:**

- Bullish: MACD crosses above signal line
- Bearish: MACD crosses below signal line

### RSI

**Calculation:**

- RSI = 100 - (100 / (1 + RS))
- RS = Average Gain / Average Loss
- Range: 0 to 100

**Interpretation:**

- Overbought: RSI > 70
- Oversold: RSI < 30
- Neutral: 30 < RSI < 70

### ATR

**Calculation:**

- True Range = Max(High - Low, |High - Previous Close|, |Low - Previous Close|)
- ATR = Average of True Range over n periods

**Use**: Volatility measurement, stop loss placement, position sizing

### Bollinger Bands

**Formula (n=20, k=2):**

- Middle Band = SMA(n)
- Standard Deviation = StdDev of last n closes
- Upper Band = Middle + k·StdDev
- Lower Band = Middle - k·StdDev

**Derived Indicators:**

- %B = (Close - Lower Band) / (Upper Band - Lower Band)
- Bandwidth = (Upper Band - Lower Band) / Middle Band

## Risk Management

### Position Sizing

**Core Principle**: Never risk more than you can afford to lose

**Position Sizing Formula:**

```
1. Risk-based position: Position Value = Risk Amount / Stop Loss Percentage
2. Capital-based position: Max 30% of available capital (40% reserved)
3. Minimum position: Max($200, 1% of account equity)
4. Final size = Max(risk-based, minimum), but not exceeding capital-based
```

**Example:**

- Account balance: $10,000
- Available capital: $6,000 (after reserve)
- Risk per trade: 5% = $500
- Stop loss: 3%
- Risk-based position value: $500 / 0.03 = $16,667
- Capital-based position value: $6,000 × 30% = $1,800
- Minimum position value: Max($200, $100) = $200
- Final position value: $1,800 (limited by capital)

### Stop Loss

**Types:**

- **Percentage**: 3% below entry price (default)
- **ATR-based**: 2×ATR below entry price
- **Fixed amount**: Max $500 loss

**Placement:**

- Long: Below entry price
- Short: Above entry price

### Take Profit

**Default**: 6% (2x stop loss)

**Strategies:**

- Fixed: 6% profit target
- Trailing: Adjusts with price movement
- Multi-level: Partial profit taking

### Risk Parameters

- **Max risk per trade**: 5% (configurable)
- **Total risk limit**: 30%
- **Max positions**: 5-6 concurrent positions
- **Confidence threshold**: 0.55 (55%)
- **Capital allocation**: Max 30% of available trading capital per position
- **Cash reserve**: 40% of available margin reserved

### Leverage

**Leverage Range**: Configurable based on market type

- **Spot market**: Leverage fixed at 1x (no leverage)
- **Contract/Perpetual market**: Range 3x to 10x (configurable, default 5x-40x but limited)

**How It Works:**

- 10x leverage: $1 controls $10
- Amplifies both gains and losses
- Example: 10% price move = 100% P&L (with 10x leverage)

**Market Type Limits:**

- **Spot** (`marketType: "spot"`): Leverage fixed at 1x - 1x (no leverage)
- **Contract/Perpetual** (`marketType: "swap"`): Leverage limited to 3x - 10x

## AI and Signals

### Trading Signals

**Signal Structure:**

```typescript
{
  action: "LONG" | "SHORT" | "HOLD",
  coin: "BTC",
  confidence: 0.75,  // 0-1
  reasoning: "Strong bullish momentum...",
  entry_price: 50000,
  position_size: 0.1,
  stop_loss: 48500,
  profit_target: 53000
}
```

### Signal Generation Flow

1. **Market Analysis** - Fetch multi-timeframe data, calculate indicators, analyze price action
2. **AI Decision** - Process market data, generate signals, assign confidence scores, provide reasoning
3. **Risk Validation** - Check position limits, validate stop loss, calculate position size
4. **Execution** - Place orders, set stop loss, set take profit, monitor positions

### Confidence Levels

- **High (0.7-1.0)**: Clear trends, strong indicators, high probability
- **Medium (0.4-0.7)**: Mixed signals, moderate indicators, balanced risk
- **Low (0.0-0.4)**: Weak signals, conflicting indicators, usually rejected

### AI Prompt Context

AI receives prompts from external prompt group configurations stored in `config/prompts/`. Each prompt group defines:

- **System Prompt**: Instructions, constraints, decision framework, output format requirements
- **User Prompt**: Dynamic market data, account information, position details

Active prompt group is specified via `ai.prompt.activeGroup` in configuration.

**System Prompt Variables:**  
`{{tradableCoins}}`, `{{maxPositions}}`, `{{maxRiskPerTrade}}`, `{{minLeverage}}`, `{{maxLeverage}}`, `{{defaultStopLoss}}`

**User Prompt Variables:**  
`{{elapsedMinutes}}`, `{{currentTime}}`, `{{invokeCount}}`, `{{candlesTA}}`, `{{accountInfo}}`, `{{positionsInfo}}`, `{{sentimentInfo}}`, `{{technicalState}}`

See [Configuration Guide](configuration.md#prompt-groups).

### Mock AI vs Real AI

- **Mock AI**: Predefined logic, fast execution, good for testing, no API key needed
- **Real AI**: Real-time market analysis, real AI reasoning, more realistic, requires API key

## Execution Flow

### Complete Trading Cycle

```
Timer (3 minutes)
    ↓
1. Market Data Fetch
   - Fetch candles
   - Calculate indicators
   - Analyze trends
    ↓
2. AI Signal Generation
   - Analyze market data
   - Generate signals
   - Confidence scoring
    ↓
3. Risk Validation
   - Check position limits
   - Validate stop loss
   - Calculate position size
    ↓
4. Order Execution
   - Place orders
   - Set stop loss
   - Set take profit
    ↓
5. Position Monitoring
   - Track P&L
   - Update marks
   - Check exit conditions
    ↓
6. Portfolio Update
   - Update risk exposure
   - Calculate leverage
   - Update metrics
```

### Exit Conditions

- **Stop Loss Trigger**: Price hits stop loss, position closes, loss realized
- **Take Profit Trigger**: Price hits target, position closes, profit realized
- **Manual Exit**: User intervention, force close, immediate exit

## Algorithms

### Position Sizing Algorithm

```typescript
function calculatePositionSize(
  signal: TradingSignal,
  account: Account,
  currentPrice: number
): PositionSizing {
  // Step 1: Calculate risk amount
  const riskAmount = account.equity * maxRiskPerTrade;

  // Step 2: Calculate risk-based position value
  const stopLoss = signal.stop_loss || 0.05;
  const riskBasedPositionValue = riskAmount / stopLoss;

  // Step 3: Calculate capital-based position value
  // Reserve 40% for additional positions
  const availableForTrade = account.availableMargin * 0.6;
  const maxCapitalBasedValue = availableForTrade * 0.3;

  // Step 4: Choose smaller value for safety
  const finalPositionValue = Math.min(maxCapitalBasedValue, riskBasedPositionValue);

  // Step 5: Apply minimum position size
  const minPositionValue = Math.max(200, account.equity * 0.01);
  const adjustedPositionValue = Math.max(minPositionValue, finalPositionValue);

  // Step 6: Convert to position units
  const pricePerUnit = signal.entry_price || currentPrice;
  const positionSize = adjustedPositionValue / pricePerUnit;

  return { coin: signal.coin, suggestedSize: positionSize, riskAmount, stopLossPrice: calculateStopLoss(...) };
}
```

### Risk Validation Algorithm

```typescript
function validateRisk(
  signal: TradingSignal,
  currentPositions: Position[],
  account: Account
): boolean {
  // Check signal format
  if (!signal.coin || !signal.action || !signal.confidence) return false;

  // Check confidence threshold
  if (signal.confidence < 0.55) return false;

  // Check max positions
  if (currentPositions.length >= maxPositions) return false;

  // Check existing positions
  const positionSymbol = `${signal.coin}/USDT`;
  const existingPosition = currentPositions.find(p => p.symbol === positionSymbol);
  if (existingPosition && (signal.action === 'LONG' || signal.action === 'SHORT')) return false;

  // Check total risk exposure
  const totalRisk = calculateTotalRisk(currentPositions, account);
  if (totalRisk >= maxTotalRisk) return false;

  // Check stop loss validity
  if (signal.stop_loss && (signal.stop_loss < 0.01 || signal.stop_loss > 0.1)) return false;

  return true;
}
```

### Stop Loss Calculation Algorithm

```typescript
function calculateStopLoss(
  action: 'LONG' | 'SHORT',
  entryPrice: number,
  stopLossPercentage: number,
  atr?: number
): number {
  if (atr) {
    // ATR-based stop loss (more dynamic)
    return action === 'LONG' ? entryPrice - atr * 2 : entryPrice + atr * 2;
  } else {
    // Percentage-based stop loss (simpler)
    return action === 'LONG'
      ? entryPrice * (1 - stopLossPercentage)
      : entryPrice * (1 + stopLossPercentage);
  }
}
```

## Glossary

- **Account Balance**: Total funds in exchange account
- **API Key**: Authentication key for exchange access
- **ATR**: Average True Range - volatility indicator
- **Backtest**: Test strategy on historical data
- **Candlestick**: Price action representation (open, high, low, close)
- **Confidence**: Signal reliability score (0-1)
- **Drawdown**: Decline from peak to trough
- **Environment** (`env`): Trading environment setting (`simulate`, `paper`, `live`)
- **Exchange**: Trading platform (Binance, OKX, Coinbase, Hyperliquid, Simulator)
- **Execution Mode** (`mode`): How trading is executed (`single`, `arena`)
- **Leverage**: Borrowing capacity (amplifies position size)
- **Long Position**: Bullish bet (buy at current price, profit when price rises)
- **Margin**: Collateral for leverage
- **P&L (Profit & Loss)**: Trading result (unrealized: in position, realized: closed)
- **Position**: Active trade (long or short, open or close)
- **Risk Management**: Loss prevention (position sizing, stop loss, diversification)
- **RSI**: Relative Strength Index - momentum indicator
- **Short Position**: Bearish bet (sell at current price, profit when price falls)
- **Signal**: Trading recommendation (AI-generated, action + confidence)
- **Stop Loss**: Loss limit (automatic exit, risk control)
- **Take Profit**: Profit target (automatic exit, lock profits)
- **Technical Indicator**: Price analysis tool (MACD, RSI, EMA, ATR)
- **Unrealized P&L**: Paper profit/loss (in position, fluctuates with price)

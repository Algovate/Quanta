# Core Concepts

Complete guide to key terms, concepts, and algorithms in Quanta.

## Architecture

### Three-Stage Trading System

```
Perception → Decision → Execution
    ↓           ↓          ↓
Market Data → AI Analysis → Risk Mgmt + Orders
```

### Key Components

1. **Exchange Interface** - Unified API for multiple exchanges (Simulator, OKX, Binance, Coinbase, Hyperliquid)
2. **Market Data Provider** - Fetches candlestick data and calculates technical indicators
3. **AI Agent** - Generates trading signals with confidence scoring
4. **Risk Manager** - Position sizing and risk validation
5. **Order Executor** - Places orders and manages executions
6. **Position Monitor** - Tracks open positions and P&L

## Trading Concepts

### Execution Mode vs Environment

**Execution Mode** (`mode`): How trading is executed

- `strategy`: Single trading workflow (default)
- `arena`: Multi-drone trading arena for strategy comparison

**Environment** (`env`): Trading environment and data source

- `simulate`: Mock data, risk-free learning
- `paper`: Real market data, simulated execution
- `live`: Real trading with actual capital

See [Trading Guide](trading-guide.md#trading-modes) for environment details.

### Order Types

**Long Position (Buy)**

- Expecting price to rise
- Buy at current price
- Profit when price increases
- Exit via take-profit or stop-loss

**Short Position (Sell)**

- Expecting price to fall
- Sell at current price
- Profit when price decreases
- Exit via take-profit or stop-loss

### Position Lifecycle

```
Entry → Monitoring → Exit
  ↓         ↓          ↓
Signal   P&L Update  Stop/Target
```

## PnL Calculation

### Core Formulas

**Long Positions:**

```typescript
PnL = (Current Price - Entry Price) × Position Size
```

**Short Positions:**

```typescript
PnL = (Entry Price - Current Price) × Position Size
```

### Realized vs Unrealized PnL

**Unrealized PnL**: Calculated for open positions

```typescript
Unrealized PnL = calculatePositionPnl(side, currentPrice, entryPrice, size)
```

**Realized PnL**: Locked in when position closes

```typescript
balance += realizedPnl;
availableMargin += marginUsed + realizedPnl;
```

### Leverage and Margin

Leverage affects margin requirement, not PnL calculation:

```typescript
Margin = (Position Size × Price) / Leverage
```

### Account Equity

```typescript
Equity = Balance + Unrealized PnL
Balance = Initial Capital + All Realized PnL
Available Margin = Equity - Used Margin
Margin Ratio = Used Margin / Equity
```

## Technical Indicators

### Moving Averages

**EMA (Exponential Moving Average)**

- Gives more weight to recent prices
- Formula: `EMA = (Price * α) + (Previous EMA * (1 - α))`
- α = 2 / (n + 1)
- Common: EMA 5/20/50

**SMA (Simple Moving Average)**

- Arithmetic mean of last n closes
- Common: SMA 5/20/50

### MACD (Moving Average Convergence Divergence)

**Components:**

- MACD Line: EMA(12) - EMA(26)
- Signal Line: EMA(9) of MACD Line
- Histogram: MACD Line - Signal Line

**Signals:**

- Bullish: MACD crosses above Signal Line
- Bearish: MACD crosses below Signal Line

### RSI (Relative Strength Index)

**Calculation:**

- RSI = 100 - (100 / (1 + RS))
- RS = Average Gain / Average Loss
- Range: 0 to 100

**Interpretation:**

- Overbought: RSI > 70
- Oversold: RSI < 30
- Neutral: 30 < RSI < 70

### ATR (Average True Range)

**Calculation:**

- True Range = Max of:
  - Current High - Current Low
  - |Current High - Previous Close|
  - |Current Low - Previous Close|
- ATR = Average of True Range over n periods

**Usage:** Volatility measurement, stop-loss placement, position sizing

### Bollinger Bands

**Formula (n=20, k=2):**

- middle = SMA(n)
- std = standard deviation of last n closes
- upper = middle + k·std
- lower = middle − k·std

**Derived metrics:**

- %B = (close − lower) / (upper − lower)
- Bandwidth = (upper − lower) / middle

## Risk Management

### Position Sizing

**Key Principle**: Never risk more than you can afford to lose

**Position Sizing Formula:**

```
1. Risk-based sizing: Position Value = Risk Amount / Stop Loss %
2. Capital-based sizing: Max 30% of 60% available capital (40% reserve)
3. Minimum position: Max($200, 1% of account equity)
4. Final size = Max of risk-based and minimum, capped at capital-based
```

**Example:**

- Account Balance: $10,000
- Available Capital: $6,000 (after reserve)
- Risk per Trade: 5% = $500
- Stop Loss: 3%
- Risk-Based Value: $500 / 0.03 = $16,667
- Capital-Based Value: $6,000 × 30% = $1,800
- Minimum Value: Max($200, $100) = $200
- Final Position Value: $1,800 (capped at capital)

### Stop Loss

**Types:**

- **Percentage**: 3% below entry (default)
- **ATR-based**: 2x ATR below entry
- **Fixed Dollar**: $500 maximum loss

**Placement:**

- Long positions: Below entry
- Short positions: Above entry

### Take Profit

**Default**: 6% (2x stop-loss)

**Strategies:**

- Fixed: 6% profit target
- Trailing: Adjusts with price movement
- Multiple levels: Take partial profits

### Risk Parameters

- **Max Risk per Trade**: 5% (configurable)
- **Max Total Risk**: 30%
- **Max Positions**: 5-6 concurrent positions
- **Confidence Threshold**: 0.55 (55%)
- **Capital Allocation**: Max 30% of available trading capital per position
- **Cash Reserve**: Maintains 40% of available margin as reserve

### Leverage

**Leverage Range**: Configurable based on market type

- **Spot Market**: Leverage clamped to 1x (no leverage)
- **Swap/Perpetual Market**: Range 3x to 10x (configurable, defaults 5x-40x but clamped)

**How it Works:**

- 10x leverage: $1 can control $10
- Amplifies both gains and losses
- Example: 10% price move = 100% gain/loss (with 10x leverage)

**Market Type Restrictions:**

- **Spot** (`marketType: "spot"`): Leverage clamped to 1x - 1x (no leverage)
- **Swap/Perp** (`marketType: "swap"`): Leverage clamped to 3x - 10x

**Safety Guidelines:**

- Start low (5x for perps, 1x for spot)
- Increase gradually
- Never max leverage on all positions
- Understand liquidation risks with leverage

## AI & Signals

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

### Signal Generation Process

1. **Market Analysis** - Fetch multi-timeframe data, calculate indicators, analyze price action
2. **AI Decision** - Process market data, generate signal, assign confidence score, provide reasoning
3. **Risk Validation** - Check position limits, validate stop-loss, calculate position size
4. **Execution** - Place order, set stop-loss, set take-profit, monitor position

### Confidence Levels

- **High (0.7-1.0)**: Clear trend, strong indicators, high probability
- **Medium (0.4-0.7)**: Mixed signals, moderate indicators, balanced risk
- **Low (0.0-0.4)**: Weak signals, conflicting indicators, ⚠️ Usually rejected

### AI Prompt Context

The AI receives prompts from externalized prompt group configurations stored in `config/prompts/`. Each prompt group defines:

- **System Prompt**: Instructions, constraints, decision frameworks, output format requirements
- **User Prompt**: Dynamic market data, account information, position details

The active prompt group is specified via `ai.prompt.activeGroup` in the configuration.

**System Prompt Variables:**

- `{{tradableCoins}}`, `{{maxPositions}}`, `{{maxRiskPerTrade}}`, `{{minLeverage}}`, `{{maxLeverage}}`, `{{defaultStopLoss}}`

**User Prompt Variables:**

- `{{elapsedMinutes}}`, `{{currentTime}}`, `{{invokeCount}}`, `{{candlesTA}}`, `{{accountInfo}}`, `{{positionsInfo}}`, `{{sentimentInfo}}`, `{{technicalState}}`

**User Prompt Sections (Configurable):**

- **Candles & Technical Analysis** (`sections.candlesTA`): Multi-timeframe candles, indicators (EMA20/50, MACD, RSI14, ATR14, Bollinger, Volume)
- **Market Sentiment (Derived)** (`sections.sentiment`): Derived from indicators, outputs sentiment (bullish/bearish/neutral) with score
- **Current Technical State (Summary)** (`sections.technicalState`): One-line summary

See [Configuration Guide](configuration.md#prompt-groups) for details.

### Mock AI vs Real AI

**Mock AI**: Predefined logic, fast execution, good for testing, no API key required

**Real AI**: Live market analysis, actual AI reasoning, more realistic, requires API key

## Execution Flow

### Complete Trading Cycle

```
Timer (3 minutes)
    ↓
1. MARKET DATA FETCHING
   - Fetch candlesticks
   - Calculate indicators
   - Analyze trends
    ↓
2. AI SIGNAL GENERATION
   - Analyze market data
   - Generate signals
   - Confidence scoring
    ↓
3. RISK VALIDATION
   - Check position limits
   - Validate stop-loss
   - Calculate position size
    ↓
4. ORDER EXECUTION
   - Place order
   - Set stop-loss
   - Set take-profit
    ↓
5. POSITION MONITORING
   - Track P&L
   - Update marks
   - Check exit conditions
    ↓
6. PORTFOLIO UPDATE
   - Update exposure
   - Calculate leverage
   - Update metrics
```

### Exit Conditions

**Stop Loss Trigger**: Price hits stop-loss, position closed, loss realized

**Take Profit Trigger**: Price hits target, position closed, profit realized

**Manual Exit**: User intervention, force close position, immediate exit

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
  // 40% reserve for additional positions
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

  // Check existing position
  const positionSymbol = `${signal.coin}/USDT`;
  const existingPosition = currentPositions.find(p => p.symbol === positionSymbol);
  if (existingPosition && (signal.action === 'LONG' || signal.action === 'SHORT')) return false;

  // Check total exposure
  const totalRisk = calculateTotalRisk(currentPositions, account);
  if (totalRisk >= maxTotalRisk) return false;

  // Check stop-loss validity
  if (signal.stop_loss && (signal.stop_loss < 0.01 || signal.stop_loss > 0.1)) return false;

  return true;
}
```

### Stop-Loss Calculation Algorithm

```typescript
function calculateStopLoss(
  action: 'LONG' | 'SHORT',
  entryPrice: number,
  stopLossPercentage: number,
  atr?: number
): number {
  if (atr) {
    // ATR-based stop-loss (more dynamic)
    return action === 'LONG' ? entryPrice - atr * 2 : entryPrice + atr * 2;
  } else {
    // Percentage-based stop-loss (simpler)
    return action === 'LONG'
      ? entryPrice * (1 - stopLossPercentage)
      : entryPrice * (1 + stopLossPercentage);
  }
}
```

## Glossary

### Key Terms

- **Account Balance**: Total funds in exchange account
- **API Key**: Authentication key for exchange access
- **ATR**: Average True Range - volatility indicator
- **Backtesting**: Testing strategies on historical data
- **Candlestick**: Price action representation (Open, High, Low, Close)
- **Confidence**: Signal reliability score (0-1)
- **Drawdown**: Peak-to-trough decline
- **Environment** (`env`): Trading environment setting (`simulate`, `paper`, `live`)
- **Exchange**: Trading platform (Binance, OKX, Coinbase, Hyperliquid, Simulator)
- **Execution Mode** (`mode`): How trading is executed (`strategy`, `arena`)
- **Leverage**: Borrowing capacity (amplifies position size)
- **Long Position**: Bullish bet (buy at current price, profit when price rises)
- **Margin**: Collateral for leverage
- **P&L (Profit & Loss)**: Trading results (unrealized: open positions, realized: closed positions)
- **Position**: Active trade (long or short, open or closed)
- **Risk Management**: Loss prevention (position sizing, stop-loss, diversification)
- **RSI**: Relative Strength Index - momentum indicator
- **Short Position**: Bearish bet (sell at current price, profit when price falls)
- **Signal**: Trading recommendation (AI-generated, action + confidence)
- **Stop Loss**: Loss limit (automatic exit, risk control)
- **Take Profit**: Profit target (automatic exit, secure profits)
- **Technical Indicator**: Price analysis tool (MACD, RSI, EMA, ATR)
- **Unrealized P&L**: Paper profit/loss (open positions, fluctuates with price)

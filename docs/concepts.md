# Core Concepts and Terminology

Complete guide to key terms, concepts, and algorithms in Quanta.

## Table of Contents

- [Architecture](#architecture)
- [Trading Concepts](#trading-concepts)
  - [Terminology](#terminology)
  - [Trading Environments](#trading-environments)
- [PnL Calculation](#pnl-calculation)
- [Technical Indicators](#technical-indicators)
- [Risk Management](#risk-management)
- [AI & Signals](#ai--signals)
- [Execution Flow](#execution-flow)
- [Glossary](#glossary)

---

## Architecture

### Three-Stage Trading System

```
Perception → Decision → Execution
    ↓           ↓          ↓
Market Data → AI Analysis → Risk Mgmt + Orders
```

### Key Components

**1. Exchange Interface**

- Abstract interface for multiple exchanges
- Unified API for trading operations
- Supported: Simulator, OKX, Binance, Coinbase, Hyperliquid
- All exchanges support abbreviations: bin (binance), cb (coinbase), hliq (hyperliquid)

**2. Market Data Provider**

- Fetches candlestick data
- Calculates technical indicators
- Multi-timeframe analysis

**3. AI Agent**

- Generates trading signals
- Analyzes market conditions
- Confidence scoring

**4. Risk Manager**

- Position sizing
- Risk validation
- Stop-loss/take-profit calculation

**5. Order Executor**

- Places orders
- Manages executions
- Handles fill logic

**6. Position Monitor**

- Tracks open positions
- Updates P&L
- Triggers exit conditions

---

## Trading Concepts

### Terminology

**Important**: Quanta uses two distinct concepts:

- **Execution Mode** (`mode`): How trading is executed
  - `strategy`: Single trading workflow (default)
  - `arena`: Multi-drone trading arena for strategy comparison

- **Environment** (`env`): Trading environment and data source
  - `simulate`: Mock data, risk-free learning
  - `paper`: Real market data, simulated execution
  - `live`: Real trading with actual capital

This section covers **Trading Environments**. For execution modes, see [Arena Guide](arena-guide.md).

### Trading Environments

Quanta supports three distinct trading environments, each serving different purposes in the development and deployment of trading strategies.

#### **1. Simulation Environment (Mock Data)**

**Purpose**: Learning and initial testing with synthetic data

**How it Works:**

- Uses internal mock exchange (`simulator`) that generates synthetic market data
- Perfect risk-free environment for understanding system mechanics
- Can use either Mock AI (predefined logic) or Real AI (requires API key)
- No real money involved whatsoever
- No external API dependencies

**Use Cases:**

- Learning how the system works
- Testing new features and modifications
- Understanding trading algorithms and risk management
- Initial AI prompt engineering and testing

**Configuration:**

```bash
# Command line
quanta trade start --env simulate --coins BTC,ETH,SOL

# Or in config.json
{
  "env": "simulate",
  "exchange": {
    "name": "simulator"
  }
}
```

**Technical Details:**

- Mock exchange generates realistic-looking candlestick data
- Simulates order fills instantaneously
- No network latency concerns
- Perfect for reproducible testing scenarios

#### **2. Paper Trading Environment (Real Data, Simulated Execution)**

**Purpose**: Strategy validation with real market conditions without financial risk

**How it Works:**

- Fetches **real market data** from actual exchanges (OKX, Binance, Coinbase, Hyperliquid)
- Simulates order execution and position management
- Tracks realistic P&L based on live price movements
- Uses real market volatility, trends, and patterns
- No actual orders sent to exchanges

**Use Cases:**

- Validating strategies with real market conditions
- Testing AI performance on live data
- Understanding how strategies perform in volatile markets
- Refining risk parameters before going live
- Backtesting recent market conditions

**Configuration:**

```bash
# Command line
quanta trade start --env paper --coins BTC,ETH,SOL

# Or in config.json
{
  "env": "paper",
  "exchange": {
    "name": "okx",  # or "binance", "coinbase", etc.
    "testnet": true  # Optional: use testnet for some exchanges
  }
}
```

**Technical Details:**

- **API Keys Optional**: Can fetch public market data without credentials
- **Real Data Sources**: Uses live order books, candlesticks, and market depth
- **Simulated Execution**: Orders are simulated, not actually placed
- **Realistic Execution**: Accounts for slippage, partial fills, and market impact
- **Exchange Support**: Works with OKX, Binance, Coinbase, Hyperliquid, or Simulator

**Key Benefits:**

- Test with real market volatility and conditions
- Identify potential issues before risking capital
- Validate AI model performance on live markets
- Build confidence in strategy effectiveness

#### **3. Live Environment (Real Trading)**

**Purpose**: Execute real trades with actual capital

**How it Works:**

- Connects to **real exchange accounts**
- Places **real orders** on live markets
- Uses **real money** at risk
- Executes actual trades at market prices
- Requires valid API keys with trading permissions

**Use Cases:**

- Production trading with proven strategies
- Live performance on real markets
- Generating actual profits/losses

**Configuration:**

```bash
# Command line
quanta trade start --env live --coins BTC

# Required in config.json
{
  "env": "live",
  "exchange": {
    "name": "okx",  # or binance, coinbase, hyperliquid
    "apiKey": "your_real_api_key",
    "apiSecret": "your_real_api_secret",
    "testnet": false  # MUST be false for live trading
  }
}
```

**Requirements:**

- Valid API keys with trading permissions
- Proper risk management configuration
- Thorough testing in simulation and paper trading first
- Understanding of leverage, margin, and liquidation risks
- Regular monitoring and position management

**⚠️ Critical Warnings:**

- **Real money is at risk** - losses are permanent
- Always test in simulation/paper mode first
- Start with small position sizes
- Monitor positions actively
- Understand exchange fee structures
- Be aware of slippage and execution quality
- Know how to stop trading immediately if needed (`Ctrl+C` or `quanta trade stop --force`)

**Technical Details:**

- Requires full API permissions (read + trade)
- Real order placement with immediate market execution
- Live balance updates and margin tracking
- Real fees, slippage, and execution quality
- Network latency affects performance
- Must handle exchange-specific API quirks

### Environment Comparison

| Feature               | Simulation | Paper        | Live       |
| --------------------- | ---------- | ------------ | ---------- |
| **Market Data**       | Mock       | Real         | Real       |
| **Order Execution**   | Simulated  | Simulated    | Real       |
| **Money at Risk**     | None       | None         | Real       |
| **API Keys Required** | No         | Optional     | Yes        |
| **Best For**          | Learning   | Testing      | Production |
| **Risk Level**        | None       | None         | High       |
| **Data Quality**      | Synthetic  | Real         | Real       |
| **Execution Speed**   | Instant    | Near-instant | Real-time  |
| **Fees**              | None       | Simulated    | Real       |
| **Slippage**          | None       | Simulated    | Real       |

### Recommended Workflow

```
1. Simulation Environment (Understand the system)
   ↓
2. Paper Trading Environment (Validate strategy with real data)
   ↓
3. Small-scale Live Testing (Real trading with minimal risk)
   ↓
4. Full Production (Scale up after proven)
```

### Switching Between Environments

Quanta allows easy switching between environments through command-line flags or configuration files:

```bash
# Switch to simulation environment
quanta trade start --env simulate

# Switch to paper trading environment
quanta trade start --env paper

# Switch to live environment (requires proper config)
quanta trade start --env live --coins BTC
```

All environments share the same risk management and AI logic, ensuring consistency across different data sources and execution methods.

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

---

## PnL Calculation

### Core Formulas

Quanta uses consistent PnL calculations across all exchanges:

#### Long Positions

```typescript
PnL = (Current Price - Entry Price) × Position Size
```

**Example:**

- Entry: 10 BTC @ $40,000
- Current: $41,000
- PnL: (41,000 - 40,000) × 10 = **$10,000** ✅

#### Short Positions

```typescript
PnL = (Entry Price - Current Price) × Position Size
```

**Example:**

- Entry: 10 BTC @ $40,000
- Current: $39,000
- PnL: (40,000 - 39,000) × 10 = **$10,000** ✅

### Realized vs Unrealized PnL

**Unrealized PnL**: Calculated for open positions

```typescript
Unrealized PnL = calculatePositionPnl(side, currentPrice, entryPrice, size)
```

**Realized PnL**: Locked in when position closes

```typescript
// On position close:
balance += realizedPnl;
availableMargin += marginUsed + realizedPnl;
```

### Leverage and Margin

Leverage affects margin requirement, not PnL calculation:

```typescript
// Margin calculation with leverage
Margin = (Position Size × Price) / Leverage

// Example with 10x leverage
Position: 10 BTC @ $40,000 = $400,000 notional
Margin: $400,000 / 10 = $40,000
```

### Account Equity

Equity includes both realized and unrealized PnL:

```typescript
Equity = Balance + Unrealized PnL
Balance = Initial Capital + All Realized PnL

Available Margin = Equity - Used Margin
Margin Ratio = Used Margin / Equity
```

### Trade Recording

All completed trades are tracked with full details:

**Completed Trade Object:**

```typescript
{
  id: string,
  symbol: string,
  side: 'long' | 'short',
  entryTime: number,
  exitTime: number,
  entryPrice: number,
  exitPrice: number,
  size: number,
  pnl: number,
  pnlPercent: number,
  holdingPeriod: number,
  reason: 'signal' | 'stop_loss' | 'take_profit' | 'end_of_backtest'
}
```

### Implementation

**PnL Functions:**

- `calculatePositionPnl()` - Core PnL calculation
- `calculateUnrealizedPnl()` - For open positions
- `calculatePnlPercent()` - Percentage return

**Location:** `src/utils/symbol-utils.ts`, `src/execution/position-utils.ts`

**Key Points:**

- ✅ Mathematically correct formulas
- ✅ Handles both long and short positions
- ✅ Accounts for leverage in margin calculations
- ✅ Tracks all trades for performance analysis
- ✅ Real-time unrealized PnL updates
- ✅ Proper account balance accounting

---

## Technical Indicators

### Moving Averages

**EMA (Exponential Moving Average)**

- Gives more weight to recent prices
- Formula: `EMA = (Price * α) + (Previous EMA * (1 - α))`
- α = 2 / (n + 1)
- Used to identify trends

**Common Timeframes:**

- EMA 20: Short-term trend
- EMA 50: Medium-term trend
- EMA 200: Long-term trend

**SMA (Simple Moving Average)**

- Arithmetic mean of last n closes
- Smoother, slower to react vs EMA
- Common: SMA 5/20/50 for micro/short/medium trend context

**In Quanta:**

- Calculates EMA 5/20/50 and SMA 5/20/50

### MACD (Moving Average Convergence Divergence)

**Components:**

- MACD Line: EMA(12) - EMA(26)
- Signal Line: EMA(9) of MACD Line
- Histogram: MACD Line - Signal Line

**Signals:**

- Bullish: MACD crosses above Signal Line
- Bearish: MACD crosses below Signal Line
- Momentum: Divergence between price and MACD

### RSI (Relative Strength Index)

**Calculation:**

- RSI = 100 - (100 / (1 + RS))
- RS = Average Gain / Average Loss
- Ranges from 0 to 100

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

**Usage:**

- Volatility measurement
- Stop-loss placement
- Position sizing

### Bollinger Bands

Formula (n=20, k=2):

- middle = SMA(n)
- std = standard deviation of last n closes
- upper = middle + k·std
- lower = middle − k·std

Derived metrics:

- %B = (close − lower) / (upper − lower)
- Bandwidth = (upper − lower) / middle
- Position: above | upper | middle | lower | below

Usage:

- Volatility envelopes, mean reversion vs breakout context

### Support/Resistance (Pivots)

- Detect recent swing highs/lows in a small lookback window (e.g., 5)
- Report nearest support/resistance and distances to current price

### Volume Analysis

- Volume SMA20: average of last 20 volumes
- Volume ratio: current volume / volSMA20 (spike detection)
- OBV (optional): cumulative signed volume by close-to-close change

---

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
- BTC Entry Price: $50,000
- BTC Position Size: $1,800 / $50,000 = 0.036 BTC

**Optimization Features:**

- **Dynamic Minimum**: Scales with account size (1% of equity or $200 minimum)
- **Capital Reserve**: Maintains 40% cash reserve for additional positions
- **Capital Allocation**: Uses 30% of available trading capital per position
- **Risk Consistency**: Ensures meaningful position sizes even during drawdowns

### Stop Loss

**Purpose**: Limit potential losses

**Types:**

- **Percentage**: 3% below entry (default)
- **ATR-based**: 2x ATR below entry
- **Fixed Dollar**: $500 maximum loss

**Placement:**

- Long positions: Below entry
- Short positions: Above entry

### Take Profit

**Purpose**: Secure profits

**Default**: 6% (2x stop-loss)

**Strategies:**

- Fixed: 6% profit target
- Trailing: Adjusts with price movement
- Multiple levels: Take partial profits

### Risk Parameters

**Max Risk per Trade**: 5% (configurable)

- Protects against single bad trade
- Calculated as equity × 5%

**Max Total Risk**: 30%

- Limits total portfolio exposure
- Prevents over-leveraging

**Max Positions**: 5-6 concurrent positions

- Prevents over-diversification
- Maintains manageable portfolio
- Enables 2-3 meaningful positions

**Confidence Threshold**: 0.55 (55%)

- Minimum signal confidence to execute
- Optimized from 0.60 for more trading opportunities
- Filters weak signals while allowing valid trades

**Capital Allocation**:

- **Per Position**: Max 30% of available trading capital
- **Cash Reserve**: Maintains 40% of available margin as reserve
- **Available Capital**: 60% of available margin for trading
- **Total Exposure**: Max 60% of account equity

### Leverage

**Leverage Range**: Configurable based on market type

- **Spot Market**: Leverage clamped to 1x (no leverage allowed)
- **Swap/Perpetual Market**: Range 3x to 10x (configurable, defaults 5x-40x but clamped)

**How it Works:**

- 10x leverage: $1 can control $10
- Amplifies both gains and losses
- Example: 10% price move = 100% gain/loss (with 10x leverage)

**Market Type Restrictions:**

The system automatically validates and adjusts leverage based on `exchange.marketType`:

- **Spot** (`marketType: "spot"`): Leverage clamped to 1x - 1x (no leverage)
- **Swap/Perp** (`marketType: "swap"`, "perp", or "perpetual"): Leverage clamped to 3x - 10x

**Safety Guidelines:**

- Start low (5x for perps, 1x for spot)
- Increase gradually
- Never max leverage on all positions
- Understand liquidation risks with leverage

---

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

1. **Market Analysis**
   - Fetch multi-timeframe data
   - Calculate indicators
   - Analyze price action

2. **AI Decision**
   - Process market data (with configurable prompt sections)
   - Generate signal
   - Assign confidence score
   - Provide reasoning

3. **Risk Validation**
   - Check position limits
   - Validate stop-loss
   - Check portfolio exposure

4. **Execution**
   - Place order
   - Set stop-loss
   - Set take-profit
   - Monitor position

### Confidence Levels

### AI Prompt Context (Configurable)

The AI receives prompts from externalized prompt group configurations stored in `config/prompts/`. Each prompt group defines:

- **System Prompt**: Instructions, constraints, decision frameworks, and output format requirements
- **User Prompt**: Dynamic market data, account information, and position details

The active prompt group is specified via `ai.prompt.activeGroup` in the configuration.

**Prompt Group Structure:**

Prompt groups use Mustache-style template variables (e.g., `{{variableName}}`) that are replaced at runtime with actual values.

**System Prompt Variables:**

- `{{tradableCoins}}`: Comma-separated list of tradable coins
- `{{maxPositions}}`: Maximum concurrent positions
- `{{maxRiskPerTrade}}`: Maximum risk per trade (%)
- `{{minLeverage}}` / `{{maxLeverage}}`: Leverage range
- `{{defaultStopLoss}}`: Default stop loss (%)

**User Prompt Variables:**

- `{{elapsedMinutes}}`: Runtime in minutes
- `{{currentTime}}`: Current timestamp (ISO)
- `{{invokeCount}}`: Number of AI invocations
- `{{candlesTA}}`: Formatted candles & technical analysis (configurable)
- `{{accountInfo}}`: Account information and performance
- `{{positionsInfo}}`: Current positions and performance
- `{{sentimentInfo}}`: Derived market sentiment (configurable)
- `{{technicalState}}`: Technical state summary (configurable)

**User Prompt Sections (Configurable):**

The user prompt includes optional sections that can be enabled/disabled via `ai.prompt.sections`:

- **Candles & Technical Analysis** (`sections.candlesTA`)
  - Multi-timeframe candles: 3m (default last 10), 1h (default last 8), and 4h (default last 5)
  - Indicators: EMA20/50, MACD, RSI14, ATR14, Bollinger (if available), Volume metrics

- **Market Sentiment (Derived)** (`sections.sentiment`)
  - Derived from EMA alignment, MACD vs Signal, RSI14 zones, Bollinger %B, overall trend
  - Outputs sentiment (bullish/bearish/neutral) with score and drivers

- **Current Technical State (Summary)** (`sections.technicalState`)
  - One-line summary: trend | EMA alignment | MACD relation | RSI zone | volatility

**Configuration:**

```json
{
  "ai": {
    "prompt": {
      "activeGroup": "default",
      "candles": {
        "m3": 10,
        "h1": 8,
        "h4": 5
      },
      "sections": {
        "candlesTA": true,
        "sentiment": true,
        "technicalState": true
      }
    }
  }
}
```

**Environment Variables:**

```bash
PROMPT_ACTIVE_GROUP=default
PROMPT_CANDLES_3M=10
PROMPT_CANDLES_1H=8
PROMPT_CANDLES_4H=5
PROMPT_SECTIONS_CANDLES_TA=true
PROMPT_SECTIONS_SENTIMENT=true
PROMPT_SECTIONS_TECH_STATE=true
```

See `config/prompts/README.md` for details on creating custom prompt groups.

**Viewing Prompts:**

You can view prompts using the CLI command:

```bash
# View current active prompt group
quanta prompts view

# View rendered prompts with example values
quanta prompts view --rendered

# List all available prompt groups
quanta prompts view --list
```

See [Command Reference](commands.md#prompt-commands) for complete documentation.

**High (0.7-1.0)**

- Clear trend
- Strong indicators
- High probability

**Medium (0.4-0.7)**

- Mixed signals
- Moderate indicators
- Balanced risk

**Low (0.0-0.4)**

- Weak signals
- Conflicting indicators
- ⚠️ Usually rejected

### Mock AI vs Real AI

**Mock AI**

- Predefined logic
- Fast execution
- Good for testing
- No API key required

**Real AI**

- Live market analysis
- Actual AI reasoning
- More realistic
- Requires API key

---

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

### Order Execution Process

**1. Signal Received**

- Action (LONG/SHORT)
- Entry price
- Position size
- Stop-loss
- Take-profit

**2. Risk Check**

- Max positions check
- Position size validation
- Stop-loss validation

**3. Order Placement**

- Market or Limit order
- Order sent to exchange
- Await confirmation

**4. Fill Handling**

- Order filled
- Update position
- Activate stop-loss
- Activate take-profit

**5. Monitoring**

- Track P&L
- Check exit conditions
- Update every cycle

### Exit Conditions

**Stop Loss Trigger**

- Price hits stop-loss
- Position closed
- Loss realized

**Take Profit Trigger**

- Price hits target
- Position closed
- Profit realized

**Manual Exit**

- User intervention
- Force close position
- Immediate exit

---

## Glossary

### A

**Account Balance**: Total funds in exchange account

- Available: Funds ready for trading
- Used: Funds locked in positions

**API Key**: Authentication key for exchange access

- Secure credentials
- Required for live trading
- Optional for paper trading (public market data)
- Store securely

**ATR**: Average True Range

- Volatility indicator
- Used for stop-loss placement
- Calculated from True Range (high-low, high-close, low-close)

### B

**Backtesting**: Testing strategies on historical data

- Validate strategies
- Estimate performance
- Test before live trading

**Bear Market**: Declining price trend

- Prices falling
- Short opportunities
- Defensive positioning

**Bull Market**: Rising price trend

- Prices rising
- Long opportunities
- Aggressive positioning

### C

**Candlestick**: Price action representation

- Open, High, Low, Close
- Visual price data
- Time-based intervals

**Confidence**: Signal reliability score

- Range: 0-1
- Higher = better
- Used for filtering

### D

**Diversification**: Spreading risk across assets

- Multiple coins
- Multiple positions
- Risk reduction

**Drawdown**: Peak-to-trough decline

- Maximum loss period
- Risk metric
- Monitor closely

### E

**Environment** (`env`): Trading environment setting

- `simulate`: Mock data, risk-free learning
- `paper`: Real market data, simulated execution
- `live`: Real trading with actual capital
- See [Trading Environments](#trading-environments) for details

**Entry Price**: Position opening price

- Long: Buy price
- Short: Sell price
- Recorded for P&L
- May be actual fill price or signal entry price

**Exchange**: Trading platform

- E.g., Binance, OKX, Coinbase, Hyperliquid, Simulator
- Order execution
- Balance management
- Market data provider

**Execution Mode** (`mode`): How trading is executed

- `strategy`: Single trading workflow (default)
- `arena`: Multi-drone trading arena for strategy comparison
- See [Arena Guide](arena-guide.md) for details

**Exit Price**: Position closing price

- Long: Sell price
- Short: Buy price
- Realized P&L calculated from entry price

### F

**Fill**: Order completion

- Buy order: Bought
- Sell order: Sold
- Position opened

### H

**Hold**: No trading action

- AI decision
- Waiting for opportunity
- Conservative approach

### L

**Leverage**: Borrowing capacity

- Amplifies position size
- E.g., 10x = $1 controls $10
- Increases risk

**Long Position**: Bullish bet

- Buy at current price
- Profit when price rises
- Stop-loss below

### M

**Margin**: Collateral for leverage

- Locked funds
- Required for positions
- Limits available balance

**Market Data**: Price information

- Candlesticks
- Volume
- Indicators

### O

**Order**: Trading instruction

- Buy or Sell
- Price and quantity
- Execution instructions

### P

**P&L (Profit & Loss)**: Trading results

- Unrealized: Open positions
- Realized: Closed positions
- Track performance

**Position**: Active trade

- Long or Short
- Open or Closed
- Monitored continuously

**Portfolio**: Total holdings

- All positions
- Total exposure
- Risk metrics

### R

**Risk Management**: Loss prevention

- Position sizing
- Stop-loss
- Diversification

**RSI**: Relative Strength Index

- Momentum indicator
- Overbought/Oversold
- Range: 0-100

### S

**Short Position**: Bearish bet

- Sell at current price
- Profit when price falls
- Stop-loss above

**Signal**: Trading recommendation

- AI-generated
- Action + Confidence
- Risk-validated

**Stop Loss**: Loss limit

- Automatic exit
- Risk control
- Position protection

### T

**Take Profit**: Profit target

- Automatic exit
- Secure profits
- Profit realization

**Technical Indicator**: Price analysis tool

- MACD, RSI, EMA, ATR
- Trend identification
- Signal generation

### U

**Unrealized P&L**: Paper profit/loss

- Open positions
- Fluctuates with price
- Realized on exit

---

## Algorithms

### Position Sizing Algorithm (Optimized)

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
  const minReservePercent = 0.4;
  const availableForTrade = account.availableMargin * (1 - minReservePercent);
  const maxCapitalBasedValue = availableForTrade * 0.3;

  // Step 4: Choose smaller value for safety
  const finalPositionValue = Math.min(maxCapitalBasedValue, riskBasedPositionValue);

  // Step 5: Apply minimum position size
  // Dynamic minimum: 1% of equity or $200
  const minPositionValue = Math.max(200, account.equity * 0.01);
  const adjustedPositionValue = Math.max(minPositionValue, finalPositionValue);

  // Step 6: Convert to position units
  const pricePerUnit = signal.entry_price || currentPrice;
  const positionSize = adjustedPositionValue / pricePerUnit;

  return {
    coin: signal.coin,
    suggestedSize: positionSize,
    riskAmount,
    stopLossPrice: calculateStopLoss(signal.action, pricePerUnit, stopLoss),
  };
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
  if (!signal.coin || !signal.action || !signal.confidence) {
    return false;
  }

  // Check confidence threshold (optimized to 0.55)
  if (signal.confidence < 0.55) {
    return false;
  }

  // Check max positions
  if (currentPositions.length >= maxPositions) {
    return false;
  }

  // Check existing position (properly normalized symbol comparison)
  const positionSymbol = `${signal.coin}/USDT`;
  const existingPosition = currentPositions.find(p => p.symbol === positionSymbol);
  if (existingPosition && (signal.action === 'LONG' || signal.action === 'SHORT')) {
    return false;
  }

  // Check total exposure
  const totalRisk = calculateTotalRisk(currentPositions, account);
  if (totalRisk >= maxTotalRisk) {
    return false;
  }

  // Check stop-loss validity
  if (signal.stop_loss && (signal.stop_loss < 0.01 || signal.stop_loss > 0.1)) {
    return false;
  }

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

---

## Key Metrics

### Performance Metrics

**Total Return**

- Overall profit/loss
- Percentage of initial balance
- Key success indicator

**Win Rate**

- Percentage of winning trades
- Quality metric
- Target: > 50%

**Risk/Reward Ratio**

- Average profit / Average loss
- Efficiency metric
- Target: > 2:1

**Sharpe Ratio**

- Risk-adjusted returns
- Higher is better
- Professional metric

---

## Best Practices

### ✅ Recommended

1. **Start Small**
   - Test with small positions
   - Validate strategies
   - Gradually increase

2. **Use Stop-Losses**
   - Always set stop-loss
   - Never skip risk management
   - Protect capital

3. **Monitor Positions**
   - Regular position checks
   - Monitor P&L
   - Adjust if needed

4. **Diversify**
   - Multiple coins
   - Multiple positions
   - Spread risk

5. **Test First**
   - Simulate before live
   - Use Mock AI
   - Validate approach

### ❌ Avoid

1. **Over-Leverage**
   - Don't max leverage
   - Start low
   - Increase gradually

2. **Emotional Trading**
   - Follow signals
   - Don't override
   - Trust the system

3. **Ignoring Risk**
   - Always validate
   - Don't disable controls
   - Monitor exposure

4. **All-In Approach**
   - Diversify positions
   - Don't concentrate
   - Spread risk

5. **Live Testing**
   - Test in simulation
   - Validate first
   - Then go live

---

## Appendix: Updates (January 2025)

### P&L Definitions

- Total P&L = Current Equity − Initial Balance (realized + unrealized)
- Unrealized P&L = Sum of open positions' unrealized P&L
- Cycle P&L = Equity change during the current cycle

### Execution Messages

- Execution messages use the actual order fill price where available.
- Notional/Margin in execution lines are estimates and labeled “Est.”; authoritative values appear in the positions table.

### Event Bus Timestamps

Cycle events include timestamps for reliable ordering in UI/analytics:

- cycle:start { cycleCount, timestamp, startTime }
- cycle:signals { cycleCount, timestamp, signalCount, signals[] }
- cycle:execution { cycleCount, timestamp, executedSignals, totalTrades }
- cycle:complete { cycleCount, timestamp, duration, totalSignals, totalTrades, totalPnl }

### Close Order Safeguards (Simulation/Backtest)

- Full-close tolerance: within 1% size difference is treated as a full close
- New reverse position opens only if remaining amount > 5% of the original size

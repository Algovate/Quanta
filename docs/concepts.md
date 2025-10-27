# Core Concepts and Terminology

Complete guide to key terms, concepts, and algorithms in BetaArena.

## Table of Contents

- [Architecture](#architecture)
- [Trading Concepts](#trading-concepts)
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

### Trading Modes

**Simulation Mode**
- Uses mock exchange
- Mock or Real AI
- No real money
- Perfect for testing

**Live Mode**
- Real exchange connection
- Real money at risk
- Requires API keys
- ⚠️ Use with caution

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

**Leverage Range**: 5x to 40x

**How it Works:**
- 10x leverage: $1 can control $10
- Amplifies both gains and losses
- Example: 10% price move = 100% gain/loss

**Safety Guidelines:**
- Start low (5x)
- Increase gradually
- Never max leverage on all positions

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
   - Process market data
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
- Store securely

**ATR**: Average True Range
- Volatility indicator
- Used for stop-loss placement

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

**Entry Price**: Position opening price
- Long: Buy price
- Short: Sell price
- Recorded for P&L

**Exchange**: Trading platform
- E.g., Binance, OKX
- Order execution
- Balance management

**Exit Price**: Position closing price
- Long: Sell price
- Short: Buy price
- Realized P&L

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
  const riskAmount = account.equity * maxRiskPerTrade
  
  // Step 2: Calculate risk-based position value
  const stopLoss = signal.stop_loss || 0.03
  const riskBasedPositionValue = riskAmount / stopLoss
  
  // Step 3: Calculate capital-based position value
  // 40% reserve for additional positions
  const minReservePercent = 0.4
  const availableForTrade = account.availableMargin * (1 - minReservePercent)
  const maxCapitalBasedValue = availableForTrade * 0.3
  
  // Step 4: Choose smaller value for safety
  const finalPositionValue = Math.min(
    maxCapitalBasedValue, 
    riskBasedPositionValue
  )
  
  // Step 5: Apply minimum position size
  // Dynamic minimum: 1% of equity or $200
  const minPositionValue = Math.max(200, account.equity * 0.01)
  const adjustedPositionValue = Math.max(
    minPositionValue, 
    finalPositionValue
  )
  
  // Step 6: Convert to position units
  const pricePerUnit = signal.entry_price || currentPrice
  const positionSize = adjustedPositionValue / pricePerUnit
  
  return {
    coin: signal.coin,
    suggestedSize: positionSize,
    riskAmount,
    stopLossPrice: calculateStopLoss(signal.action, pricePerUnit, stopLoss)
  }
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
    return false
  }
  
  // Check confidence threshold (optimized to 0.55)
  if (signal.confidence < 0.55) {
    return false
  }
  
  // Check max positions
  if (currentPositions.length >= maxPositions) {
    return false
  }
  
  // Check existing position (properly normalized symbol comparison)
  const positionSymbol = `${signal.coin}/USDT`
  const existingPosition = currentPositions.find(
    p => p.symbol === positionSymbol
  )
  if (existingPosition && 
      (signal.action === 'LONG' || signal.action === 'SHORT')) {
    return false
  }
  
  // Check total exposure
  const totalRisk = calculateTotalRisk(currentPositions, account)
  if (totalRisk >= maxTotalRisk) {
    return false
  }
  
  // Check stop-loss validity
  if (signal.stop_loss && 
      (signal.stop_loss < 0.01 || signal.stop_loss > 0.1)) {
    return false
  }
  
  return true
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
    return action === 'LONG'
      ? entryPrice - (atr * 2)
      : entryPrice + (atr * 2)
  } else {
    // Percentage-based stop-loss (simpler)
    return action === 'LONG'
      ? entryPrice * (1 - stopLossPercentage)
      : entryPrice * (1 + stopLossPercentage)
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

**Last Updated**: January 2025  
**Version**: 0.1.0

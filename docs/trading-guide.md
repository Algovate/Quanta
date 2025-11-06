# Trading Guide

Complete guide to trading with Quanta.

## Trading Modes

| Mode         | Market Data | Execution | Risk | Best For            |
| ------------ | ----------- | --------- | ---- | ------------------- |
| **simulate** | Mock        | Simulated | None | Learning            |
| **paper**    | Real        | Simulated | None | Strategy validation |
| **live**     | Real        | Real      | High | Production          |

### 1. Simulation Mode (Mock Data)

**Purpose**: Learning and initial testing with synthetic data

```bash
quanta trade start --env simulate --coins BTC,ETH,SOL
```

**Features:**

- Uses internal mock exchange (`simulator`)
- Perfect risk-free environment
- Can use Mock AI or Real AI
- No real money involved
- No external API dependencies

**Use Cases:**

- Learning how the system works
- Testing new features
- Understanding algorithms
- Initial AI prompt testing

### 2. Paper Trading Mode (Real Data, Simulated Execution)

**Purpose**: Strategy validation with real market conditions without financial risk

```bash
quanta trade start --env paper --coins BTC,ETH,SOL
```

**Features:**

- Fetches **real market data** from actual exchanges
- Simulates order execution and position management
- Tracks realistic P&L based on live price movements
- Uses real market volatility, trends, and patterns
- **API keys optional** (can fetch public market data without credentials)

**Use Cases:**

- Validating strategies with real market conditions
- Testing AI performance on live data
- Understanding how strategies perform in volatile markets
- Refining risk parameters before going live

### 3. Live Mode (Real Trading)

**Purpose**: Execute real trades with actual capital

```bash
quanta trade start --env live --coins BTC
```

**Requirements:**

- Valid API keys with trading permissions
- Proper risk management configuration
- Thorough testing in simulation and paper trading first

**⚠️ Critical Warnings:**

- **Real money is at risk** - losses are permanent
- Always test in simulation/paper mode first
- Start with small position sizes
- Monitor positions actively
- Understand exchange fee structures
- Be aware of slippage and execution quality
- Know how to stop trading immediately if needed (`Ctrl+C`)

## Trading Lifecycle

### 1. Start Trading

```bash
# Simulation mode
quanta trade start --env simulate --coins BTC,ETH,SOL

# Paper trading mode
quanta trade start --env paper --coins BTC,ETH,SOL

# Live trading
quanta trade start --env live --coins BTC
```

### 2. Monitor Output

```bash
# View detailed output in real-time
quanta log view --follow

# View with specific filters
quanta log view --follow --context Workflow --level info
```

### 3. Control Trading

Use `Ctrl+C` to stop the running trading process.

### 4. Review Results

```bash
# Run backtest with enhanced reporting
quanta trade backtest --start 2024-01-01 --end 2024-12-31 --coins BTC,ETH --initial-balance 10000
```

The backtest report includes:

- Signal statistics (generated, accepted, rejected)
- Performance summary (returns, Sharpe ratio, drawdown)
- Trade statistics (win rate, profit factor, best/worst trades)
- Risk metrics (volatility, VaR, max drawdown)
- Equity curve analysis

## Trading Workflow

```
🔄 Cycle Trigger (3 minutes)
    ↓
📊 Market Data Collection
    ↓
🤖 AI Analysis
    ↓
🛡️ Risk Validation
    ↓
⚡ Order Execution
    ↓
🔍 Position Monitoring
```

### Instruments and Pricing

- **OKX instruments**: Quanta uses `BASE/USDT:USDT` (e.g., `ETH/USDT:USDT`) for perpetuals
- **Entry pricing**: Execution references real-time mid price (best bid/ask average), not candle close
- **Exposure shown**: Sum of absolute position values (size × mark price), without leverage multiplication

### Market Types

| Type               | Leverage | Funding | Shorting | Risk Level |
| ------------------ | -------- | ------- | -------- | ---------- |
| **Spot**           | 1x only  | No      | No       | Lower      |
| **Swap/Perpetual** | 3x-10x   | Yes     | Yes      | Higher     |

**Recommended profiles:**

- **Spot**: leverage [1,1], stopLoss 3–7%, maxRisk 3–5%, maxPositions 6–10
- **Swap/Perp**: leverage [3,10], stopLoss 1–2%, maxRisk 1–2%, maxPositions 1–4

## Risk Management

Quanta automatically implements risk controls:

### Position Sizing

- **Maximum risk per trade**: 5% of account equity
- **Capital allocation**: 30% of available trading capital per position
- **Minimum position**: 1% of equity or $200 (whichever is greater)
- **Capital reserve**: Maintains 40% reserve for additional positions

### Stop Loss

- **Default**: 5% (configurable)
- **Types**: Percentage-based, ATR-based, or fixed dollar
- **Placement**: Below entry for longs, above entry for shorts

### Take Profit

- **Default**: 6% (2x stop-loss)
- **Strategies**: Fixed, trailing, or multiple levels

### Portfolio Limits

- **Max positions**: 6 concurrent positions (configurable)
- **Max total risk**: 30% of account equity
- **Confidence threshold**: 0.55 (55%) minimum signal confidence

### Leverage

- **Range**: 5x to 40x for derivatives, 1x for spot
- **Safety**: Automatically clamped based on market type

See [Core Concepts](concepts.md#risk-management) for detailed algorithms.

## Profit & Loss (PnL)

### Understanding PnL

**Unrealized PnL**: Open position profit/loss (not yet closed)

```typescript
// Long position
Unrealized PnL = (Current Price - Entry Price) × Position Size

// Short position
Unrealized PnL = (Entry Price - Current Price) × Position Size
```

**Realized PnL**: Closed position profit/loss (actual cash gained/lost)

```typescript
Realized PnL = calculated when position closes
Account Balance += Realized PnL
```

### Account Values

```typescript
Balance = Initial Capital + All Realized PnL
Equity = Balance + Unrealized PnL (from open positions)
Available Margin = Equity - Used Margin
```

### Leverage Impact on PnL

With 10x leverage:

- Position value: $10,000 (10 BTC @ $1,000)
- Required margin: $1,000 (10% of position)
- 1% price move → $100 PnL (10% ROI on margin)

### Trade Tracking

All completed trades are recorded with:

- Entry/exit times and prices
- Position size and side (long/short)
- Realized PnL (absolute and percentage)
- Holding period
- Reason for closing (signal/stop-loss/take-profit)

## Best Practices

### ✅ DO

- Always test in simulation or paper trading mode first
- Paper trading recommended for strategy validation with real data
- Start with small position sizes
- Monitor positions regularly
- Use stop-losses
- Diversify across coins
- Understand risk management parameters

### ❌ DON'T

- Don't trade with money you can't afford to lose
- Don't disable risk controls
- Don't ignore warnings
- Don't over-leverage
- Don't skip testing phases

## Troubleshooting

### Trading Not Executing

```bash
# Check configuration
quanta config show

# Validate settings
quanta config validate

# Check status (via logs)
quanta log view --context TradeStart --lines 100
```

### API Errors

```bash
# Test exchange connectivity
quanta test exchange --exchange simulator --coin BTC

# Test AI
quanta test ai --type mock --coin BTC

# Check API keys
quanta config show | grep -i api
```

### Performance Issues

```bash
# View detailed logs
quanta log view --follow --context Workflow

# Check for errors
quanta log view --level error

# Export logs for analysis
quanta log export --output logs.json --format json
```

## Advanced Topics

For more advanced topics, refer to:

- **[Core Concepts](concepts.md)** - Complete trading concepts and algorithms
- **[Configuration Guide](configuration.md)** - Advanced configuration options
- **[Arena Guide](arena-guide.md)** - Multi-drone trading arena
- **[Trading Cycle Price Usage](trading-cycle-price-usage.md)** - Detailed price source documentation

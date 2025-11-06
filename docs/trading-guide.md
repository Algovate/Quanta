# Trading Guide

Complete guide to Quanta trading operations.

## Trading Modes

| Mode         | Market Data | Execution | Risk | Use Case      |
| ------------ | ----------- | --------- | ---- | ------------- |
| **simulate** | Synthetic   | Simulated | None | Learning      |
| **paper**    | Real        | Simulated | None | Strategy test |
| **live**     | Real        | Real      | High | Production    |

### Simulate Mode

**Purpose**: Learn and test with synthetic data

```bash
quanta trade start --env simulate --coins BTC,ETH,SOL
```

**Features:**

- Uses internal simulator exchange
- Completely risk-free environment
- Can use Mock AI or Real AI
- No real funds involved
- No external API dependencies

**Use Cases:**

- Learn how the system works
- Test new features
- Understand algorithms
- Initial AI prompt testing

### Paper Trading Mode

**Purpose**: Validate strategies with real market conditions, no financial risk

```bash
quanta trade start --env paper --coins BTC,ETH,SOL
```

**Features:**

- **Real market data** (from actual exchanges)
- Simulated order execution and position management
- Tracks real P&L based on live price movements
- Uses real market volatility, trends, and patterns
- **API keys optional** (no credentials needed for public market data)

**Use Cases:**

- Validate strategies with real market conditions
- Test AI performance on live data
- Understand strategy behavior in volatile markets
- Refine risk parameters before live trading

### Live Mode

**Purpose**: Execute real trades with actual funds

```bash
quanta trade start --env live --coins BTC
```

**Requirements:**

- Valid API keys with trading permissions
- Proper risk management configuration
- Thorough testing in simulate and paper modes

**⚠️ Important Warnings:**

- **Real funds at risk** - Losses are permanent
- Always test in simulate/paper modes first
- Start with small position sizes
- Monitor positions actively
- Understand exchange fee structures
- Be aware of slippage and execution quality
- Know how to stop trading immediately (`Ctrl+C`)

## Trading Lifecycle

### 1. Start Trading

```bash
# Simulate mode
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

Use `Ctrl+C` to stop a running trading process.

### 4. View Results

```bash
# Run backtest with enhanced reporting
quanta trade backtest --start 2024-01-01 --end 2024-12-31 --coins BTC,ETH --initial-balance 10000
```

Backtest report includes:

- Signal statistics (generated, accepted, rejected)
- Performance summary (returns, Sharpe ratio, drawdown)
- Trade statistics (win rate, profit factor, best/worst trades)
- Risk metrics (volatility, VaR, max drawdown)
- Equity curve analysis

## Trading Workflow

```
🔄 Cycle trigger (3 minutes)
    ↓
📊 Market data collection
    ↓
🤖 AI analysis
    ↓
🛡️ Risk validation
    ↓
⚡ Order execution
    ↓
🔍 Position monitoring
```

### Tools and Pricing

- **OKX Tools**: Quanta uses `BASE/USDT:USDT` for perpetual contracts (e.g., `ETH/USDT:USDT`)
- **Entry Pricing**: Execution uses real-time mid price (average of best bid/ask), not candle close price
- **Displayed Risk Exposure**: Sum of absolute position values (size × mark price), excluding leverage multiplier

### Market Types

| Type                   | Leverage | Funding Rate | Shorting | Risk Level |
| ---------------------- | -------- | ------------ | -------- | ---------- |
| **Spot**               | 1x only  | None         | No       | Lower      |
| **Contract/Perpetual** | 3x-10x   | Yes          | Yes      | Higher     |

**Recommended Configuration:**

- **Spot**: Leverage [1,1], Stop Loss 3–7%, Max Risk 3–5%, Max Positions 6–10
- **Contract/Perpetual**: Leverage [3,10], Stop Loss 1–2%, Max Risk 1–2%, Max Positions 1–4

## Risk Management

Quanta automatically enforces risk controls:

### Position Sizing

- **Max risk per trade**: 5% of account equity
- **Capital allocation**: 30% of available trading capital per position
- **Minimum position**: 1% of equity or $200 (whichever is larger)
- **Capital reserve**: 40% reserved for additional positions

### Stop Loss

- **Default**: 5% (configurable)
- **Type**: Percentage-based, ATR-based, or fixed amount
- **Placement**: Below entry for longs, above entry for shorts

### Take Profit

- **Default**: 6% (2x stop loss)
- **Strategy**: Fixed, trailing, or multi-level

### Portfolio Limits

- **Max positions**: 6 concurrent positions (configurable)
- **Total risk limit**: 30% of account equity
- **Confidence threshold**: 0.55 (55%) minimum signal confidence

### Leverage

- **Range**: 5x to 40x for derivatives, 1x for spot
- **Safety**: Automatically limited based on market type

See [Core Concepts](concepts.md#risk-management) for details.

## Profit & Loss (P&L)

### Understanding P&L

**Unrealized P&L**: Profit/loss in open positions (not yet closed)

```typescript
// Long position
Unrealized P&L = (Current Price - Entry Price) × Position Size

// Short position
Unrealized P&L = (Entry Price - Current Price) × Position Size
```

**Realized P&L**: Profit/loss from closed positions (actual cash gained/lost)

```typescript
Realized P&L = Calculated on close;
Account Balance += Realized P&L;
```

### Account Value

```typescript
Balance = Initial Capital + All Realized P&L
Equity = Balance + Unrealized P&L (from positions)
Available Margin = Equity - Used Margin
```

### Leverage Impact on P&L

With 10x leverage:

- Position value: $10,000 (10 BTC @ $1,000)
- Required margin: $1,000 (10% of position)
- 1% price move → $100 P&L (10% ROI on margin)

### Trade Tracking

All completed trades are recorded with:

- Open/close times and prices
- Position size and direction (long/short)
- Realized P&L (absolute and percentage)
- Holding period
- Close reason (signal/stop loss/take profit)

## Best Practices

### ✅ Do

- Always test in simulate or paper trading mode first
- Use paper trading for strategy validation (real data)
- Start with small position sizes
- Monitor positions regularly
- Use stop losses
- Diversify across coins
- Understand risk management parameters

### ❌ Don't

- Don't trade with funds you can't afford to lose
- Don't disable risk controls
- Don't ignore warnings
- Don't over-leverage
- Don't skip testing stages

## Troubleshooting

### Trades Not Executing

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
# Test exchange connection
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

# Check errors
quanta log view --level error

# Export logs for analysis
quanta log export --output logs.json --format json
```

## Advanced Topics

For more advanced topics, see:

- [Core Concepts](concepts.md) - Complete trading concepts and algorithms
- [Configuration Guide](configuration.md) - Advanced configuration options
- [Arena Guide](arena-guide.md) - Multi-drone trading arena
- [Trading Cycle Price Usage](trading-cycle-price-usage.md) - Detailed price source documentation

# Trading Guide

Complete guide to trading with Quanta.

## Trading Modes

### 1. Simulation Mode (Mock Data - Recommended for Learning)

```bash
quanta trade start --mode simulation --coins BTC,ETH,SOL
```

**Features:**

- No real money involved
- Uses mock market data
- Mock AI agent by default
- Test strategies safely
- Learn the system

### 2. Paper Trading Mode (Real Data, Simulated Execution - Recommended for Testing)

```bash
quanta trade start --mode paper --coins BTC,ETH,SOL
```

**Features:**

- Real market data from exchanges (OKX, Binance, Coinbase)
- Simulated execution (no real money)
- Realistic market conditions
- API keys optional (uses public data if not provided)
- Perfect for strategy validation with real data

### 3. Live Mode (Real Trading - Use with Caution)

```bash
quanta trade start --mode live --coins BTC
```

**Requirements:**

- Real API keys configured
- Proper risk management
- Test in simulation or paper trading first!
- Real money at risk

## Trading Lifecycle

### 1. Start Trading

```bash
# Start with simulation mode (mock data)
quanta trade start --mode simulation --coins BTC,ETH,SOL

# Or start with paper trading (real data, simulated execution)
quanta trade start --mode paper --coins BTC,ETH,SOL
```

### 2. Monitor Status

```bash
# Check current status
quanta trade status

# View in real-time
quanta trade start --mode paper --coins BTC
```

### 3. Control Trading

```bash
# Pause trading system
quanta trade pause --reason "Maintenance"

# Stop gracefully (finish current trades)
quanta trade stop --graceful

# Force immediate stop
quanta trade stop --force
```

### 4. Review Results with Backtest

```bash
# Run backtest with enhanced reporting
quanta trade backtest --start 2024-01-01 --end 2024-12-31 --coins BTC,ETH --initial-balance 10000
```

The backtest report includes:

- **📊 Data Source Information**: Total candles, timeframes, per-coin breakdown
- **🤖 Signal Statistics**: Generated, accepted, rejected signals with visual indicators (✓/✗)
- **📊 Performance Summary**: Returns, Sharpe ratio, drawdown with color coding
- **📈 Trade Statistics**: Win rate with progress bar, profit factor, best/worst trades
- **⚠️ Risk Metrics**: Volatility, VaR, max drawdown with color thresholds
- **📉 Equity Curve**: Peak/lowest equity, positive periods percentage

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

- OKX instruments: Quanta uses `BASE/USDT:USDT` (e.g., `ETH/USDT:USDT`) for perps.
- Entry pricing: execution references real-time mid price (best bid/ask average), not candle close.
- Exposure shown in summaries is the sum of absolute position values (size × mark price), without leverage multiplication.

### Market Types and Effects

- Spot: no leverage, no funding; uses spot endpoints. Good for accumulation and lower risk.
- Swap/Perpetual: leverage supported; periodic funding applies; enables shorting. Higher risk; liquidation possible.

Recommended profiles:

- Spot: leverage [1,1], stopLoss 3–7%, maxRisk 3–5%, maxPositions 6–10
- Swap/Perp: leverage [3,10], stopLoss 1–2%, maxRisk 1–2%, maxPositions 1–4

Notes:

- Startup shows marketType and effective risk parameters; values outside safe bands are clamped.
- Funding warnings are displayed during cycles when enabled via `trading.funding.warnings`.

## Risk Management

Quanta automatically implements risk controls:

- **Position Sizing**: Maximum 5% risk per trade, 30% of available capital per position
- **Stop Loss**: 5% default (configurable)
- **Take Profit**: 6% default (2x stop-loss)
- **Max Positions**: 6 concurrent positions (configurable)
- **Leverage**: 5x to 40x for derivatives, 1x for spot (configurable)
- **Capital Reserve**: Maintains 40% reserve for additional positions

## Best Practices

### ✅ DO

- Always test in simulation or paper trading mode first
- Paper trading recommended for strategy validation with real data
- Start with small position sizes
- Monitor positions regularly
- Use stop-losses
- Diversify across coins

### ❌ DON'T

- Don't trade with money you can't afford to lose
- Don't disable risk controls
- Don't ignore warnings
- Don't over-leverage

## Troubleshooting

### Common Issues

**Issue**: Trading not executing

```bash
# Check configuration
quanta config show

# Validate settings
quanta config validate
```

**Issue**: API errors

```bash
# Check API keys
quanta test exchange --exchange simulator --coin BTC

# Test AI
quanta test ai --type mock --coin BTC
```

## Profit & Loss (PnL)

### Understanding PnL

Quanta tracks both **realized** and **unrealized** profit & loss:

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

See [Core Concepts](concepts.md#pnl-calculation) for detailed formulas.

## Advanced Topics

For more advanced topics, refer to:

- [Core Concepts](concepts.md) - Complete trading concepts and algorithms
- [Configuration Guide](configuration.md) - Advanced configuration options
- [Error Handling & Resilience](error-handling.md) - System resilience patterns
- [Logging Guide](logging-guide.md) - Operation tracking and analysis

---

**Last Updated**: January 2025  
**Version**: 0.1.0

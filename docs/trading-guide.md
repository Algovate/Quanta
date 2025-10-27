# Trading Guide

Complete guide to trading with Quanta.

## Trading Modes

### Simulation Mode (Recommended for Testing)

```bash
quanta trade start --mode simulation --coins BTC,ETH,SOL
```

**Features:**
- No real money involved
- Mock AI agent by default
- Test strategies safely
- Learn the system

### Live Mode (Use with Caution)

```bash
quanta trade start --mode live --coins BTC
```

**Requirements:**
- Real API keys configured
- Proper risk management
- Test in simulation first!

## Trading Lifecycle

### 1. Start Trading

```bash
quanta trade start --mode simulation --coins BTC,ETH,SOL
```

### 2. Monitor Status

```bash
# Check current status
quanta trade status

# View in real-time
quanta trade start --mode simulation --coins BTC
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

## Risk Management

Quanta automatically implements risk controls:

- **Position Sizing**: Maximum 5% risk per trade
- **Stop Loss**: 3% default
- **Take Profit**: 6% default
- **Max Positions**: 6 concurrent positions
- **Leverage**: 5x to 40x (configurable)

## Best Practices

### ✅ DO

- Always test in simulation mode first
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
quanta test kline --exchange simulator --coin BTC

# Test AI
quanta test ai --type mock --coin BTC
```

## Advanced Topics

- [Position Management](../docs/advanced-position-management.md)
- [AI Model Selection](../docs/ai-models.md)
- [Performance Optimization](../docs/performance.md)


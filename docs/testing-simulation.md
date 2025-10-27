# Testing & Simulation Guide

Complete guide to testing and simulation in BetaArena.

## Simulation Modes

### Mock AI (Default - No API Key Required)

```bash
# Basic simulation
beta-arena simulate cycle --coins BTC --verbose

# Multi-coin portfolio
beta-arena simulate cycle --coins BTC,ETH,SOL --verbose --max-positions 5
```

**Features:**
- No API keys needed
- Fast execution
- Deterministc behavior
- Great for testing

### Real AI (Requires API Key)

```bash
# Use real AI
beta-arena simulate cycle --coins BTC --ai real --verbose

# Requires OPENROUTER_API_KEY in config/simulate.json
```

**Features:**
- Actual AI analysis
- Real market decisions
- More realistic results
- Requires API key

## Testing Commands

### Test AI Integration

```bash
# Test Mock AI
beta-arena test ai --type mock --coin BTC

# Test Real AI
beta-arena test ai --type real --coin BTC

# Test both
beta-arena test ai --type both --verbose
```

### Test Market Data

```bash
# Test K-line data
beta-arena test kline --exchange simulator --coin BTC --timeframe 3m

# Test multiple exchanges
beta-arena test exchanges --coin BTC --timeframe 3m

# Test data sources
beta-arena test data-sources --coin BTC
```

## Simulation Examples

### Example 1: Single Coin Test

```bash
beta-arena simulate cycle \
  --coins BTC \
  --verbose \
  --initial-balance 10000 \
  --max-positions 3
```

**Output:**
```
🎯 BetaArena - Trade Cycle Simulation
==========================================

📊 PHASE 1: PERCEPTION
  ✓ Fetching BTC/USDT data...

🤖 PHASE 2: DECISION
  ✓ Generated 2 signals: LONG + SHORT

⚡ PHASE 3: EXECUTION
  ✓ Executed 2 orders

🔍 PHASE 4: MONITORING
  ✓ Portfolio P&L: +$150.00

📈 SUMMARY
  Initial: $10,000.00
  Final: $10,150.00
  P&L: +1.5%
```

### Example 2: Multi-Coin Portfolio

```bash
beta-arena simulate cycle \
  --coins BTC,ETH,SOL \
  --verbose \
  --max-positions 5 \
  --initial-balance 50000
```

**Output:**
```
🎯 BetaArena - Multi-Coin Simulation
==========================================

📊 PHASE 1: PERCEPTION
  ✓ BTC/USDT: LONG signal
  ✓ ETH/USDT: LONG signal
  ✓ SOL/USDT: SHORT signal

🤖 PHASE 2: DECISION
  ✓ 3 coins analyzed
  ✓ 5 signals generated

⚡ PHASE 3: EXECUTION
  ✓ 4 orders executed
  ✓ 1 signal filtered (low confidence)

🔍 PHASE 4: MONITORING
  📊 Portfolio Overview:
    - Exposure: $15,000
    - Leverage: 1.5x
    - P&L: +$250.00

📈 PORTFOLIO SUMMARY
  ✅ 3 coins | 4 orders | +0.5% return
```

## Testing Strategies

### Strategy 1: Testing AI Models

```bash
# Compare Mock vs Real AI
beta-arena test ai --type both --verbose --coin BTC

# Results will show:
# - Mock AI: deterministic signals
# - Real AI: actual market analysis
```

### Strategy 2: Market Data Validation

```bash
# Validate data quality
beta-arena test kline \
  --exchange simulator \
  --coin BTC \
  --timeframe 3m \
  --limit 100

# Should show:
# ✓ Retrieved 100 K-lines
# ✓ Indicators calculated
# ✓ Data quality: PASS
```

### Strategy 3: Risk Management Testing

```bash
# Test risk controls
beta-arena simulate cycle \
  --coins BTC \
  --verbose \
  --max-positions 1

# Should show:
# ✓ Risk validation passed
# ✓ Position size: 5% max
# ✓ Stop loss: 3%
```

## Simulation Phases

### Phase 1: Perception

- Fetch candlestick data
- Calculate indicators (EMA, MACD, RSI, ATR)
- Detect trend and volatility

### Phase 2: Decision

- AI analyzes market data
- Generate trading signals
- Assign confidence scores

### Phase 3: Execution

- Validate signals with risk management
- Calculate position sizes
- Execute orders
- Set stop-loss/take-profit

### Phase 4: Monitoring

- Track positions
- Update P&L
- Check exit conditions
- Manage portfolio

## Best Practices

### ✅ Recommended

```bash
# Start with simple tests
beta-arena simulate cycle --coins BTC --verbose

# Gradually increase complexity
beta-arena simulate cycle --coins BTC,ETH --verbose

# Test both AI types
beta-arena test ai --type both

# Monitor all phases
beta-arena simulate cycle --verbose
```

### ❌ Avoid

```bash
# Don't skip testing
# ❌ beta-arena trade start --mode live (without testing)

# Don't ignore verbose output
# ❌ beta-arena simulate cycle

# Don't test without proper config
# ❌ beta-arena simulate cycle --ai real (without API key)
```

## Troubleshooting

### Issue: No Signals Generated

```bash
# Check AI type
beta-arena test ai --type mock --coin BTC

# Check market data
beta-arena test kline --exchange simulator --coin BTC
```

### Issue: Simulation Too Fast

```bash
# Increase verbose output
beta-arena simulate cycle --verbose

# Test with specific balance
beta-arena simulate cycle --initial-balance 100000
```

### Issue: API Key Not Working

```bash
# Test AI with mock first
beta-arena test ai --type mock

# Validate API key
beta-arena config show

# Check environment
env | grep OPENROUTER_API_KEY
```

## Advanced Testing

### Performance Testing

```bash
# Multi-coin stress test
beta-arena simulate cycle \
  --coins BTC,ETH,SOL,BNB,ADA \
  --max-positions 10 \
  --verbose
```

### Risk Testing

```bash
# Test risk limits
beta-arena simulate cycle \
  --coins BTC \
  --initial-balance 1000 \
  --max-positions 1
```


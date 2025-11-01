# Getting Started

Quick start guide for Quanta - AI-powered quantitative trading system.

## Installation

```bash
# Clone the repository
git clone https://github.com/Algovate/quanta.git
cd quanta

# Install dependencies
npm install

# Build the project
npm run build
```

> **Note**: Paper trading mode recommended for testing with real market data

## Quick Start

### 1. Test the System

```bash
# Test with Mock AI (no API key required)
quanta simulate cycle --coins BTC --verbose

# Test AI integration
quanta test ai --type mock --coin BTC

# Test market data
quanta test exchange --exchange simulator --coin BTC

# Test different exchanges
quanta test exchange --exchange bin --coin BTC
quanta test exchange --exchange cb --coin ETH
quanta test exchange --exchange hliq --coin SOL
```

### 2. Configure API Keys

```bash
# Set OpenRouter API key
export OPENROUTER_API_KEY=your_key_here

# Or add to .env file
echo "OPENROUTER_API_KEY=your_key_here" >> .env
```

### 3. Run Your First Simulation

```bash
# Basic simulation
quanta simulate cycle --coins BTC --verbose

# Multi-coin simulation
quanta simulate cycle --coins BTC,ETH,SOL --verbose --max-positions 5

# With real AI
quanta simulate cycle --coins BTC,ETH --ai real --verbose
```

### 4. Run Backtest

```bash
# Run a historical backtest
quanta trade backtest --start 2024-01-01 --end 2024-04-01 --coins BTC,ETH --initial-balance 10000

# The output includes:
# - Signal statistics (generated, accepted, rejected)
# - Performance metrics (returns, Sharpe ratio, drawdown)
# - Trade statistics with visual progress bars
# - Risk metrics and equity curve analysis
```

### 5. Start Trading

Choose your trading mode based on your needs:

```bash
# Option 1: Simulation mode (Mock data - best for learning)
quanta trade start --mode simulation --coins BTC,ETH
# ✓ Uses mock data only
# ✓ No risk, no API keys required
# ✓ Perfect for understanding the system

# Option 2: Paper trading (Real data, simulated trades - recommended for testing)
quanta trade start --mode paper --coins BTC,ETH
# ✓ Uses real market data from exchanges
# ✓ Simulated execution (no real money)
# ✓ Realistic market conditions
# ✓ API keys optional

# Option 3: Live trading (Real money - use with extreme caution)
quanta trade start --mode live --coins BTC,ETH
# ⚠️ Real money at risk
# ⚠️ Requires API keys
# ⚠️ Always test in simulation/paper first!
```

**The system will:**

- Run trading cycles every 3 minutes
- Monitor positions and execute trades
- Display real-time updates
- Press `Ctrl+C` to stop gracefully

## Next Steps

- 📖 [Read the Trading Guide](trading-guide.md) - Complete trading operations
- 🔧 [Configure the System](configuration.md) - Advanced configuration
- 🧪 [Learn Testing](testing-simulation.md) - Strategy testing
- 💡 [Study Concepts](concepts.md) - Deep dive into algorithms

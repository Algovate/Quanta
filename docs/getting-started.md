# Getting Started

Quick start guide for Quanta CLI.

## Installation

```bash
# Clone the repository
git clone https://github.com/your-org/quanta.git
cd quanta

# Install dependencies
npm install

# Build the project
npm run build
```

## Quick Start

### 1. Test the System

```bash
# Test with Mock AI (no API key required)
quanta simulate cycle --coins BTC --verbose

# Test AI integration
quanta test ai --type mock --coin BTC

# Test market data
quanta test kline --exchange simulator --coin BTC

# Test different exchanges
quanta test kline --exchange bin --coin BTC
quanta test kline --exchange cb --coin ETH
quanta test kline --exchange hliq --coin SOL
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

```bash
# Start trading in simulation mode
quanta trade start --mode simulation --coins BTC,ETH

# The system will run trading cycles every 3 minutes
# Press Ctrl+C to stop gracefully
```

## Next Steps

- 📖 [Read the Trading Guide](trading-guide.md) - Complete trading operations
- 🔧 [Configure the System](configuration.md) - Advanced configuration
- 🧪 [Learn Testing](testing-simulation.md) - Strategy testing
- 💡 [Study Concepts](concepts.md) - Deep dive into algorithms

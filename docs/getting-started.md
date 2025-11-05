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

> **Note**: For testing with real market data without financial risk, use paper trading mode. For learning the system mechanics, start with simulation mode.

## Quick Start

### 1. Test the System

```bash
# Test with Mock AI (no API key required)
quanta simulate cycle --coins BTC --verbose

# Test AI and exchanges
quanta test ai --type mock --coin BTC
quanta test exchange --exchange simulator --coin BTC
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
# Basic simulation (Mock AI)
quanta simulate cycle --coins BTC --verbose

# Multi-coin with real AI
quanta simulate cycle --coins BTC,ETH,SOL --ai real --verbose
```

### 4. Run Backtest

```bash
# Historical backtest
quanta trade backtest --start 2024-01-01 --end 2024-04-01 --coins BTC,ETH --initial-balance 10000
```

### 5. Start Trading

```bash
# Simulation (mock data, no risk)
quanta trade start --env simulate --coins BTC,ETH

# Paper trading (real data, simulated execution)
quanta trade start --env paper --coins BTC,ETH

# Live trading (real money - use with caution)
quanta trade start --env live --coins BTC,ETH
```

The system runs trading cycles every 3 minutes. Press `Ctrl+C` to stop.

## Next Steps

- 📖 [Read the Trading Guide](trading-guide.md) - Complete trading operations
- 🔧 [Configure the System](configuration.md) - Advanced configuration
- 💡 [Study Concepts](concepts.md) - Deep dive into algorithms
- 📚 [Browse Full Documentation](README.md) - Complete documentation index

## Important Notes

- **Always test in simulation mode first** to understand the system mechanics
- **Use paper trading mode** to validate strategies with real market data
- **Only use live mode** after thorough testing and with proper risk management
- **Never trade with money you can't afford to lose**

# Getting Started

Quick start guide for Quanta - AI-powered quantitative trading system.

## Installation

### Prerequisites

- Node.js 18+ and npm
- Git

### Steps

```bash
# Clone the repository
git clone https://github.com/Algovate/Quanta.git
cd Quanta

# Install dependencies
npm install

# Build the project
npm run build
```

### Verify Installation

```bash
# Test the CLI
quanta --help

# Test with mock AI (no API key required)
quanta simulate cycle --coins BTC --verbose
```

## Quick Start

### 1. Test the System

```bash
# Test with Mock AI (no API key required)
quanta simulate cycle --coins BTC --verbose

# Test AI integration
quanta test ai --type mock --coin BTC

# Test exchange connectivity
quanta test exchange --exchange simulator --coin BTC
```

### 2. Configure API Keys (Optional for Paper Trading)

For paper trading with real market data, API keys are optional. For live trading, they are required.

```bash
# Set OpenRouter API key (for real AI)
export OPENROUTER_API_KEY=your_key_here

# Set exchange API keys (for live trading)
export OKX_API_KEY=your_key
export OKX_API_SECRET=your_secret

# Or add to .env file
echo "OPENROUTER_API_KEY=your_key_here" >> .env
```

### 3. Run Your First Simulation

```bash
# Basic simulation (Mock AI, no API key)
quanta simulate cycle --coins BTC --verbose

# Multi-coin with real AI
quanta simulate cycle --coins BTC,ETH,SOL --ai real --verbose
```

### 4. Run Backtest

```bash
# Historical backtest (last 4 months by default)
quanta trade backtest

# Custom date range
quanta trade backtest --start 2024-01-01 --end 2024-04-01 --coins BTC,ETH --initial-balance 10000
```

### 5. Start Trading

```bash
# Simulation mode (mock data, no risk)
quanta trade start --env simulate --coins BTC,ETH

# Paper trading (real data, simulated execution)
quanta trade start --env paper --coins BTC,ETH

# Live trading (real money - use with caution!)
quanta trade start --env live --coins BTC
```

The system runs trading cycles every 3 minutes. Press `Ctrl+C` to stop.

## Viewing Output

After starting the trading system, use the log viewer to see detailed output:

```bash
# View last 50 lines
quanta log view

# Follow in real-time
quanta log view --follow

# Filter by context
quanta log view --context Workflow --follow
```

## Next Steps

1. **Read the Trading Guide**: [Trading Guide](trading-guide.md) - Complete trading operations
2. **Configure the System**: [Configuration Guide](configuration.md) - Advanced configuration
3. **Study Concepts**: [Core Concepts](concepts.md) - Deep dive into algorithms
4. **Browse Commands**: [Command Reference](commands.md) - Complete command documentation

## Important Notes

### Trading Modes

- **Simulation Mode**: Uses mock data, perfect for learning. No real money at risk.
- **Paper Trading Mode**: Uses real market data with simulated execution. Best for strategy validation.
- **Live Mode**: Real trading with actual capital. Use only after thorough testing.

### Safety Guidelines

- ✅ **Always test in simulation mode first** to understand the system mechanics
- ✅ **Use paper trading mode** to validate strategies with real market data
- ✅ **Only use live mode** after thorough testing and with proper risk management
- ❌ **Never trade with money you can't afford to lose**

### Recommended Workflow

```
1. Simulation Mode (Understand the system)
   ↓
2. Paper Trading Mode (Validate strategy with real data)
   ↓
3. Small-scale Live Testing (Real trading with minimal risk)
   ↓
4. Full Production (Scale up after proven)
```

## Troubleshooting

### Installation Issues

```bash
# Check Node.js version
node --version  # Should be 18+

# Rebuild the project
npm run build

# Check for errors
npm run build 2>&1 | grep -i error
```

### Configuration Issues

```bash
# Validate configuration
quanta config validate

# Show current configuration
quanta config show

# Check environment variables
env | grep -E "(AI_|EXCHANGE_|TRADING_)"
```

### API Connection Issues

```bash
# Test exchange connectivity
quanta test exchange --exchange simulator --coin BTC

# Test AI integration
quanta test ai --type mock --coin BTC
```

For more help, see:

- [Configuration Guide](configuration.md#troubleshooting)
- [Trading Guide](trading-guide.md#troubleshooting)
- [Command Reference](commands.md)

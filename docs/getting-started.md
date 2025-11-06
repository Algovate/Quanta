# Getting Started

Quick start guide for Quanta.

## Installation

**Prerequisites**: Node.js 18+ and npm

```bash
# Clone and install
git clone https://github.com/Algovate/Quanta.git
cd Quanta
npm install
npm run build

# Verify installation
quanta --help
```

## Quick Start

### 1. Test System

```bash
# Test with mock AI (no API key required)
quanta simulate cycle --coins BTC --verbose

# Test AI integration
quanta test ai --type mock --coin BTC

# Test exchange connectivity
quanta test exchange --exchange simulator --coin BTC
```

### 2. Configure API Keys (Optional)

For paper trading, API keys are optional. For live trading, they are required.

```bash
# Set OpenRouter API key (for real AI)
export OPENROUTER_API_KEY=your_key_here

# Set exchange API keys (for live trading)
export OKX_API_KEY=your_key
export OKX_API_SECRET=your_secret
```

### 3. Run First Simulation

```bash
# Basic simulation (Mock AI, no API key)
quanta simulate cycle --coins BTC --verbose

# Multi-coin with real AI
quanta simulate cycle --coins BTC,ETH,SOL --ai real --verbose
```

### 4. Start Trading

```bash
# Simulation mode (mock data, no risk)
quanta trade start --env simulate --coins BTC,ETH

# Paper trading (real data, simulated execution)
quanta trade start --env paper --coins BTC,ETH

# Live trading (real money - use with caution!)
quanta trade start --env live --coins BTC
```

System runs trading cycles every 3 minutes. Press `Ctrl+C` to stop.

### 5. View Output

```bash
# View last 50 lines
quanta log view

# Follow in real-time
quanta log view --follow

# Filter by context
quanta log view --context Workflow --follow
```

## Trading Modes

| Mode         | Market Data | Execution | Risk | Best For            |
| ------------ | ----------- | --------- | ---- | ------------------- |
| **simulate** | Mock        | Simulated | None | Learning            |
| **paper**    | Real        | Simulated | None | Strategy validation |
| **live**     | Real        | Real      | High | Production          |

## Safety Guidelines

✅ **Always test in simulation mode first**  
✅ **Use paper trading to validate strategies**  
✅ **Only use live mode after thorough testing**  
❌ **Never trade with money you can't afford to lose**

## Recommended Workflow

```
1. Simulation Mode (Understand system)
   ↓
2. Paper Trading Mode (Validate with real data)
   ↓
3. Small-scale Live Testing (Minimal risk)
   ↓
4. Full Production (Scale up after proven)
```

## Next Steps

- **[Trading Guide](trading-guide.md)** - Complete trading operations
- **[Configuration](configuration.md)** - Advanced configuration
- **[Core Concepts](concepts.md)** - Deep dive into algorithms
- **[Commands](commands.md)** - Complete command reference

## Troubleshooting

### Installation Issues

```bash
# Check Node.js version
node --version  # Should be 18+

# Rebuild
npm run build
```

### Configuration Issues

```bash
# Validate configuration
quanta config validate

# Show current configuration
quanta config show
```

### API Connection Issues

```bash
# Test exchange connectivity
quanta test exchange --exchange simulator --coin BTC

# Test AI integration
quanta test ai --type mock --coin BTC
```

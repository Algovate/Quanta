# Getting Started

Quick start guide for Quanta.

## Installation

**Requirements**: Node.js 18+ and npm

```bash
git clone https://github.com/Algovate/Quanta.git
cd Quanta
npm install
npm run build

# Verify installation
quanta --help
```

## Run Your First Trade

### 1. Test the System

```bash
# Test with simulated AI (no API keys needed)
quanta simulate cycle --coins BTC --verbose

# Test AI integration
quanta test ai --type mock --coin BTC

# Test exchange connection
quanta test exchange --exchange simulator --coin BTC
```

### 2. Configure API Keys (Optional)

**Paper Trading**: API keys optional  
**Live Trading**: API keys required

```bash
# AI provider options (choose one):
# OpenRouter (default)
export OPENROUTER_API_KEY=your_key_here

# Or use Ollama (local instance, no API key needed)
export AI_PROVIDER=ollama
export OLLAMA_MODEL=llama2

# Exchange API keys (for live trading)
export OKX_API_KEY=your_key
export OKX_API_SECRET=your_secret
```

### 3. Start Trading

```bash
# Simulate mode (synthetic data, no risk)
quanta trade start --env simulate --coins BTC,ETH

# Paper trading (real data, simulated execution)
quanta trade start --env paper --coins BTC,ETH

# Live trading (real funds - use with caution!)
quanta trade start --env live --coins BTC
```

The system runs a trading cycle every 3 minutes. Press `Ctrl+C` to stop.

### 4. View Logs

```bash
# View last 50 lines
quanta log view

# Follow in real-time
quanta log view --follow

# Filter by context
quanta log view --context Workflow --follow
```

## Trading Modes

| Mode         | Market Data | Execution | Risk | Use Case      |
| ------------ | ----------- | --------- | ---- | ------------- |
| **simulate** | Synthetic   | Simulated | None | Learning      |
| **paper**    | Real        | Simulated | None | Strategy test |
| **live**     | Real        | Real      | High | Production    |

## Security Recommendations

✅ **Always test in simulate mode first**  
✅ **Use paper trading to validate strategies**  
✅ **Test thoroughly before using live mode**  
❌ **Don't trade with funds you can't afford to lose**

## Recommended Workflow

```
1. Simulate mode → Learn the system
   ↓
2. Paper trading → Validate with real data
   ↓
3. Small live test → Minimal risk
   ↓
4. Full production → Scale after validation
```

## Next Steps

- [Trading Guide](trading-guide.md) - Complete trading operations
- [Configuration Guide](configuration.md) - Advanced configuration
- [Core Concepts](concepts.md) - Algorithm details
- [Commands Reference](commands.md) - Complete command list

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
# Test exchange connection
quanta test exchange --exchange simulator --coin BTC

# Test AI integration
quanta test ai --type mock --coin BTC
```

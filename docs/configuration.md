---
noteId: "526a3a70b2df11f0b5dcffd87852d11b"
tags: []

---

# Configuration Guide

Complete guide to configuring Quanta.

## Configuration Files

### Main Config: `config/config.json`

Used for live trading and general settings:

```json
{
  "mode": "simulation",
  "exchange": {
    "name": "simulator",
    "testnet": true,
    "apiKey": "your_api_key",
    "apiSecret": "your_api_secret"
  },
  "ai": {
    "apiKey": "sk-or-v1-your-api-key-here",
    "model": "deepseek/deepseek-chat",
    "temperature": 0.7
  },
  "trading": {
    "coins": ["BTC", "ETH", "SOL"],
    "cyclePeriod": 180000,
    "maxPositions": 6,
    "leverageRange": [5, 40],
    "stopLoss": 0.03,
    "maxRisk": 0.05
  }
}
```

### Simulation Config: `config/simulate.json`

Independent configuration for simulation:

```json
{
  "simulation": {
    "defaultInitialBalance": 10000,
    "defaultMaxPositions": 6,
    "defaultAI": "mock"
  },
  "risk": {
    "maxRiskPerTrade": 0.05,
    "maxTotalRisk": 0.30,
    "stopLoss": 0.03,
    "takeProfit": 0.06
  },
  "logging": {
    "verbose": false,
    "saveResults": false
  },
  "ai": {
    "real": {
      "apiKey": "your_api_key_here",
      "model": "deepseek/deepseek-chat",
      "temperature": 0.7
    }
  }
}
```

## Configuration Priority

### For Trading Commands

1. Command-line arguments (highest)
2. Environment variables
3. `config/config.json`
4. Default values (lowest)

### For Simulation Command

1. Command-line arguments (highest)
2. `config/simulate.json` ⚠️ **Independent from config.json**
3. Default values (lowest)

## Environment Variables

```bash
# Exchange
EXCHANGE_MODE=simulation
EXCHANGE_NAME=simulator
EXCHANGE_API_KEY=your_key
EXCHANGE_API_SECRET=your_secret

# AI
OPENROUTER_API_KEY=your_key
AI_MODEL=deepseek/deepseek-chat
AI_TEMPERATURE=0.7

# Trading
TRADING_COINS=BTC,ETH,SOL
CYCLE_PERIOD=180000
MAX_POSITIONS=6
STOP_LOSS=0.03
MAX_RISK=0.05
```

## CLI Configuration

```bash
# Show current configuration
quanta config show

# Set configuration values
quanta config set ai.model deepseek/deepseek-chat

# Validate configuration
quanta config validate

# Save configuration
quanta config save

# Reset to defaults
quanta config reset

# Initialize from example
quanta config init
```

## Key Settings

### AI Settings

- **apiKey**: Your OpenRouter API key
- **model**: AI model to use (recommended: `deepseek/deepseek-chat`)
- **temperature**: Creativity level (0.7 = balanced)

### Trading Settings

- **coins**: List of cryptocurrencies to trade
- **maxPositions**: Maximum concurrent positions
- **stopLoss**: Default stop-loss percentage (3%)
- **maxRisk**: Maximum risk per trade (5%)

### Exchange Settings

- **name**: Exchange name (`simulator`, `okx`, `binance`, `coinbase`)
- **testnet**: Use testnet environment (true for testing)

## Examples

### Conservative Setup

```json
{
  "trading": {
    "coins": ["BTC"],
    "maxPositions": 2,
    "stopLoss": 0.02,
    "maxRisk": 0.02
  }
}
```

### Aggressive Setup

```json
{
  "trading": {
    "coins": ["BTC", "ETH", "SOL", "BNB"],
    "maxPositions": 10,
    "stopLoss": 0.05,
    "maxRisk": 0.10
  }
}
```

## Troubleshooting

### Configuration Not Loading

```bash
# Check file exists
cat config/config.json

# Validate JSON
quanta config validate

# Check environment variables
env | grep -E "(AI_|EXCHANGE_|TRADING_)"
```

### Configuration Conflicts

```bash
# Clear environment overrides
unset OPENROUTER_API_KEY

# Use config file only
quanta config show

# Reset and reinit
quanta config reset
quanta config init
```


# Configuration Guide

Complete guide to configuring Quanta.

## Configuration Files

### Main Config: `config/config.json`

Used for live trading and general settings:

```json
{
  "mode": "simulation",
  "_comment_mode": "Trading mode: 'simulation' (mock data), 'paper' (real data, simulated trades), 'live' (real trading)",
  "exchange": {
    "name": "okx",
    "_comment_name": "Exchange: 'simulator' (mock data), 'okx', 'binance', 'coinbase' (real data)",
    "testnet": true,
    "marketType": "spot",
    "_comment_marketType": "Market type: 'spot' or 'swap' (aliases: 'perp', 'perpetual' → 'swap')",
    "apiKey": "your_api_key",
    "apiSecret": "your_api_secret"
  },
  "ai": {
    "apiKey": "sk-or-v1-your-api-key-here",
    "model": "deepseek/deepseek-chat-v3-0324",
    "temperature": 0.7,
    "prompt": {
      "candles": { "m3": 10, "h4": 5 },
      "sections": { "candlesTA": true, "sentiment": true, "technicalState": true }
    }
  },
  "trading": {
    "coins": ["BTC", "ETH", "SOL"],
    "cyclePeriod": 180000,
    "maxPositions": 6,
    "leverageRange": [5, 40],
    "stopLoss": 0.05,
    "maxRisk": 0.05,
    "priceSanity": {
      "enabled": true,
      "maxDeviation": 0.05
    },
    "funding": { "warnings": true }
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
    "maxTotalRisk": 0.3,
    "stopLoss": 0.05,
    "takeProfit": 0.06
  },
  "logging": {
    "verbose": false,
    "saveResults": false
  },
  "ai": {
    "real": {
      "apiKey": "your_api_key_here",
      "model": "deepseek/deepseek-chat-v3-0324",
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
EXCHANGE_MODE=paper
EXCHANGE_NAME=okx
EXCHANGE_API_KEY=your_key
EXCHANGE_API_SECRET=your_secret
EXCHANGE_MARKET_TYPE=swap    # or spot; aliases 'perp'/'perpetual' → swap

# AI
OPENROUTER_API_KEY=your_key
AI_MODEL=deepseek/deepseek-chat-v3-0324
AI_TEMPERATURE=0.7

# AI Prompt (optional)
PROMPT_CANDLES_3M=10
PROMPT_CANDLES_4H=5
PROMPT_SECTIONS_CANDLES_TA=true
PROMPT_SECTIONS_SENTIMENT=true
PROMPT_SECTIONS_TECH_STATE=true

# Trading
TRADING_COINS=BTC,ETH,SOL
CYCLE_PERIOD=180000
MAX_POSITIONS=6
STOP_LOSS=0.05
MAX_RISK=0.05
# Price sanity guard (optional)
TRADING_PRICE_SANITY_ENABLED=true
TRADING_PRICE_SANITY_MAX_DEVIATION=0.05
# Funding warnings (perpetuals)
TRADING_FUNDING_WARNINGS=true
```

## CLI Configuration

```bash
# Show current configuration
quanta config show

# Set configuration values
quanta config set ai.model deepseek/deepseek-chat-v3-0324

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
- **model**: AI model to use (recommended: `deepseek/deepseek-chat-v3-0324`)
- **temperature**: Creativity level (0.7 = balanced)

### Trading Settings

- **coins**: List of cryptocurrencies to trade
- **maxPositions**: Maximum concurrent positions
- **stopLoss**: Default stop-loss percentage (5%)
- **maxRisk**: Maximum risk per trade (5%)
- **priceSanity.enabled**: If true, stale `entry_price` (> maxDeviation from live ticker) is ignored and converted to a market order.
- **priceSanity.maxDeviation**: Relative deviation threshold (default 0.05 = 5%).

### Exchange Settings

- **name**: Exchange name (`simulator`, `okx`, `binance`, `coinbase`, `hyperliquid`)
- **testnet**: Use testnet environment (true for testing)
- **marketType**: `spot` or `swap` (aliases: `perp`, `perpetual` map to `swap`). Affects leverage support, funding, and symbol routing.

### MarketType-Aware Defaults and Guards

- When `exchange.marketType = spot`:
  - Effective leverage range clamped to [1, 1]
  - Recommended: stopLoss 3–7%, maxRisk 3–5%, maxPositions 6–10
- When `exchange.marketType = swap|perp|perpetual`:
  - Effective leverage range clamped to [3, 10]
  - Recommended: stopLoss 1–2%, maxRisk 1–2%, maxPositions 1–4
- Startup logs display the market type and effective risk parameters; out-of-band values are clamped with a warning.

### Instrument Selection (OKX)

- In derivatives mode Quanta targets OKX USDT-margined perp contracts.
- Symbols are normalized to `BASE/USDT:USDT` internally.
- Examples that resolve to the same instrument:
  - `ETH` → `ETH/USDT:USDT`
  - `ETH/USDT` → `ETH/USDT:USDT`
  - `ETH-USDT-SWAP` → `ETH/USDT:USDT`

## Examples

### Conservative Setup

```json
{
  "trading": {
    "coins": ["BTC"],
    "maxPositions": 2,
    "stopLoss": 0.02,
    "maxRisk": 0.02,
    "priceSanity": { "enabled": true, "maxDeviation": 0.05 }
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
    "maxRisk": 0.1,
    "priceSanity": { "enabled": true, "maxDeviation": 0.05 }
  }
}
```

## Metrics Definitions

- **Unlevered Exposure**: Sum of position sizes × mark prices (does not include leverage). Displayed in cycle summaries.
- **Leverage (portfolio)**: Unlevered Exposure ÷ Equity.

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

# Configuration Guide

Complete guide to configuring Quanta.

## Configuration Files

### Main Config: `config/config.json`

```json
{
  "mode": "strategy",
  "env": "simulate",
  "exchange": {
    "name": "okx",
    "testnet": true,
    "marketType": "spot",
    "apiKey": "your_api_key",
    "apiSecret": "your_api_secret"
  },
  "ai": {
    "apiKey": "sk-or-v1-your-api-key-here",
    "model": "deepseek/deepseek-chat-v3-0324",
    "temperature": 0.7,
    "prompt": {
      "activeGroup": "default",
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
    "priceSanity": { "enabled": true, "maxDeviation": 0.05 }
  }
}
```

**Key fields:**

- `mode`: `strategy` (single) or `arena` (multi-drone)
- `env`: `simulate`, `paper`, or `live`
- `exchange.marketType`: `spot` or `swap` (affects leverage and risk parameters)

## Configuration Priority

1. Command-line arguments (highest)
2. Environment variables
3. `config/config.json`
4. Default values (lowest)

## Environment Variables

### Mode/Environment

```bash
QUANTA_MODE=strategy   # or arena
QUANTA_ENV=paper       # or live|simulate
```

### Exchange

```bash
EXCHANGE_NAME=okx
EXCHANGE_API_KEY=your_key
EXCHANGE_API_SECRET=your_secret
EXCHANGE_MARKET_TYPE=swap    # or spot; aliases 'perp'/'perpetual' → swap
```

### AI

```bash
OPENROUTER_API_KEY=your_key
OPENROUTER_MODEL=deepseek/deepseek-chat-v3-0324
OPENROUTER_BASE_URL=https://openrouter.ai/api/v1  # optional
AI_TEMPERATURE=0.7
```

### AI Prompt

```bash
PROMPT_ACTIVE_GROUP=default
PROMPT_CANDLES_3M=10
PROMPT_CANDLES_4H=5
PROMPT_SECTIONS_CANDLES_TA=true
PROMPT_SECTIONS_SENTIMENT=true
PROMPT_SECTIONS_TECH_STATE=true
```

### Trading

```bash
TRADING_COINS=BTC,ETH,SOL
CYCLE_PERIOD=180000
MAX_POSITIONS=6
STOP_LOSS=0.05
MAX_RISK=0.05
TRADING_PRICE_SANITY_ENABLED=true
TRADING_PRICE_SANITY_MAX_DEVIATION=0.05
```

### Logging

```bash
LOG_DIR=/absolute/path/to/logs/text  # Override JSONL log directory
```

## Prompt Groups

Prompt groups are stored in `config/prompts/`. Each group contains:

- `metadata`: Name, description, version
- `system`: System prompt template with Mustache variables
- `user`: User prompt template with Mustache variables

**Available groups:**

- `default`: Balanced risk + technical analysis
- `nofx`: NoFX-inspired staged decision framework

**Switch groups:**

```json
{
  "ai": {
    "prompt": {
      "activeGroup": "nofx"
    }
  }
}
```

Or via environment:

```bash
PROMPT_ACTIVE_GROUP=nofx
```

**View prompts:**

```bash
quanta prompts view                    # View current active group
quanta prompts view --rendered        # View rendered prompts
quanta prompts list                    # List all groups
```

## Key Settings

### AI Settings

- **apiKey**: OpenRouter API key (required, set via `OPENROUTER_API_KEY` or `ai.apiKey`)
- **model**: AI model (default: `deepseek/deepseek-chat-v3-0324`)
- **temperature**: Creativity level (default: 0.7)
- **baseUrl**: OpenRouter API base URL (optional, defaults to `https://openrouter.ai/api/v1`)

**Configuration Priority:**

1. Environment variables (`OPENROUTER_API_KEY`, `OPENROUTER_MODEL`, `OPENROUTER_BASE_URL`)
2. `config.json` values (`ai.apiKey`, `ai.model`, `ai.baseUrl`)
3. Default values

**Stop-on-AI-Error:** When AI client errors occur (4xx status codes), the workflow stops immediately with clear logging.

### Trading Settings

- **coins**: List of cryptocurrencies to trade
- **maxPositions**: Maximum concurrent positions
- **stopLoss**: Default stop-loss (5% trading, 3% simulation)
- **maxRisk**: Maximum risk per trade (5%)
- **priceSanity**: Stale price guard (converts to market order if deviation > 5%)

### Exchange Settings

- **name**: Exchange name (`simulator`, `okx`, `binance`, `coinbase`, `hyperliquid`)
- **testnet**: Use testnet environment (true for testing)
- **marketType**: `spot` or `swap` (aliases: `perp`, `perpetual` map to `swap`)

### Market Type-Aware Risk Parameters

The system automatically validates and adjusts risk parameters based on `marketType`:

**Spot Market (`marketType: "spot"`):**

- Leverage: Clamped to `1x - 1x` (no leverage)
- Stop Loss: Range `3% - 7%`
- Max Risk: Range `3% - 5%`
- Max Positions: Range `6 - 10`

**Swap/Perp Market (`marketType: "swap"`):**

- Leverage: Clamped to `3x - 10x`
- Stop Loss: Range `1% - 2%`
- Max Risk: Range `1% - 2%`
- Max Positions: Range `1 - 4`

**Startup Validation:**

- Checks all risk parameters against allowed ranges
- Automatically adjusts out-of-range values with warnings
- Displays summary of effective risk parameters

### Instrument Selection (OKX)

- In derivatives mode, Quanta targets OKX USDT-margined perp contracts
- Symbols normalized to `BASE/USDT:USDT` internally
- Examples: `ETH` → `ETH/USDT:USDT`, `ETH-USDT-SWAP` → `ETH/USDT:USDT`

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

## Examples

### Conservative

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

### Aggressive

```json
{
  "trading": {
    "coins": ["BTC", "ETH", "SOL", "BNB"],
    "maxPositions": 10,
    "stopLoss": 0.05,
    "maxRisk": 0.1
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

# Show effective configuration
quanta config show
```

### Configuration Conflicts

Priority order (highest to lowest):

1. Command-line arguments
2. Environment variables
3. `config/config.json`
4. Default values

### Common Issues

**Issue:** Values not taking effect  
**Solution:** Check priority order - environment variables override config file

**Issue:** Invalid JSON syntax  
**Solution:** Use `quanta config validate` to check syntax

**Issue:** Missing required fields  
**Solution:** Use `quanta config init` to create from example

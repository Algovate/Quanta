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

### Simulation Settings in `config/config.json`

Simulation is now configured under the `simulation` section of `config/config.json`:

```json
{
  "simulation": {
    "simulation": {
      "enabled": true,
      "defaultInitialBalance": 10000,
      "defaultMaxPositions": 6,
      "defaultAI": "mock",
      "autoRun": false,
      "confirmBeforeExecute": true
    },
    "scenarios": {
      "defaultCoins": ["BTC", "ETH", "SOL"],
      "testScenarios": ["bullish", "bearish", "sideways", "volatile"]
    },
    "risk": {
      "minConfidence": 0.5,
      "maxRiskPerTrade": 0.05,
      "maxTotalRisk": 0.3,
      "stopLoss": 0.03,
      "takeProfit": 0.06
    },
    "logging": {
      "verbose": false,
      "logTrades": true,
      "logPositions": true,
      "logRiskMetrics": true,
      "saveResults": false,
      "resultsDir": "./results"
    },
    "performance": {
      "trackPnL": true,
      "trackDrawdown": true,
      "calculateSharpeRatio": true,
      "benchmark": "BTC"
    },
    "ai": {
      "mock": {
        "signalInterval": 10000,
        "confidenceRange": { "min": 0.5, "max": 0.95 }
      },
      "real": {
        "apiKey": "",
        "model": "deepseek/deepseek-chat",
        "temperature": 0.7,
        "maxRetries": 3,
        "timeout": 30000
      }
    }
  }
}
```

## Prompt Groups

The AI trading agent uses externalized prompt configurations stored in `config/prompts/` directory. Each prompt group is a JSON file containing:

- `metadata`: Group name, description, and version
- `system`: System prompt template with Mustache-style variables (e.g., `{{tradableCoins}}`)
- `user`: User prompt template with Mustache-style variables

The active prompt group is specified via `ai.prompt.activeGroup` in the configuration file or `PROMPT_ACTIVE_GROUP` environment variable.

### Available Groups

- `default`: Balanced risk + technical analysis prompt (baseline)
- `nofx`: NoFX-inspired staged decision framework with strict JSON output and risk guardrails

To switch groups, set in `config/config.json`:

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

**Viewing Prompts:**

You can view the current prompts using the CLI command:

```bash
# View current active prompt group
quanta prompts view

# View rendered prompts with example values
quanta prompts view --rendered

# List all available prompt groups
quanta prompts view --list
```

See `config/prompts/README.md` for details on creating and using prompt groups, and [Command Reference](commands.md#prompt-commands) for complete command documentation.

## Configuration Priority

### For Trading Commands

1. Command-line arguments (highest)
2. Environment variables
3. `config/config.json`
4. Default values (lowest)

### For Simulation Command

1. Command-line arguments (highest)
2. `config/config.json` → `simulation` section
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

# AI Prompt
PROMPT_ACTIVE_GROUP=default
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

# Logging (Lite Mode)
# Override JSONL log directory (defaults to ./logs/text)
LOG_DIR=/absolute/path/to/logs/text
```

### Logging (Lite Mode)

You can optionally set logging defaults in `config/config.json` under `logging`:

```json
{
  "logging": {
    "level": "info",
    "textLogDir": "./logs/text",
    "retentionDays": 7
  }
}
```

- `level`: Text log capture level for the JSONL writer.
- `textLogDir`: Directory for JSONL text logs. Environment variable `LOG_DIR` overrides this.
- `retentionDays`: Keep daily-rotated JSONL files for this many days.

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

### Backtesting Defaults

- If dates are not fully specified, backtesting defaults to a 4-month window.
  - No `--start` and no `--end` → last 4 months ending today
  - Only `--start` → `--end` is 4 months after `--start`
  - Only `--end` → `--start` is 4 months before `--end`
- `--seed` enables deterministic results (historical data, slippage, and RNG use the seed).

### Exchange Settings

- **name**: Exchange name (`simulator`, `okx`, `binance`, `coinbase`, `hyperliquid`)
- **testnet**: Use testnet environment (true for testing)
- **marketType**: `spot` or `swap` (aliases: `perp`, `perpetual` map to `swap`). Affects leverage support, funding, and symbol routing.

### MarketType-Aware Defaults and Guards

The system automatically validates and adjusts risk parameters based on `marketType` to ensure safe trading practices.

**Spot Market (`marketType: "spot"`):**

- **Leverage**: Clamped to `1x - 1x` (no leverage allowed)
- **Stop Loss**: Range `3% - 7%`
- **Max Risk**: Range `3% - 5%`
- **Max Positions**: Range `6 - 10`

**Swap/Perp Market (`marketType: "swap"`, "perp", or "perpetual"):**

- **Leverage**: Clamped to `3x - 10x` (leverage supported)
- **Stop Loss**: Range `1% - 2%`
- **Max Risk**: Range `1% - 2%`
- **Max Positions**: Range `1 - 4`

**Startup Validation:**

At startup, the system:

1. Checks all risk parameters against the allowed ranges for the selected `marketType`
2. Automatically adjusts out-of-range values with a warning (e.g., `[risk-guard] Clamped leverage.min: 5 -> 1`)
3. Displays a summary of all effective risk parameters:

```
[risk-guard] Clamped leverage.min: 5 -> 1 for marketType=spot
[risk-guard] Clamped leverage.max: 40 -> 1 for marketType=spot
[risk-guard] Risk parameters for marketType=spot:
   Leverage: 1x - 1x
   Stop Loss: 5.0% (range: 3.0% - 7.0%)
   Max Risk: 5.0% (range: 3.0% - 5.0%)
   Max Positions: 6 (range: 6 - 10)
```

**Note**: Only parameters that are adjusted will show warnings. Parameters within the allowed range will be displayed in the summary without warnings.

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

# Show effective configuration (includes env overrides)
quanta config show
```

### Configuration Conflicts

Priority order (highest to lowest):

1. Command-line arguments
2. Environment variables
3. `config/config.json`
4. Default values

```bash
# Clear environment overrides
unset OPENROUTER_API_KEY

# Use config file only
quanta config show

# Reset and reinit
quanta config reset
quanta config init
```

### Common Issues

**Issue**: Values not taking effect

- **Solution**: Check priority order - environment variables override config file
- **Solution**: Restart the application after changing configuration

**Issue**: Invalid JSON syntax

- **Solution**: Use `quanta config validate` to check syntax
- **Solution**: Use a JSON validator online or in your editor

**Issue**: Missing required fields

- **Solution**: Use `quanta config init` to create from example
- **Solution**: Check [Configuration Guide](configuration.md) for required fields

---

**Last Updated**: January 2025  
**Version**: 0.3.0

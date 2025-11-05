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
    "priceSanity": { "enabled": true, "maxDeviation": 0.05 },
    "funding": { "warnings": true }
  }
}
```

**Key fields:**

- `mode`: `strategy` (single) or `arena` (multi-drone)
- `env`: `simulate` (mock), `paper` (real data, simulated execution), `live` (real trading)
- `exchange.marketType`: `spot` or `swap` (affects leverage and risk parameters)

### Simulation Settings

Configured under `simulation` in `config/config.json`:

```json
{
  "simulation": {
    "simulation": {
      "defaultInitialBalance": 10000,
      "defaultMaxPositions": 6,
      "defaultAI": "mock"
    },
    "risk": {
      "minConfidence": 0.5,
      "stopLoss": 0.03,
      "maxRiskPerTrade": 0.05,
      "maxTotalRisk": 0.3
    }
  }
}
```

**Note:** Simulation uses different defaults than trading:

- **Confidence threshold**: 0.5 (50%) vs trading 0.55 (55%)
- **Stop loss**: 3% vs trading 5%

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
# Mode/Environment (preferred)
QUANTA_MODE=strategy   # or arena
QUANTA_ENV=paper       # or live|simulate

# Exchange
EXCHANGE_NAME=okx
EXCHANGE_API_KEY=your_key
EXCHANGE_API_SECRET=your_secret
EXCHANGE_MARKET_TYPE=swap    # or spot; aliases 'perp'/'perpetual' → swap

# AI
OPENROUTER_API_KEY=your_key
OPENROUTER_MODEL=deepseek/deepseek-chat-v3-0324  # or use AI_MODEL (legacy)
OPENROUTER_BASE_URL=https://openrouter.ai/api/v1  # optional, defaults to https://openrouter.ai/api/v1
AI_MODEL=deepseek/deepseek-chat-v3-0324  # legacy, prefer OPENROUTER_MODEL
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

# Logging
# Override JSONL log directory (defaults to ./logs/text)
LOG_DIR=/absolute/path/to/logs/text
```

### Logging

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

- **apiKey**: OpenRouter API key (required, set via `OPENROUTER_API_KEY` env var or `ai.apiKey` in config)
- **model**: AI model (default: `deepseek/deepseek-chat-v3-0324`, set via `OPENROUTER_MODEL` env var or `ai.model` in config)
- **temperature**: Creativity level (default: 0.7)
- **baseUrl**: OpenRouter API base URL (optional, defaults to `https://openrouter.ai/api/v1`, set via `OPENROUTER_BASE_URL` env var or `ai.baseUrl` in config)

**OpenRouter Configuration Validation:**

At startup, the system validates OpenRouter configuration:

- API key must be present and non-empty
- Model must be non-empty
- Base URL format is validated if provided (must be a valid HTTP/HTTPS URL)

If validation fails, the system will fail fast with a clear error message indicating what needs to be fixed.

**Stop-on-AI-Error Behavior:**

When AI client errors occur (4xx status codes such as invalid API key, missing configuration, or payment required), the workflow will stop immediately with clear logging. This prevents the system from continuing to run with invalid AI configuration. Errors that indicate configuration problems (4xx) are distinguished from transient errors (5xx, network errors) which may be retried.

**Configuration Priority:**

1. Environment variables (`OPENROUTER_API_KEY`, `OPENROUTER_MODEL`, `OPENROUTER_BASE_URL`)
2. `config.json` values (`ai.apiKey`, `ai.model`, `ai.baseUrl`)
3. Default values (model: `deepseek/deepseek-chat-v3-0324`, baseUrl: `https://openrouter.ai/api/v1`)

### Trading Settings

- **coins**: List of cryptocurrencies to trade
- **maxPositions**: Maximum concurrent positions
- **stopLoss**: Default stop-loss (5% trading, 3% simulation)
- **maxRisk**: Maximum risk per trade (5%)
- **priceSanity**: Stale price guard (converts to market order if deviation > 5%)

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

### Conservative

- `coins`: `["BTC"]`
- `maxPositions`: `2`
- `stopLoss`: `0.02` (2%)
- `maxRisk`: `0.02` (2%)

### Aggressive

- `coins`: `["BTC", "ETH", "SOL", "BNB"]`
- `maxPositions`: `10`
- `stopLoss`: `0.05` (5%)
- `maxRisk`: `0.1` (10%)

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

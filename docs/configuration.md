# Configuration Guide

Complete guide to Quanta system configuration.

## Configuration Files

### Main Configuration: `config/config.json`

```json
{
  "mode": "single",
  "env": "simulate",
  "exchange": {
    "name": "okx",
    "testnet": true,
    "marketType": "spot",
    "apiKey": "your_api_key",
    "apiSecret": "your_api_secret"
  },
  "ai": {
    "provider": "openrouter",
    "temperature": 0.7,
    "openrouter": {
      "apiKey": "sk-or-v1-your-api-key-here",
      "model": "deepseek/deepseek-chat-v3-0324",
      "baseUrl": "https://openrouter.ai/api/v1"
    },
    "ollama": {
      "model": "llama2",
      "baseUrl": "http://localhost:11434"
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

**Key Fields:**

- `mode`: `single` (single workflow) or `arena` (multi-drone arena)
- `env`: `simulate`, `paper`, or `live`
- `exchange.marketType`: `spot` or `swap` (affects leverage and risk parameters)

## Configuration Priority

1. **Command-line arguments** (highest)
2. **Environment variables**
3. `config/config.json`
4. **Default values** (lowest)

## Environment Variables

### Mode/Environment

```bash
QUANTA_MODE=single   # or arena
QUANTA_ENV=paper     # or live|simulate
```

### Exchange

```bash
EXCHANGE_NAME=okx
EXCHANGE_API_KEY=your_key
EXCHANGE_API_SECRET=your_secret
EXCHANGE_MARKET_TYPE=swap    # or spot; 'perp'/'perpetual' → swap
```

### AI

**Multi-Provider Support:**

```bash
# Select provider (default: openrouter)
AI_PROVIDER=openrouter  # or 'openai', 'dashscope', 'deepseek', 'ollama'

# OpenRouter (default)
OPENROUTER_API_KEY=your_key
OPENROUTER_MODEL=deepseek/deepseek-chat-v3-0324
OPENROUTER_BASE_URL=https://openrouter.ai/api/v1  # optional

# OpenAI
OPENAI_API_KEY=your_key
OPENAI_MODEL=gpt-4
OPENAI_BASE_URL=https://api.openai.com/v1  # optional

# DashScope (Alibaba Cloud Tongyi Qianwen)
DASHSCOPE_API_KEY=your_key
DASHSCOPE_MODEL=qwen-max
DASHSCOPE_BASE_URL=https://dashscope.aliyuncs.com/api/v1  # optional

# Deepseek
DEEPSEEK_API_KEY=your_key
DEEPSEEK_MODEL=deepseek-chat
DEEPSEEK_BASE_URL=https://api.deepseek.com/v1  # optional

# Ollama (local or remote instance)
OLLAMA_MODEL=llama2  # or 'mistral', 'qwen', 'llama3', etc.
OLLAMA_BASE_URL=http://localhost:11434  # optional (defaults to http://localhost:11434)
OLLAMA_API_KEY=  # optional (not required for local instances)

# Global temperature (can be overridden per provider)
AI_TEMPERATURE=0.7
```

**Legacy Support:** Old `OPENROUTER_API_KEY`, `OPENROUTER_MODEL`, and `OPENROUTER_BASE_URL` environment variables are still supported.

### AI Prompts

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

### Logs

```bash
LOG_DIR=/absolute/path/to/logs/text  # Override JSONL log directory
```

## Prompt Groups

Prompt groups are stored in `config/prompts/`. Each group contains:

- `metadata`: Name, description, version
- `system`: System prompt template (Mustache variables)
- `user`: User prompt template (Mustache variables)

**Available Groups:**

- `default`: Balanced risk + technical analysis
- `nofx`: NoFX-style phased decision framework

**Switch Groups:**

```json
{
  "ai": {
    "prompt": {
      "activeGroup": "nofx"
    }
  }
}
```

Or via environment variable:

```bash
PROMPT_ACTIVE_GROUP=nofx
```

**View Prompts:**

```bash
quanta prompts view                    # View current active group
quanta prompts view --rendered         # View rendered prompts
quanta prompts list                    # List all groups
```

## Key Settings

### AI Settings

- **apiKey**: API key (required for most providers, optional for Ollama, set via provider-specific env vars or `ai.{provider}.apiKey`)
- **model**: AI model (default varies by provider)
- **temperature**: Creativity level (default: 0.7)
- **baseUrl**: API base URL (optional)

**Configuration Priority:**

1. Environment variables (provider-specific)
2. `config.json` values (`ai.{provider}.*`)
3. Default values

**AI Providers:**

- **OpenRouter**: Default provider, supports multiple models via OpenRouter.ai
- **OpenAI**: Official OpenAI API (GPT models)
- **DashScope**: Alibaba Cloud Tongyi Qianwen (Qwen models)
- **Deepseek**: Official Deepseek API
- **Ollama**: Local or remote Ollama instance (no API key required for local instances)

**Ollama Setup:**

1. Install Ollama: https://ollama.ai
2. Pull a model: `ollama pull llama2` (or `mistral`, `qwen`, `llama3`, etc.)
3. Start Ollama: `ollama serve` (usually runs automatically)
4. Configure in `config.json`:
   ```json
   {
     "ai": {
       "provider": "ollama",
       "ollama": {
         "model": "llama2",
         "baseUrl": "http://localhost:11434"
       }
     }
   }
   ```

**AI Error Handling**: When AI client errors (4xx status codes), workflow stops immediately with clear logs.

### Trading Settings

- **coins**: List of cryptocurrencies to trade
- **maxPositions**: Maximum concurrent positions
- **stopLoss**: Default stop loss (5% trading, 3% simulation)
- **maxRisk**: Maximum risk per trade (5%)
- **priceSanity**: Price staleness protection (converts to market order if deviation > 5%)

### Exchange Settings

- **name**: Exchange name (`simulator`, `okx`, `binance`, `coinbase`, `hyperliquid`)
- **testnet**: Use testnet environment (true for testing)
- **marketType**: `spot` or `swap` (aliases: `perp`, `perpetual` map to `swap`)

### Market Type Risk Parameters

System automatically validates and adjusts risk parameters based on `marketType`:

**Spot Market** (`marketType: "spot"`):

- Leverage: Fixed at `1x - 1x` (no leverage)
- Stop Loss: Range `3% - 7%`
- Max Risk: Range `3% - 5%`
- Max Positions: Range `6 - 10`

**Contract/Perpetual Market** (`marketType: "swap"`):

- Leverage: Range `3x - 10x`
- Stop Loss: Range `1% - 2%`
- Max Risk: Range `1% - 2%`
- Max Positions: Range `1 - 4`

**Startup Validation:**

- Checks all risk parameters are within allowed ranges
- Auto-adjusts out-of-range values with warnings
- Displays effective risk parameters summary

### Contract Selection (OKX)

- In derivatives mode, Quanta uses OKX USDT-margined perpetual contracts
- Symbols internally standardized to `BASE/USDT:USDT`
- Example: `ETH` → `ETH/USDT:USDT`, `ETH-USDT-SWAP` → `ETH/USDT:USDT`

## CLI Configuration

```bash
quanta config show      # Show current configuration
quanta config set ai.model deepseek/deepseek-chat-v3-0324
quanta config validate  # Validate configuration
quanta config save      # Save configuration
quanta config reset     # Reset to defaults
quanta config init      # Initialize from example
```

## Configuration Examples

### Conservative Configuration

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

### Aggressive Configuration

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

**Configuration not loaded**: Check file exists `cat config/config.json`, validate JSON `quanta config validate`

**Configuration conflicts**: Check priority order (command-line > environment variables > config.json > defaults)

**Values not taking effect**: Environment variables override configuration file

**Invalid JSON**: Use `quanta config validate` to check syntax

**Missing required fields**: Use `quanta config init` to create from example

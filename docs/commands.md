### API Server Execution Exclusivity

When starting trading via API routes, the server enforces a single active execution session at any time. Attempts to start an Arena while a Strategy is running (or vice versa) will be rejected with a clear error. Use the `/api/system/session` endpoint to inspect the current session.

# Command Reference

Complete reference for all Quanta commands.

## Top-Level Commands

```
quanta
├── trade      Trading operations (5 sub-commands)
├── test       Testing and validation (2 sub-commands)
├── config     Configuration management (6 sub-commands)
├── simulate   Simulation and demonstration (1 sub-command)
├── server     Web server for trading UI (3 sub-commands)
├── log        Log viewing (console; Lite mode)
├── prompts    Prompt group management (1 sub-command)
└── help       Show help information
```

## Trading Commands

### `trade start` - Start AI Trading System

Start the trading system specifying runtime mode and environment.

```bash
quanta trade start [options]

Options:
  -m, --mode <mode>        Runtime mode: arena or strategy (default: "strategy")
  -e, --env <env>          Environment: simulate, paper, live (default: "simulate")
  -c, --coins <coins>       Comma-separated list of coins (default: "BTC,ETH,SOL")
```

**Examples:**

```bash
# Strategy · Sim (default)
quanta trade start --mode strategy --env simulate --coins BTC,ETH,SOL

# Strategy · Paper (real data, simulated execution)
quanta trade start --mode strategy --env paper --coins BTC,ETH,SOL

# Strategy · Live (requires API keys)
quanta trade start --mode strategy --env live --coins BTC

# Note: For backtesting, use the dedicated command:
# quanta trade backtest --start 2024-01-01 --end 2024-12-31
```

**Startup Output:**

The command displays minimal startup information:

```
🏆 Quanta Trading System
Mode: strategy | Env: paper | Coins: BTC, ETH, SOL
✔ Trading system initialized
🚀 Trading started. Use "quanta log view" to view detailed output.
```

Configuration display includes:

```
📊 Configuration:
   Mode: strategy
   Env: paper
   Exchange: Paper (OKX, testnet)
   Market Type: spot
```

Risk parameter validation:

- Shows warnings for parameters that are adjusted (e.g., `[risk-guard] Clamped leverage.min: 5 -> 1`)
- Displays a summary of all effective risk parameters with their allowed ranges:

```
[risk-guard] Risk parameters for marketType=spot:
   Leverage: 1x - 1x
   Stop Loss: 5.0% (range: 3.0% - 7.0%)
   Max Risk: 5.0% (range: 3.0% - 5.0%)
   Max Positions: 6 (range: 6 - 10)
```

- Parameters within the allowed range are shown without warnings
- Only adjusted parameters show warning messages

**Note:** Detailed cycle summaries (account status, risk status, positions, etc.) are no longer displayed directly in the console. Use `quanta log view` to view detailed output:

```bash
# View detailed console output
quanta log view

# Follow in real-time (like tail -f)
quanta log view --follow

# View with specific context or level
quanta log view --context Workflow --level info
```

---

### `trade pause` - Pause Trading System

Temporarily pause the trading system.

```bash
quanta trade pause [options]

Options:
  --reason <reason>  Reason for pausing (default: "Manual pause")
```

**Examples:**

```bash
# Pause with reason
quanta trade pause --reason "Maintenance window"

# Standard pause
quanta trade pause
```

---

### `trade stop` - Stop Trading System

Stop the running trading system.

```bash
quanta trade stop [options]

Options:
  --graceful  Graceful shutdown (finish current trades) (default: false)
  --force     Force immediate stop (default: false)
```

**Examples:**

```bash
# Graceful stop (recommended)
quanta trade stop --graceful

# Force stop (emergency)
quanta trade stop --force
```

---

### `trade status` - Show Status

Show current trading status.

```bash
quanta trade status
```

**Output:**

```
📊 Quanta Status
==========================================
⚙️  Configuration:
   Mode: strategy
   Env: simulate
   Coins: BTC, ETH, SOL
   Max Positions: 6
   Cycle Period: 180s
   Stop Loss: 5.0%

🤖 AI Configuration:
   Model: deepseek/deepseek-chat-v3-0324
   Temperature: 0.7
```

---

### `trade backtest` - Run Backtest

Run backtest with historical data. Results display with enhanced formatting and detailed metrics.

```bash
quanta trade backtest [options]

Options:
  -c, --coins <coins>                 Comma-separated list of coins (default: "BTC,ETH,SOL")
  -s, --start <date>                  Start date (YYYY-MM-DD)
  -e, --end <date>                    End date (YYYY-MM-DD)
  --initial-balance <amount>          Initial balance (default: "10000")
  --seed <number>                     Seed for deterministic randomness (default: none)
  --verbose                           Verbose output
  --quiet                             Minimal output (summary + errors)
  --json                              Output raw JSON
  --no-progress                       Disable progress bar
  --update-interval <ms>              UI update interval in ms (default: 750)
  --cycle-sample <n>                  Print every N cycles (default: 10)
  --equity-delta-pct <pct>            Print when equity % change ≥ pct (default: 0.001)
  --upnl-delta <usd>                  Print when UPNL $ change ≥ usd (default: 10)
  --exposure-delta-pct <pct>          Print when exposure % change ≥ pct (default: 0.1)
  --leverage-delta <val>              Print when leverage absolute change ≥ val (default: 0.2)
  --dd-steps <steps>                  Drawdown alert steps, comma-separated (e.g., 5,10,15)
  --summary-only                      Only print executive summary line
  --no-risks                          Hide Risk Metrics section
  --no-signals                        Hide Signal Statistics section
  --no-equity                         Hide Equity Curve section
```

Defaults:

- If neither `--start` nor `--end` is provided, the default span is the last 4 months.
- If only `--start` is provided, `--end` defaults to 4 months later.
- If only `--end` is provided, `--start` defaults to 4 months earlier.

**Examples:**

```bash
# Default (last 4 months)
quanta trade backtest

# Fixed window
quanta trade backtest --start 2024-06-01 --end 2024-10-01

# Deterministic run with reduced noise
quanta trade backtest --seed 42 --no-signals --no-equity --cycle-sample 20

# Summary line only
quanta trade backtest --summary-only
```

**Report Sections:**

The backtest output includes:

- **Signal Statistics**: Generated, accepted, rejected signals with acceptance rate
- **Performance Summary**: Total return, P&L, annualized return, Sharpe ratio, max drawdown
- **Trade Statistics**: Win/loss breakdown with visual progress bar, average profit/loss, best/worst trades
- **Risk Metrics**: Volatility, VaR, max drawdown value, largest win/loss
- **Equity Curve**: Peak and lowest equity, positive periods percentage

All metrics use color coding (green/yellow/red) based on performance thresholds and include locale-formatted numbers with commas for thousands.

---

## Testing Commands

### `test ai` - Test AI Integration

Test AI integration (Mock and Real AI).

```bash
quanta test ai [options]

Options:
  -t, --type <type>  AI type to test: mock, real, or both (default: "both")
  -c, --coin <coin>  Coin to test (default: "BTC")
  -v, --verbose       Show detailed output (default: false)
```

**Examples:**

```bash
# Test Mock AI
quanta test ai --type mock --coin BTC

# Test Real AI
quanta test ai --type real --coin BTC

# Test both with details
quanta test ai --type both --verbose
```

---

### `test exchange` - Test Exchange Data

Test exchange connectivity and data retrieval with comprehensive technical analysis.

```bash
quanta test exchange [options]

Options:
  -e, --exchange <exchange>    Exchange to test (default: "simulator")
  -a, --all                    Test all supported exchanges
  -c, --coin <coin>            Coin to test (default: "BTC")
  -t, --timeframe <timeframe>  Timeframe to test (default: "3m")
  -l, --limit <limit>          Number of candles to fetch (default: "20")
  -v, --verbose                Show detailed output when testing all exchanges
```

**Examples:**

```bash
# Test single exchange with detailed analysis
quanta test exchange --exchange okx --coin BTC

# Quick connectivity test of all exchanges
quanta test exchange --all --coin BTC

# Detailed test of all exchanges (comprehensive)
quanta test exchange --all --verbose --coin BTC

# Test simulator (default)
quanta test exchange --coin BTC

# Test with abbreviations
quanta test exchange --exchange bin --coin BTC --timeframe 1h
quanta test exchange --exchange cb --coin ETH
quanta test exchange --exchange hliq --coin SOL
```

**Supported exchanges**: simulator, binance/bin, okx, coinbase/cb, hyperliquid/hliq

---

## Simulation Commands

### `simulate cycle` - Simulate Trade Cycle

Simulate a complete trade cycle.

```bash
quanta simulate cycle [options]

Options:
  -c, --coins <coins>              Comma-separated list of coins (default: "BTC")
  -b, --initial-balance <amount>   Initial balance in USD (default: "10000")
  -v, --verbose                    Show detailed logging (default: false)
  -p, --max-positions <number>     Maximum number of concurrent positions (default: "3")
  --cycles <number>                Number of cycles to run (default: "1")
  --interval <ms>                  Delay between cycles in ms (default: "3000")
  -a, --ai <type>                  AI type: mock or real (default: "mock")
```

**Examples:**

```bash
# Basic simulation
quanta simulate cycle --coins BTC --verbose

# Multi-coin simulation
quanta simulate cycle --coins BTC,ETH,SOL --verbose --max-positions 5

# Multiple continuous cycles (state persists)
quanta simulate cycle --coins BTC,ETH \
  --cycles 5 --interval 3000 --verbose

# Real AI simulation
quanta simulate cycle --coins BTC --ai real --verbose
```

---

## LangSmith Tracing

You can enable rich tracing for AI operations using LangSmith.

Configuration (file): add under `ai.tracing.langsmith` in `config.json`:

```json
{
  "ai": {
    "tracing": {
      "langsmith": {
        "enabled": true,
        "project": "quanta",
        "redact": true,
        "includeSections": { "prompts": true, "response": true, "market": false }
      }
    }
  }
}
```

Environment (optional overrides):

```bash
export LANGCHAIN_API_KEY=lsm_...
export LANGCHAIN_PROJECT=quanta
# optional fine-grained controls (defaults shown)
export LANGSMITH_REDACT=true
export LANGSMITH_INCLUDE_PROMPTS=true
export LANGSMITH_INCLUDE_RESPONSE=true
export LANGSMITH_INCLUDE_MARKET=false
```

Example run (config controls enablement):

```bash
LANGCHAIN_API_KEY=lsm_... \
LANGCHAIN_PROJECT=quanta \
OPENROUTER_API_KEY=sk-or-... \
quanta test ai --type real --coin BTC --verbose
```

If available, a LangSmith run URL is printed after signal generation.

---

## Server Commands

### `server start` - Start API Server

Start the API server for web UI.

```bash
quanta server start [options]

Options:
  -p, --port <port>  Port to listen on (default: "3001")
```

**Examples:**

```bash
# Start on default port
quanta server start

# Start on custom port
quanta server start --port 8080
```

---

### `server stop` - Stop API Server

Stop the running API server.

```bash
quanta server stop
```

**Examples:**

```bash
# Stop the server
quanta server stop
```

---

### `server status` - Check Server Status

Check API server status.

```bash
quanta server status
```

**Examples:**

```bash
# Check if server is running
quanta server status
```

**Output:**

- Shows server status (running/stopped)
- Displays port and basic information

---

## Configuration Commands

### `config show` - Show Configuration

Show current configuration.

```bash
quanta config show [options]
```

---

### `config set <key> <value>` - Set Configuration

Set configuration values.

```bash
quanta config set <key> <value>
```

**Examples:**

```bash
# Set AI model
quanta config set ai.model deepseek/deepseek-chat-v3-0324

# Set temperature
quanta config set ai.temperature 0.7
```

---

### `config validate` - Validate Configuration

Validate current configuration.

```bash
quanta config validate
```

---

### `config save` - Save Configuration

Save current configuration to file.

```bash
quanta config save
```

---

### `config reset` - Reset Configuration

Reset configuration to defaults.

```bash
quanta config reset
```

---

### `config init` - Initialize Configuration

Initialize configuration file from example.

```bash
quanta config init
```

---

## Log Commands (Lite Mode)

### `log view` - View Console Output

View console output logs captured during `trade start` and `server start` commands. This is the primary way to view detailed cycle summaries, account status, risk metrics, and other operational details after starting the trading system.

```bash
quanta log view [options]

Options:
  --lines <n>           Show last N lines (default: 50)
  -f, --follow         Follow mode (real-time updates, like tail -f)
  --context <context>  Filter by logger context (e.g., TradeStart, Server)
  --level <level>      Filter by log level (info|warn|error|debug)
  --grep <pattern>     Search/filter by pattern in message
  --format <format>    Output format (formatted|raw, default: formatted)
```

**Examples:**

```bash
# View last 50 lines from all contexts
quanta log view

# Follow in real-time (like tail -f)
quanta log view --follow

# Follow only trade start output
quanta log view --follow --context TradeStart

# View server startup output
quanta log view --lines 100 --context Server

# Filter by level
quanta log view --level error

# Search for specific pattern
quanta log view --grep "Configuration"

# Raw output (no ANSI color codes)
quanta log view --format raw
```

**Output:**

The command displays console output exactly as it appeared during operation, preserving chalk formatting and colors.

**Follow Mode:**

Use `--follow` or `-f` to watch logs in real-time (similar to `tail -f`). The command polls JSONL text logs every second for new entries and displays them as they're written.

Notes:

- Lite logging writes to daily-rotated JSONL files under `logs/text/` (override via `LOG_DIR`).
- Only `log view` is available; advanced log subcommands are hidden in Lite mode.

---

## Prompt Commands

### `prompts list` - List Prompt Groups

```bash
quanta prompts list
```

Outputs available groups in `config/prompts`, marking the active one.

### `prompts view` - View Prompt Group Content

View raw templates or rendered prompts.

```bash
quanta prompts view [options]

Options:
  -g, --group <name>       Prompt group name (default: from config)
  -r, --rendered           Show rendered prompts with example values
  -s, --system-only        Show only system prompt
  -u, --user-only          Show only user prompt
  --list                   List all available prompt groups (alias for `prompts list`)
  --context <path.json>    Render using values from a JSON file
  --vars                   Show template variables (and presence if context provided)
```

**Examples:**

```bash
# View current active prompt group (raw templates)
quanta prompts view

# View a specific prompt group
quanta prompts view --group default

# View rendered prompts (built-in example context)
quanta prompts view --rendered

# Render with a custom context file and show variable presence
quanta prompts view --rendered --context config/prompts/context.dev.json --vars

# View only system prompt
quanta prompts view --system-only

# List all available prompt groups
quanta prompts list
```

**Output Format:**

Raw mode (default):

```
📝 Prompt Group: default
   Description: Default trading prompt with balanced risk and technical analysis focus
   Version: 1.0.0

=== SYSTEM PROMPT (RAW) ===

You are an expert cryptocurrency trader...

=== USER PROMPT (RAW) ===

Market Snapshot
- Time elapsed: {{elapsedMinutes}} minutes
...

📌 Template Variables:

  System prompt variables:
    {{defaultStopLoss}}
    {{maxLeverage}}
    {{maxPositions}}
    {{maxRiskPerTrade}}
    {{minLeverage}}
    {{tradableCoins}}

  User prompt variables:
    {{accountInfo}}
    {{candlesTA}}
    {{currentTime}}
    {{elapsedMinutes}}
    {{invokeCount}}
    {{positionsInfo}}
    {{sentimentInfo}}
    {{technicalState}}
```

Rendered mode (`--rendered`):

```
📝 Prompt Group: default

Using example values for rendering:

  tradableCoins: BTC, ETH, SOL
  maxPositions: 6
  maxRiskPerTrade: 5
  minLeverage: 5
  maxLeverage: 40
  defaultStopLoss: 5.0
  elapsedMinutes: 15
  currentTime: 2025-01-15T10:30:00.000Z
  invokeCount: 5
  candlesTA: [Example: CANDLES & TECHNICAL ANALYSIS section would appear here]
  accountInfo: [Example: ACCOUNT INFORMATION section would appear here]
  positionsInfo: [Example: POSITIONS section would appear here]
  sentimentInfo: [Example: SENTIMENT section would appear here]
  technicalState: [Example: TECHNICAL STATE section would appear here]

────────────────────────────────────────────────────────────────────────────────

=== SYSTEM PROMPT (RENDERED) ===

You are an expert cryptocurrency trader managing a live perpetual futures portfolio.

## HARD CONSTRAINTS

- Tradable coins: BTC, ETH, SOL
- Maximum 6 concurrent positions
...
```

### `prompts diff` - Diff Prompt Groups

Compare two groups either as raw templates or after rendering.

```bash
quanta prompts diff -g <left> --with <right> [options]

Options:
  -r, --rendered           Render before diffing
  -s, --system-only        Diff only system prompt
  -u, --user-only          Diff only user prompt
  --context <path.json>    Render using values from a JSON file
```

Examples:

```bash
# Raw diff between groups
quanta prompts diff -g default --with conservative

# Rendered diff with explicit context
quanta prompts diff -g default --with aggressive --rendered --context config/prompts/context.dev.json
```

**Notes:**

- By default, shows the active prompt group from configuration (`ai.prompt.activeGroup`)
- Use `--group` to view a specific prompt group
- Raw mode shows the template with `{{variables}}` placeholders
- Rendered mode shows prompts with example values filled in
- Use `--system-only` or `--user-only` to focus on a specific prompt type
- Use `--list` to see all available prompt groups and identify the active one

---

## Quick Reference

### Most Common Commands

```bash
# Quick test
quanta test ai --type mock --coin BTC

# Run simulation
quanta simulate cycle --coins BTC,ETH,SOL --verbose

# Start trading (Strategy · Sim)
quanta trade start --mode strategy --env simulate --coins BTC,ETH,SOL

# View detailed output (cycle summaries, account status, positions, etc.)
quanta log view --follow

# Monitor status
quanta trade status

# Stop trading
quanta trade stop --graceful
```

---

## API Endpoints (for QuantaWeb)

The Quanta server provides RESTful API endpoints for the web interface:

### Health & Status

- `GET /health` — Quick health check (synchronous, fast)
- `GET /health/detailed` — Comprehensive health check with component status
- `GET /api/status` — System status and configuration

### Market Data

- `GET /api/klines/:symbol?timeframe=1h&limit=100` — Fetch candlesticks for a symbol
- `GET /api/market/summary?symbols=BTC%2FUSDT,ETH%2FUSDT&interval=1m` — Current prices and latest kline per symbol

### Running the Server

```bash
# Start the API server
quanta server start

# Or use npm script
npm run api:dev

# Server will be available at:
# http://localhost:3001
```

For more details, see [Error Handling & Resilience](error-handling.md#health-check-endpoints) documentation.

## Arena API (for QuantaWeb)

List endpoints to distinguish running vs historical arenas:

```
GET /api/arena/list       # all arenas (running + persisted)
GET /api/arena/running    # only running arenas
GET /api/arena/history    # non-running (persisted) arenas
```

Per-arena data endpoints (require a running arenaId):

```
GET /api/arena/status/:arenaId
GET /api/arena/:arenaId/positions
GET /api/arena/:arenaId/trades
GET /api/arena/:arenaId/performance-history?timeRange=1H|4H|24H|7D
GET /api/arena/:arenaId/ticker-prices
```

Notes:

- Historical arena detail endpoints may return 404 for non-running arenas; use `/history` to enumerate and build separate flows.
- The web UI should prefer `/running` to auto-select a live arena and avoid 404s when none are running.

---

**Last Updated**: November 2025  
**Version**: 0.5.0 (Lite)

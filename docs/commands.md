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
└── log        Log query and analysis (6 sub-commands)
```

## Trading Commands

### `trade start` - Start AI Trading System

Start the trading system in simulation, paper, or live mode.

```bash
quanta trade start [options]

Options:
  -m, --mode <mode>        Trading mode: simulation, paper, live (default: "simulation")
  -c, --coins <coins>       Comma-separated list of coins (default: "BTC,ETH,SOL")
```

**Examples:**

```bash
# Simulation mode (mock data - recommended for learning)
quanta trade start --mode simulation --coins BTC,ETH,SOL

# Paper trading (real data, simulated execution - recommended for testing)
quanta trade start --mode paper --coins BTC,ETH,SOL

# Live mode (use with caution - requires API keys)
quanta trade start --mode live --coins BTC

# Note: For backtesting, use the dedicated command:
# quanta trade backtest --start 2024-01-01 --end 2024-12-31
```

**Startup Output:**

- Logs show `MarketType` and effective risk parameters (leverage min/max, stopLoss, maxRisk, maxPositions).
- If provided values exceed safe bands for the detected market type, they are clamped and a warning is printed.

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
   Mode: simulation
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

## Log Commands

### `log query` - Query Operations

Query operations with various filters for analysis and debugging.

```bash
quanta log query [options]

Options:
  --cycle-id <id>        Filter by cycle ID
  --type <type>          Filter by operation type (e.g., signal_generation, order_execution)
  --status <status>      Filter by status (running|completed|failed|cancelled)
  --symbol <symbol>      Filter by symbol (e.g., BTC/USDT)
  --trace-id <id>        Filter by trace ID
  --operation-id <id>    Filter by operation ID
  --limit <limit>        Limit number of results (default: 50)
  --offset <offset>      Offset for pagination (default: 0)
  --format <format>      Output format (table|json, default: table)
```

**Examples:**

```bash
# Query all operations
quanta log query

# Filter by cycle
quanta log query --cycle-id 42

# Find failed operations
quanta log query --status failed

# Find signal generation operations
quanta log query --type signal_generation

# Filter by symbol
quanta log query --symbol BTC/USDT

# Combined filters
quanta log query --cycle-id 42 --type order_execution --status failed

# JSON output
quanta log query --format json

# Pagination
quanta log query --limit 20 --offset 0
```

**Output Format:**

```
📋 Operations Query Results
Found 25 operations

┌────────────┬─────────────┬──────────┬──────────┬─────────────┬────────────┐
│ Operation  │ Type        │ Status   │ Symbol   │ Duration    │ Time       │
├────────────┼─────────────┼──────────┼──────────┼─────────────┼────────────┤
│ abc123...  │ signal_gen  │ SUCCESS  │ BTC/USDT │ 1.2s        │ 10:30:15   │
│ def456...  │ order_exec  │ FAILED   │ ETH/USDT │ 0.5s        │ 10:30:20   │
└────────────┴─────────────┴──────────┴──────────┴─────────────┴────────────┘
```

---

### `log stats` - Show Statistics

Show aggregated statistics for operations.

```bash
quanta log stats [options]

Options:
  --cycle-id <id>        Filter by cycle ID
  --type <type>          Filter by operation type
  --format <format>      Output format (table|json, default: table)
```

**Examples:**

```bash
# Overall statistics
quanta log stats

# Filter by cycle
quanta log stats --cycle-id 42

# Filter by operation type
quanta log stats --type signal_generation

# JSON output
quanta log stats --format json
```

**Output Format:**

```
📊 Operation Statistics

📈 Summary:
   Total Operations: 150
   Completed: 142
   Failed: 8
   Error Rate: 5.33%

⏱️  Performance:
   Average Duration: 1.25s
   Min Duration: 0.1s
   Max Duration: 5.8s

🔧 By Operation Type:
   signal_generation: 50
   order_execution: 40
   position_monitoring: 30
```

---

### `log trace <trace-id>` - Show Complete Trace

Display the complete trace for a specific trace ID, showing all operations in the trace.

```bash
quanta log trace <trace-id> [options]

Options:
  --format <format>      Output format (table|json, default: table)
```

**Examples:**

```bash
# View trace
quanta log trace trace-42-1234567890

# JSON output
quanta log trace trace-42-1234567890 --format json
```

**Output Format:**

```
🔍 Operation Trace
Trace ID: trace-42-1234567890 | Cycle ID: 42

Overall Status: COMPLETED | Duration: 2.5s

Operations in Trace:
┌────────────┬─────────────┬──────────┬──────────┬─────────────┬────────────┐
│ Operation  │ Type        │ Status   │ Symbol   │ Duration    │ Time       │
├────────────┼─────────────┼──────────┼──────────┼─────────────┼────────────┤
│ op1-abc... │ signal_gen  │ SUCCESS  │ BTC/USDT │ 1.2s        │ 10:30:15   │
│ op2-def... │ order_exec  │ SUCCESS  │ BTC/USDT │ 0.8s        │ 10:30:16   │
└────────────┴─────────────┴──────────┴──────────┴─────────────┴────────────┘
```

---

### `log search <term>` - Search Operations

Search operations by keyword in messages, errors, and metadata.

```bash
quanta log search <term> [options]

Options:
  --limit <limit>        Limit number of results (default: 50)
  --offset <offset>      Offset for pagination (default: 0)
  --format <format>      Output format (table|json, default: table)
```

**Examples:**

```bash
# Search for errors
quanta log search "API timeout"

# Search with filters
quanta log search "error" --limit 20

# JSON output
quanta log search "signal" --format json
```

**Output Format:**

```
🔎 Search Results for "API timeout"
Found 12 operations

┌────────────┬─────────────┬──────────┬──────────┬─────────────┬────────────┐
│ Operation  │ Type        │ Status   │ Symbol   │ Duration    │ Time       │
├────────────┼─────────────┼──────────┼──────────┼─────────────┼────────────┤
│ ...        │ order_exec  │ FAILED   │ ETH/USDT │ 5.0s        │ 10:30:20   │
└────────────┴─────────────┴──────────┴──────────┴─────────────┴────────────┘
```

---

### `log snapshot [snapshot-id]` - Show Snapshot

Display system snapshot details. Shows latest snapshot if snapshot-id is not provided.

```bash
quanta log snapshot [snapshot-id] [options]

Options:
  --format <format>      Output format (table|json, default: table)
```

**Examples:**

```bash
# View latest snapshot
quanta log snapshot

# View specific snapshot
quanta log snapshot snapshot-abc123

# JSON output
quanta log snapshot --format json
```

**Output Format:**

```
📸 System Snapshot
Timestamp: 10:30:00 | Cycle: 42

💰 Account:
   Equity: $10000.00
   Balance: $9500.00
   Margin Used: $500.00
   Available Margin: $9500.00

📊 Positions:
   BTC/USDT LONG: 0.1 @ $45000.00 | P&L: $50.00
   ETH/USDT SHORT: 0.5 @ $3000.00 | P&L: -$25.00

📈 System Metrics:
   uptime: 3600
   errorRate: 0.05
   avgCycleTime: 2.5
   memoryUsage: {"heapUsed":52428800,"heapTotal":104857600,"rss":125829120}

❌ Error Summary:
   ApiError: {"totalCount":3,"affectedSymbols":["BTC/USDT"]}
```

---

### `log storage` - Show Storage Statistics

Display storage layer statistics including operation counts and storage tiers.

```bash
quanta log storage [options]

Options:
  --format <format>      Output format (table|json, default: table)
```

**Examples:**

```bash
# View storage statistics
quanta log storage

# JSON output
quanta log storage --format json
```

**Output Format:**

```
🗄️  Storage Statistics
Current log storage usage

📦 Storage Layers:
   L0 (In-memory Cache): 50 operations
   L1 (Warm Storage): 5 cycles (SQLite - planned)
   L2 (Cold Storage): 20 cycles (Filesystem)
   L3 (Archive Storage): 10 cycles (Compressed)

   Total Operations Stored: 5000
```

---

## Quick Reference

### Most Common Commands

```bash
# Quick test
quanta test ai --type mock --coin BTC

# Run simulation
quanta simulate cycle --coins BTC,ETH,SOL --verbose

# Start trading
quanta trade start --mode simulation --coins BTC,ETH,SOL

# Monitor status
quanta trade status

# Stop trading
quanta trade stop --graceful

# Query logs
quanta log query --status failed
quanta log stats
quanta log snapshot
```

---

## API Endpoints (for QuantaWeb)

- `GET /health` — health check
- `GET /api/status` — system status
- `GET /api/klines/:symbol?timeframe=1h&limit=100` — candlesticks
- `GET /api/market/summary?symbols=BTC%2FUSDT,ETH%2FUSDT&interval=1m` — current prices and latest kline per symbol

Run the server:

```bash
npm run api:dev
# API: http://localhost:3001
```

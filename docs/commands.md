# Command Reference

Complete reference for all Quanta commands.

## Trading Commands

### `trade start` - Start Trading System

Start the trading system.

```bash
quanta trade start [options]

Options:
  -e, --env <env>          Environment: simulate, paper, live (default: "simulate")
  -c, --coins <coins>       Comma-separated list of coins (default: "BTC,ETH,SOL")
```

**Examples:**

```bash
# Strategy · Sim (default)
quanta trade start --env simulate --coins BTC,ETH,SOL

# Strategy · Paper (real data, simulated execution)
quanta trade start --env paper --coins BTC,ETH,SOL

# Strategy · Live (requires API keys)
quanta trade start --env live --coins BTC
```

**Note:** For multi-drone arena trading, use `arena` command instead.

### `trade backtest` - Run Backtest

Run backtest with historical data.

```bash
quanta trade backtest [options]

Options:
  -c, --coins <coins>                 Comma-separated list of coins
  -s, --start <date>                  Start date (YYYY-MM-DD)
  -e, --end <date>                    End date (YYYY-MM-DD)
  --initial-balance <amount>          Initial balance (default: "10000")
  --seed <number>                     Seed for deterministic randomness
  --verbose                           Verbose output
  --quiet                             Minimal output
  --json                              Output raw JSON
  --summary-only                      Only print executive summary
```

**Examples:**

```bash
# Default (last 4 months)
quanta trade backtest

# Fixed window
quanta trade backtest --start 2024-06-01 --end 2024-10-01

# Deterministic run
quanta trade backtest --seed 42 --summary-only
```

**Defaults:** If neither `--start` nor `--end` is provided, defaults to last 4 months.

## Testing Commands

### `test ai` - Test AI Integration

Test AI integration (Mock and Real AI).

```bash
quanta test ai [options]

Options:
  -t, --type <type>  AI type: mock, real, or both (default: "both")
  -c, --coin <coin>  Coin to test (default: "BTC")
  -v, --verbose      Show detailed output
```

**Examples:**

```bash
# Test Mock AI
quanta test ai --type mock --coin BTC

# Test Real AI
quanta test ai --type real --coin BTC
```

### `test exchange` - Test Exchange Data

Test exchange connectivity and data retrieval.

```bash
quanta test exchange [options]

Options:
  -e, --exchange <exchange>    Exchange to test (default: "simulator")
  -a, --all                    Test all supported exchanges
  -c, --coin <coin>            Coin to test (default: "BTC")
  -v, --verbose                Show detailed output
```

**Examples:**

```bash
# Test single exchange
quanta test exchange --exchange okx --coin BTC

# Test all exchanges
quanta test exchange --all --coin BTC

# Test with abbreviations
quanta test exchange --exchange bin --coin BTC
```

**Supported exchanges**: simulator, binance/bin, okx, coinbase/cb, hyperliquid/hliq

## Simulation Commands

### `simulate cycle` - Simulate Trade Cycle

Simulate a complete trade cycle.

```bash
quanta simulate cycle [options]

Options:
  -c, --coins <coins>              Comma-separated list of coins
  -b, --initial-balance <amount>    Initial balance in USD
  -v, --verbose                    Show detailed logging
  --cycles <number>                Number of cycles to run
  -a, --ai <type>                  AI type: mock or real
```

**Examples:**

```bash
# Basic simulation
quanta simulate cycle --coins BTC --verbose

# Multiple cycles
quanta simulate cycle --coins BTC,ETH --cycles 5 --verbose
```

**Note:** `simulate cycle` is for single/few cycles. For continuous trading, use `quanta trade start --env simulate`.

## Server Commands

### `server start` - Start API Server

Start the API server for web UI.

```bash
quanta server start [options]

Options:
  -p, --port <port>  Port to listen on (default: "3001")
```

### `server stop` - Stop API Server

Stop the running API server.

```bash
quanta server stop
```

### `server status` - Check Server Status

Check API server status.

```bash
quanta server status
```

## Configuration Commands

### `config show` - Show Configuration

Show current configuration.

```bash
quanta config show
```

### `config set <key> <value>` - Set Configuration

Set configuration values.

```bash
quanta config set ai.model deepseek/deepseek-chat-v3-0324
quanta config set ai.temperature 0.7
```

### `config validate` - Validate Configuration

Validate current configuration.

```bash
quanta config validate
```

### Other Config Commands

```bash
quanta config save      # Save configuration to file
quanta config reset     # Reset to defaults
quanta config init      # Initialize from example
```

## Log Commands

### `log view` - View Console Output

View console output logs captured during `trade start` and `server start`.

```bash
quanta log view [options]

Options:
  --lines <n>           Show last N lines (default: 50)
  -f, --follow         Follow mode (real-time updates)
  --context <context>  Filter by logger context
  --level <level>      Filter by log level (info|warn|error|debug)
  --grep <pattern>     Search/filter by pattern
```

**Examples:**

```bash
# View last 50 lines
quanta log view

# Follow in real-time
quanta log view --follow

# Filter by context
quanta log view --follow --context Workflow
```

### `log clean` - Clean Old Log Files

Delete old log files.

```bash
quanta log clean [options]

Options:
  --all                Delete all log files
  --days <n>          Delete files older than N days
  --force             Skip confirmation prompt
  --dry-run           Show what would be deleted
```

### `log list` - List Log Files

Show available log files with metadata.

```bash
quanta log list [options]

Options:
  --format <format>    Output format: table, json, csv
  --sort <field>      Sort by: date, size, name
```

### `log stats` - Show Log Statistics

Display aggregated statistics from logs.

```bash
quanta log stats [options]

Options:
  --days <n>          Analyze last N days
  --context <context> Filter by context
  --level <level>     Filter by log level
```

### `log export` - Export Logs

Export logs to different formats.

```bash
quanta log export [options]

Options:
  --format <format>   Export format: json, csv, txt
  --output <file>     Output file path (required)
  --days <n>          Export last N days
  --context <context> Filter by context
```

## Prompt Commands

### `prompts list` - List Prompt Groups

List available prompt groups in `config/prompts`.

```bash
quanta prompts list
```

### `prompts view` - View Prompt Group Content

View raw templates or rendered prompts.

```bash
quanta prompts view [options]

Options:
  -g, --group <name>       Prompt group name
  -r, --rendered           Show rendered prompts with example values
  -s, --system-only        Show only system prompt
  -u, --user-only          Show only user prompt
  --context <path.json>    Render using values from a JSON file
  --vars                   Show template variables
```

**Examples:**

```bash
# View current active prompt group
quanta prompts view

# View rendered prompts
quanta prompts view --rendered

# View specific group
quanta prompts view --group default
```

### `prompts diff` - Diff Prompt Groups

Compare two prompt groups.

```bash
quanta prompts diff -g <left> --with <right> [options]

Options:
  -r, --rendered           Render before diffing
  -s, --system-only         Diff only system prompt
  -u, --user-only           Diff only user prompt
```

## Arena Commands

See [Arena Guide](arena-guide.md) for complete arena command documentation.

```bash
quanta arena configs          # List arena configurations
quanta arena start --config <name>  # Start arena
quanta arena status <arenaId> # Check status
quanta arena list             # List all arenas
quanta arena stop <arenaId>   # Stop arena
```

## Quick Reference

### Most Common Commands

```bash
# Quick test
quanta test ai --type mock --coin BTC

# Run simulation
quanta simulate cycle --coins BTC,ETH,SOL --verbose

# Start trading
quanta trade start --env simulate --coins BTC,ETH,SOL

# View detailed output
quanta log view --follow
```

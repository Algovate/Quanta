# Commands Reference

Complete reference for all Quanta commands.

## Trading Commands

### `trade start` - Start Trading System

```bash
quanta trade start [options]

Options:
  -e, --env <env>      Environment: simulate, paper, live (default: "simulate")
  -c, --coins <coins>  Comma-separated coin list (default: "BTC,ETH,SOL")
```

**Examples:**

```bash
quanta trade start --env simulate --coins BTC,ETH,SOL
quanta trade start --env paper --coins BTC,ETH,SOL
quanta trade start --env live --coins BTC
```

> **Note**: For multi-drone arena trading, use `arena` commands.

### `trade backtest` - Run Backtest

```bash
quanta trade backtest [options]

Options:
  -c, --coins <coins>            Comma-separated coin list
  -s, --start <date>             Start date (YYYY-MM-DD)
  -e, --end <date>               End date (YYYY-MM-DD)
  --initial-balance <amount>     Initial balance (default: "10000")
  --seed <number>                Random seed
  --verbose                      Verbose output
  --quiet                        Minimal output
  --json                         JSON output
  --summary-only                 Summary only
```

**Examples:**

```bash
quanta trade backtest
quanta trade backtest --start 2024-06-01 --end 2024-10-01
quanta trade backtest --seed 42 --summary-only
```

> **Default**: Uses last 4 months of data when dates not specified.

## Test Commands

### `test ai` - Test AI Integration

```bash
quanta test ai [options]

Options:
  -t, --type <type>  AI type: mock, real, both (default: "both")
  -c, --coin <coin>  Test coin (default: "BTC")
  -v, --verbose      Verbose output
```

**Examples:**

```bash
quanta test ai --type mock --coin BTC
quanta test ai --type real --coin BTC
```

### `test exchange` - Test Exchange Data

```bash
quanta test exchange [options]

Options:
  -e, --exchange <exchange>  Exchange name (default: "simulator")
  -a, --all                 Test all supported exchanges
  -c, --coin <coin>         Test coin (default: "BTC")
  -v, --verbose             Verbose output
```

**Examples:**

```bash
quanta test exchange --exchange okx --coin BTC
quanta test exchange --all --coin BTC
quanta test exchange --exchange bin --coin BTC
```

**Supported Exchanges**: simulator, binance/bin, okx, coinbase/cb, hyperliquid/hliq

## Simulation Commands

### `simulate cycle` - Simulate Trading Cycle

```bash
quanta simulate cycle [options]

Options:
  -c, --coins <coins>            Comma-separated coin list
  -b, --initial-balance <amount> Initial balance (USD)
  -v, --verbose                  Verbose logs
  --cycles <number>              Number of cycles to run
  -a, --ai <type>               AI type: mock or real
```

**Examples:**

```bash
quanta simulate cycle --coins BTC --verbose
quanta simulate cycle --coins BTC,ETH --cycles 5 --verbose
```

> **Note**: `simulate cycle` is for single or few cycles. For continuous trading, use `quanta trade start --env simulate`.

## Server Commands

```bash
quanta server start [options]  # Start API server (-p, --port <port>)
quanta server stop              # Stop API server
quanta server status            # Check server status
```

## Configuration Commands

```bash
quanta config show              # Show current configuration
quanta config set <key> <value> # Set configuration value
quanta config validate          # Validate configuration
quanta config save              # Save configuration to file
quanta config reset             # Reset to defaults
quanta config init              # Initialize from example
```

**Examples:**

```bash
quanta config set ai.model deepseek/deepseek-chat-v3-0324
quanta config set ai.temperature 0.7
```

## Log Commands

### `log view` - View Console Output

View console logs captured during `trade start` and `server start`.

```bash
quanta log view [options]

Options:
  --lines <n>           Show last N lines (default: 50)
  -f, --follow         Follow mode (real-time updates)
  --context <context>  Filter by context
  --level <level>      Filter by log level (info|warn|error|debug)
  --grep <pattern>     Search/filter pattern
```

**Examples:**

```bash
quanta log view
quanta log view --follow
quanta log view --follow --context Workflow
```

### Other Log Commands

```bash
quanta log clean [--all] [--days <n>] [--force] [--dry-run]  # Clean old logs
quanta log list [--format <format>] [--sort <field>]          # List log files
quanta log stats [--days <n>] [--context <context>]           # Show statistics
quanta log export --output <file> [--format <format>]         # Export logs
```

## Prompts Commands

```bash
quanta prompts list                                    # List prompt groups
quanta prompts view [options]                         # View prompt group content
  -g, --group <name>        Prompt group name
  -r, --rendered            Show rendered prompts (with example values)
  -s, --system-only         System prompts only
  -u, --user-only           User prompts only
  --context <path.json>     Render using values from JSON file
  --vars                    Show template variables
quanta prompts diff -g <left> --with <right> [options] # Compare prompt groups
```

**Examples:**

```bash
quanta prompts view
quanta prompts view --rendered
quanta prompts view --group default
```

## Arena Commands

See [Arena Guide](arena-guide.md) for details.

```bash
quanta arena configs                    # List arena configurations
quanta arena start --config <name>      # Start arena
quanta arena status <arenaId>           # Check status
quanta arena list                       # List all arenas
quanta arena stop <arenaId>             # Stop arena
```

## Quick Reference

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

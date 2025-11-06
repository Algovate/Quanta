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
  --decision-path      Show decision path information
  --days <n>           Show logs from last N days
  --since <date>       Start date (YYYY-MM-DD)
  --until <date>       End date (YYYY-MM-DD)
```

**Examples:**

```bash
quanta log view
quanta log view --follow
quanta log view --follow --context Workflow
quanta log view --decision-path
quanta log view --decision-path --context Workflow --lines 100
```

### `log decisions` - View Trading Decision Analysis

View detailed trading decision analysis including AI reasoning, validation, sizing, and execution steps.

```bash
quanta log decisions [options]

Options:
  --cycle-id <n>       Show decisions for specific cycle ID
  --symbol <symbol>    Filter by symbol/coin
  --since <date>       Start date (YYYY-MM-DD)
  --until <date>       End date (YYYY-MM-DD)
  --days <n>           Show decisions from last N days
  --format <format>    Output format: structured, json, detailed (default: structured)
  -f, --follow         Follow mode (real-time updates)
  --verbose            Show detailed decision factors
```

**Examples:**

```bash
# View all recent decisions
quanta log decisions

# View decisions for a specific cycle
quanta log decisions --cycle-id 42

# View decisions for a specific symbol
quanta log decisions --symbol BTC

# View detailed decision analysis with factors
quanta log decisions --verbose

# Follow decisions in real-time
quanta log decisions --follow

# Export decisions as JSON
quanta log decisions --format json > decisions.json
```

**Output Format:**

The `log decisions` command displays:

- **Cycle-based grouping**: Decisions grouped by trading cycle
- **Signal information**: Symbol, action (LONG/SHORT/HOLD/CLOSE), confidence
- **AI reasoning**: Full reasoning text from AI analysis
- **Validation status**: Whether signals passed risk validation
- **Sizing details**: Position sizing calculations (with `--verbose`)
- **Execution status**: Order execution results (with `--verbose`)

### Other Log Commands

```bash
quanta log clean [--all] [--days <n>] [--force] [--dry-run]  # Clean old logs
quanta log list [--format <format>] [--sort <field>]          # List log files
quanta log stats [--days <n>] [--context <context>]           # Show statistics
quanta log export --output <file> [--format <format>]         # Export logs
```

## Decision Analysis

### Understanding Decision Paths

When viewing logs with `--decision-path` or using `log decisions`, you can see:

1. **Signal Generation**: AI-generated trading signals with reasoning
2. **Risk Validation**: Whether signals passed risk checks
3. **Position Sizing**: Calculated position sizes and leverage
4. **Order Execution**: Actual execution results and slippage

### Decision Path Structure

Each decision path contains:

- **Step**: The decision stage (e.g., `signal_generation`, `execute_signals`)
- **Decision**: The decision made (e.g., "Accepted: 2 (LONG: BTC, ETH)")
- **Reason**: Why the decision was made
- **Confidence**: AI confidence level (0-1)
- **Factors**: Detailed breakdown (signals, validation, sizing, execution)

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

# Command Reference

Complete reference for all Quanta commands.

## Top-Level Commands

```
quanta
├── trade      Trading operations (5 sub-commands)
├── test       Testing and validation (4 sub-commands)
├── config     Configuration management (6 sub-commands)
└── simulate   Simulation and demonstration (1 sub-command)
```

## Trading Commands

### `trade start` - Start AI Trading System

Start the trading system in live or simulation mode.

```bash
quanta trade start [options]

Options:
  -m, --mode <mode>        Trading mode: live, simulation, backtest (default: "simulation")
  -c, --coins <coins>       Comma-separated list of coins (default: "BTC,ETH,SOL")
  --ui <ui>                 UI mode: tui or cli (default: "cli")
```

**Examples:**

```bash
# Simulation mode (recommended)
quanta trade start --mode simulation --coins BTC,ETH,SOL

# Live mode (use with caution)
quanta trade start --mode live --coins BTC
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
   Mode: simulation
   Coins: BTC, ETH, SOL
   Max Positions: 6
   Cycle Period: 180s
   Stop Loss: 3.0%

🤖 AI Configuration:
   Model: deepseek/deepseek-chat
   Temperature: 0.7
```

---

### `trade backtest` - Run Backtest

Run backtest with historical data.

```bash
quanta trade backtest [options]

Options:
  -c, --coins <coins>        Comma-separated list of coins (default: "BTC,ETH,SOL")
  -s, --start <date>         Start date (YYYY-MM-DD) (default: "2024-01-01")
  -e, --end <date>           End date (YYYY-MM-DD) (default: "2024-12-31")
  --initial-balance <amount> Initial balance (default: "10000")
```

**Examples:**

```bash
# Full year backtest
quanta trade backtest --start 2024-01-01 --end 2024-12-31

# Last 30 days
quanta trade backtest --start 2024-11-01 --end 2024-12-01
```

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

### `test kline` - Test K-line Data

Test K-line data retrieval.

```bash
quanta test kline [options]

Options:
  -e, --exchange <exchange>    Exchange to test (default: "simulator")
  -c, --coin <coin>           Coin to test (default: "BTC")
  -t, --timeframe <timeframe>  Timeframe to test (default: "3m")
  -l, --limit <limit>          Number of candles to fetch (default: "20")
```

**Examples:**

```bash
# Test simulator
quanta test kline --exchange simulator --coin BTC

# Test real exchange (full name)
quanta test kline --exchange binance --coin BTC --timeframe 1h

# Test with abbreviations
quanta test kline --exchange bin --coin BTC
quanta test kline --exchange cb --coin ETH
quanta test kline --exchange hliq --coin SOL

# Supported exchanges: simulator, binance/bin, okx, coinbase/cb, hyperliquid/hliq
```

---

### `test exchanges` - Test Multiple Exchanges

Test multiple exchanges.

```bash
quanta test exchanges [options]

Options:
  -c, --coin <coin>           Coin to test (default: "BTC")
  -t, --timeframe <timeframe>  Timeframe to test (default: "3m")
  -l, --limit <limit>          Number of candles to fetch (default: "10")
```

---

### `test data-sources` - Test Data Sources

Test multi-data source configuration.

```bash
quanta test data-sources [options]

Options:
  -c, --coin <coin>           Coin to test (default: "BTC")
  -t, --timeframe <timeframe>  Timeframe to test (default: "3m")
  -l, --limit <limit>          Number of candles to fetch (default: "5")
```

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
  -a, --ai <type>                  AI type: mock or real (default: "mock")
```

**Examples:**

```bash
# Basic simulation
quanta simulate cycle --coins BTC --verbose

# Multi-coin simulation
quanta simulate cycle --coins BTC,ETH,SOL --verbose --max-positions 5

# Real AI simulation
quanta simulate cycle --coins BTC --ai real --verbose
```

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
quanta config set ai.model deepseek/deepseek-chat

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
```

---

## Command Categories

| Category | Commands | Purpose |
|----------|----------|---------|
| **trade** | 5 | Trading operations |
| **test** | 4 | Validation & testing |
| **config** | 6 | Configuration |
| **simulate** | 1 | Simulation |
| **Total** | **16** | - |

noteId: "fdb1bd60b2c911f0b5dcffd87852d11b"
tags: []

---


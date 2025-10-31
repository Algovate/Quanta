# Quanta

AI-powered quantitative trading system with real-time decision making.

## Quick Start

```bash
# Install and build
npm install && npm run build

# Run a complete trade cycle simulation
quanta simulate cycle --coins BTC,ETH,SOL --verbose

# Start trading in simulation mode (mock data)
quanta trade start --mode simulation --coins BTC,ETH

# Start paper trading (real data, simulated execution)
quanta trade start --mode paper --coins BTC,ETH

# Test the system
quanta test ai --type mock --coin BTC
```

### API Server (for QuantaWeb UI)

```bash
# Start REST/WebSocket API on port 3001
npm run api:dev
```

The QuantaWeb UI expects the API at `http://localhost:3001`. Configure the UI via:

```env
NEXT_PUBLIC_QUANTA_API_URL=http://localhost:3001
NEXT_PUBLIC_QUANTA_WS_URL=ws://localhost:3001
```

## Core Features

- **🤖 AI Trading**: OpenRouter integration with multiple AI models
- **📊 Technical Analysis**: Multi-timeframe indicators (EMA, MACD, RSI, ATR)
- **🛡️ Smart Risk Management**: Optimized position sizing, dynamic minimums, 40% cash reserve
- **🔄 Multiple Modes**: Simulation (mock data), Paper (real data, simulated trades), Live (real trading)
- **💼 Portfolio Management**: Multi-coin multi-position support (2-3 concurrent positions)
- **🎯 Mock AI**: Built-in simulated AI for testing without API keys
- **⚡ Real-time Monitoring**: Live trading updates and performance tracking (synchronous console output in interactive mode)
- **📈 Enhanced Backtest Reports**: Visual formatting, progress bars, color-coded metrics, and comprehensive statistics
- **🔧 Production-Grade Resilience**: Automatic retries, circuit breakers, stale data caching, and graceful degradation

## Commands

### Trading

```bash
# Start trading in simulation mode (mock data)
quanta trade start --mode simulation --coins BTC,ETH,SOL

# Start paper trading (real data, simulated execution)
quanta trade start --mode paper --coins BTC,ETH,SOL

# Start live trading (real data, real execution - requires API keys)
quanta trade start --mode live --coins BTC,ETH,SOL

# Run historical backtest with enhanced reporting
quanta trade backtest --start 2024-01-01 --end 2024-04-01 --coins BTC,ETH --initial-balance 10000

# Other trading commands
quanta trade pause --reason "Maintenance"
quanta trade stop --graceful
quanta trade status
```

### Simulation

```bash
# Multi-coin portfolio simulation (Mock AI)
quanta simulate cycle --coins BTC,ETH,SOL --verbose --max-positions 5

# Use real AI (requires OPENROUTER_API_KEY)
quanta simulate cycle --coins BTC,ETH --ai real --verbose
```

### Testing

```bash
quanta test ai --type mock --coin BTC
quanta test kline --exchange simulator --coin BTC
quanta test exchanges --coin BTC --timeframe 3m
```

### Configuration

```bash
quanta config show
quanta config set ai.model deepseek/deepseek-chat
quanta config validate
```

## Configuration

### Environment Variables

```bash
# AI
OPENROUTER_API_KEY=your_key

# Exchange
EXCHANGE_API_KEY=your_key
EXCHANGE_API_SECRET=your_secret
```

Additional runtime configuration is managed via JSON files in `config/` (see below) and can be inspected/modified through CLI commands.

### Configuration Files

- **Trading**: `config/config.json`
- **Simulation**: `config/simulate.json` (independent from trading config)

## Architecture

```
Perception → Decision → Execution
    ↓           ↓          ↓
Market Data → AI Analysis → Risk Mgmt + Orders
```

## Documentation

- 📖 [Getting Started](docs/getting-started.md)
- 🎯 [Trading Guide](docs/trading-guide.md)
- 🔧 [Configuration](docs/configuration.md)
- 🧪 [Testing &amp; Simulation](docs/testing-simulation.md)
- 📚 [Command Reference](docs/commands.md)
- 💡 [Core Concepts](docs/concepts.md)
- 🏦 [Supported Exchanges](docs/exchanges.md)
- 📝 [Logging Guide](docs/logging-guide.md)
- 🛡️ [Error Handling & Resilience](docs/error-handling.md)

## Important Concepts (Updated)

### P&L Definitions

- **Total P&L** = Current Equity − Initial Balance (includes realized + unrealized).
- **Unrealized P&L** = Sum of open positions' unrealized P&L.
- **Cycle P&L** = Equity change during the current cycle.

Console output shows both Total P&L and Unrealized P&L explicitly.

### Logging Behavior

- Foreground (interactive terminal): console output is synchronous to preserve event order; structured logs still persist to files.
- Background (non-TTY): buffered logger outputs to both console and files for efficiency.

### Execution Messages

- Use actual order fill price when available.
- Notional/Margin in execution lines are estimates and labeled as "Est."; authoritative values are shown in the positions table.

### Event Bus (Timestamps)

Cycle events include timestamps for reliable ordering:

- `cycle:start` { cycleCount, timestamp, startTime }
- `cycle:signals` { cycleCount, timestamp, signalCount, signals[] }
- `cycle:execution` { cycleCount, timestamp, executedSignals, totalTrades }
- `cycle:complete` { cycleCount, timestamp, duration, totalSignals, totalTrades, totalPnl }

### Close Order Safeguards (Simulation/Backtest)

To prevent accidental reverse positions when closing:

- Full-close tolerance: within 1% size difference is treated as a full close.
- New reverse position opens only if remaining amount > 5% of the original size.

## Development

```bash
npm run dev      # Development mode
npm run build    # Build project
npm run lint     # Lint code
npm run type-check  # TypeScript type checks (no emit)
npm run format   # Format code
```

## Risk Warning

⚠️ **CRITICAL**: This software is for educational purposes only. Cryptocurrency trading involves substantial risk. Never trade with money you cannot afford to lose.

## License

MIT License - see LICENSE file for details.

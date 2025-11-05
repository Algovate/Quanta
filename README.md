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

The API server has been moved to a separate package `@quanta/server`. To use the API server:

```bash
# Install and run the API server package
cd QuantaServer
npm install && npm run build
npm start
```

The QuantaWeb UI expects the API at `http://localhost:3001`. Configure the UI via:

```env
NEXT_PUBLIC_QUANTA_API_URL=http://localhost:3001
NEXT_PUBLIC_QUANTA_WS_URL=ws://localhost:3001
```

See [QuantaServer/README.md](../QuantaServer/README.md) for more details.

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
quanta test exchange --exchange simulator --coin BTC
quanta test exchange --all --coin BTC
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
- **Simulation**: `config/config.json` → `simulation` section

## Architecture

```
Perception → Decision → Execution
    ↓           ↓          ↓
Market Data → AI Analysis → Risk Mgmt + Orders
```

### Package Structure

Quanta is now split into two packages:

- **`quanta`**: Core trading library with CLI - contains all trading logic, exchanges, AI agents, and CLI commands
- **`@quanta/server`**: API server package - provides REST and WebSocket API for web UIs (QuantaWeb)

The core library (`quanta`) is lightweight and has no HTTP dependencies. The API server (`@quanta/server`) depends on `quanta` and provides the web interface.

### Library API

The `quanta` package provides a clean library API through subpath exports:

```typescript
// Core trading components
import { TradingWorkflow, TradingManager, ExecutionSessionManager } from 'quanta/core';
import { BacktestEngine } from 'quanta/core';
import { EventBus } from 'quanta/core';

// Exchange adapters
import { SimulatorExchange, PaperExchange, BacktestExchange } from 'quanta/exchange';
import type { Exchange, Account, Position, Order } from 'quanta/exchange';

// Configuration
import { getConfig, saveConfig, validateConfig } from 'quanta/config';
import type { Config } from 'quanta/config';

// Types
import type { TradingSignal, MarketData, BacktestConfig } from 'quanta/types';

// Arena system
import { ArenaManager, ArenaOrchestrator } from 'quanta/arena';

// Logging
import { UnifiedLogger, OperationLogger } from 'quanta/logging';

// AI agents
import { OpenRouterClient } from 'quanta/ai';

// Utilities
import { requestDeduplication } from 'quanta/utils';
```

See [QuantaServer/README.md](../QuantaServer/README.md) for API server usage.

## Documentation

- 📖 [Getting Started](docs/getting-started.md)
- 🎯 [Trading Guide](docs/trading-guide.md)
- 🔧 [Configuration](docs/configuration.md)
- 📚 [Command Reference](docs/commands.md)
- 💡 [Core Concepts](docs/concepts.md)
- 🏦 [Supported Exchanges](docs/exchanges.md)
- 📝 [Logging Guide](docs/logging-guide.md)

## Important Concepts (Updated)

### P&L Definitions

- **Total P&L** = Current Equity − Initial Balance (includes realized + unrealized).
- **Unrealized P&L** = Sum of open positions' unrealized P&L.
- **Cycle P&L** = Equity change during the current cycle.

Console output shows both Total P&L and Unrealized P&L explicitly.

### Logging Behavior (Lite)

- Console output is intercepted and written to JSONL files under `logs/text/` (override with `LOG_DIR`).
- Use `quanta log view` (with `--follow`, `--context`, `--level`, `--grep`) to view logs.
- Use `quanta log clean` to manage log file retention.
- Use `quanta log list` to see available log files with metadata.
- Use `quanta log stats` to view aggregated statistics and error rates.
- Use `quanta log export` to export logs to JSON, CSV, or TXT formats.
- For CLI user-facing messages, print via `UnifiedLogger.getInstance().getOriginalConsole()` to bypass interception.

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

### Project Structure

```
Quanta/
├── src/              # Source code
│   ├── logging/      # Logging system components
│   ├── core/         # Core trading logic
│   ├── exchange/     # Exchange adapters
│   └── ...
├── tests/            # Test files (separated from source)
│   ├── logging/      # Logging system tests
│   ├── okx/          # Exchange-specific tests
│   └── *.unit.ts     # Unit tests
├── config/           # Configuration files
└── docs/             # Documentation
```

### Testing

Tests are located in the `tests/` directory, separated from source code:

```bash
# Run specific test suites
npm run test:okx:unit      # OKX exchange tests
npm run test:okx:ticker    # OKX ticker tests

# Run logging system tests (using Node.js assert or vitest)
tsx tests/logging/test-all.ts    # Run all logging component tests
tsx tests/logging/stage2-test.ts # Run Stage 2 component tests

# Run with vitest (if configured)
npx vitest tests/logging          # Run logging tests with vitest
```

**Test Organization:**

- Unit tests: `tests/*.unit.ts`
- Component tests: `tests/logging/*.test.ts`
- Exchange tests: `tests/okx/`
- All tests are separated from source code in `tests/` directory

## Risk Warning

⚠️ **CRITICAL**: This software is for educational purposes only. Cryptocurrency trading involves substantial risk. Never trade with money you cannot afford to lose.

## License

MIT License - see LICENSE file for details.

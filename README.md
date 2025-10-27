# BetaArena CLI

AI-powered quantitative trading system with real-time decision making.

## Quick Start

```bash
# Install and build
npm install && npm run build

# Run a complete trade cycle simulation
beta-arena simulate cycle --coins BTC,ETH,SOL --verbose

# Start live trading (simulation mode) with TUI
beta-arena trade start --mode simulation --coins BTC,ETH --ui tui

# Start live trading (simulation mode) with CLI output
beta-arena trade start --mode simulation --coins BTC,ETH

# Test the system
beta-arena test ai --type mock --coin BTC
```

## Core Features

- **🤖 AI Trading**: OpenRouter integration with multiple AI models
- **📊 Technical Analysis**: Multi-timeframe indicators (EMA, MACD, RSI, ATR)
- **🛡️ Smart Risk Management**: Optimized position sizing, dynamic minimums, 40% cash reserve
- **🔄 Dual Modes**: Live trading and simulation
- **💼 Portfolio Management**: Multi-coin multi-position support (2-3 concurrent positions)
- **🎯 Mock AI**: Built-in simulated AI for testing without API keys
- **🎨 Interactive TUI**: Real-time terminal UI with live panels, charts, and keyboard controls

## Commands

### Trading
```bash
# Start with interactive TUI (recommended)
beta-arena trade start --mode simulation --coins BTC,ETH,SOL --ui tui

# Start with CLI output
beta-arena trade start --mode simulation --coins BTC,ETH,SOL

# Other trading commands
beta-arena trade pause --reason "Maintenance"
beta-arena trade stop --graceful
beta-arena trade status
beta-arena trade backtest --start 2024-01-01 --end 2024-12-31
```

**TUI Keyboard Shortcuts:**
- `h` / `?` - Show help overlay
- `p` - Pause/Resume trading
- `q` - Quit gracefully  
- `r` - Refresh data
- `1-7` - Switch between views

### Simulation
```bash
# Multi-coin portfolio simulation (Mock AI)
beta-arena simulate cycle --coins BTC,ETH,SOL --verbose --max-positions 5

# Use real AI (requires OPENROUTER_API_KEY)
beta-arena simulate cycle --coins BTC,ETH --ai real --verbose
```

### Testing
```bash
beta-arena test ai --type mock --coin BTC
beta-arena test kline --exchange simulator --coin BTC
beta-arena test exchanges --coin BTC --timeframe 3m
```

### Configuration
```bash
beta-arena config show
beta-arena config set ai.model deepseek/deepseek-chat
beta-arena config validate
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

- 🎨 [Interactive TUI Guide](docs/tui-guide.md) - Real-time terminal interface
- 📖 [Getting Started](docs/getting-started.md)
- 🎯 [Trading Guide](docs/trading-guide.md)
- 🔧 [Configuration](docs/configuration.md)
- 🧪 [Testing & Simulation](docs/testing-simulation.md)
- 📚 [Command Reference](docs/commands.md)
- 💡 [Core Concepts](docs/concepts.md)
- 🏦 [Supported Exchanges](docs/exchanges.md)

## Development

```bash
npm run dev      # Development mode
npm run build    # Build project
npm run lint      # Lint code
npm run format    # Format code
```

## Risk Warning

⚠️ **CRITICAL**: This software is for educational purposes only. Cryptocurrency trading involves substantial risk. Never trade with money you cannot afford to lose.

## License

MIT License - see LICENSE file for details.

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

## Core Features

- **🤖 AI Trading**: OpenRouter integration with multiple AI models
- **📊 Technical Analysis**: Multi-timeframe indicators (EMA, MACD, RSI, ATR)
- **🛡️ Smart Risk Management**: Optimized position sizing, dynamic minimums, 40% cash reserve
- **🔄 Multiple Modes**: Simulation (mock data), Paper (real data, simulated trades), Live (real trading)
- **💼 Portfolio Management**: Multi-coin multi-position support (2-3 concurrent positions)
- **🎯 Mock AI**: Built-in simulated AI for testing without API keys
- **⚡ Real-time Monitoring**: Live trading updates and performance tracking
- **📈 Enhanced Backtest Reports**: Visual formatting, progress bars, color-coded metrics, and comprehensive statistics

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

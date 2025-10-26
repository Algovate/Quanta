# BetaArena CLI

AI-powered quantitative trading system with real-time decision making.

## Quick Start

```bash
# Install dependencies
npm install

# Build the project
npm run build

# Test the system
beta-arena test kline --exchange simulator --coin BTC

# Run a complete trade cycle simulation
beta-arena simulate cycle --coins BTC,ETH,SOL --verbose

# Start live trading (simulation mode)
beta-arena trade start --mode simulation --coins BTC,ETH,SOL
```

## Core Features

- **🤖 AI Trading**: OpenRouter integration with multiple AI models
- **📊 Technical Analysis**: Multi-timeframe indicators (EMA, MACD, RSI, ATR)
- **🛡️ Risk Management**: Position sizing, stop-loss, take-profit
- **🔄 Dual Modes**: Live trading and simulation
- **📈 Backtesting**: Historical strategy validation
- **🔌 Multi-Exchange**: Simulator, OKX, Binance, Coinbase
- **💼 Portfolio Management**: Single account multi-coin multi-position support
- **📊 Real-time Monitoring**: Comprehensive position and P&L tracking

## Architecture

```
Perception → Decision → Execution
    ↓           ↓          ↓
Market Data → AI Analysis → Risk Mgmt + Orders
```

## Commands

### Trading
```bash
beta-arena trade start --mode simulation --coins BTC,ETH,SOL
beta-arena trade backtest --start 2024-01-01 --end 2024-12-31
beta-arena trade status
```

### Simulation & Testing
```bash
# Multi-coin portfolio simulation
beta-arena simulate cycle --coins BTC,ETH,SOL --verbose --max-positions 5

# Single coin testing
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
# Exchange
EXCHANGE_MODE=simulation
EXCHANGE_NAME=simulator
EXCHANGE_API_KEY=your_key
EXCHANGE_API_SECRET=your_secret

# AI
OPENROUTER_API_KEY=your_key
AI_MODEL=deepseek/deepseek-chat
AI_TEMPERATURE=0.7

# Trading
TRADING_COINS=BTC,ETH,SOL
CYCLE_PERIOD=180000
MAX_POSITIONS=6
STOP_LOSS=0.03
MAX_RISK=0.05
```

### Configuration File
```json
{
  "mode": "simulation",
  "exchange": {
    "name": "simulator",
    "testnet": true
  },
  "ai": {
    "apiKey": "your_openrouter_key",
    "model": "deepseek/deepseek-chat",
    "temperature": 0.7
  },
  "trading": {
    "coins": ["BTC", "ETH", "SOL"],
    "cyclePeriod": 180000,
    "maxPositions": 6,
    "leverageRange": [5, 40],
    "stopLoss": 0.03,
    "maxRisk": 0.05
  }
}
```

## Trading Workflow

1. **Timer Trigger**: 3-minute cycle heartbeat
2. **Market Data**: Fetch candlesticks and calculate indicators for multiple coins
3. **AI Analysis**: Generate trading signals based on market conditions
4. **Risk Validation**: Check position limits and risk parameters across portfolio
5. **Order Execution**: Place trades with stop-loss and take-profit
6. **Position Monitoring**: Track P&L and exit conditions for all positions
7. **Portfolio Management**: Monitor total exposure, leverage, and diversification

## Simulation Features

BetaArena includes a comprehensive simulation system for testing strategies:

### Multi-Coin Portfolio Simulation
```bash
# Simulate complete trade cycle with multiple coins
beta-arena simulate cycle --coins BTC,ETH,SOL --verbose --max-positions 5

# Key features:
# - Simultaneous analysis of multiple cryptocurrencies
# - Real-time portfolio monitoring and risk management
# - Detailed logging of all trading phases
# - Comprehensive P&L tracking by coin and position
```

### Simulation Output Example
```bash
🎯 BetaArena - Multi-Coin Trade Cycle Simulation
Coins: BTC, ETH, SOL | Initial Balance: $10,000 | Max Positions: 5

📊 PHASE 1: PERCEPTION (Market Data Collection)
  📈 BTC/USDT Analysis: ✓ 3m + 4h data
  📈 ETH/USDT Analysis: ✓ 3m + 4h data  
  📈 SOL/USDT Analysis: ✓ 3m + 4h data

🤖 PHASE 2: DECISION (AI Analysis)
  📊 BTC/USDT Signals: ✓ LONG + SHORT
  📊 ETH/USDT Signals: ✓ LONG + SHORT
  📊 SOL/USDT Signals: ✓ LONG + LONG

⚡ PHASE 3: EXECUTION (Risk Management & Order Placement)
  ✓ Executed 5 orders (risk management filtered 1 low-confidence signal)

🔍 PHASE 4: MONITORING (Position Management)
  📊 Portfolio Overview:
    - Total Exposure: $15,000.00
    - Total Leverage: 1.5x
    - Total Unrealized P&L: +$150.00

📈 PORTFOLIO SUMMARY
Coins Analyzed: 3 | Orders Executed: 5 | Open Positions: 0
Diversification: 3 coins | Risk Level: LOW
```

## Supported AI Models

- **DeepSeek Chat**: Optimized for trading analysis (recommended)
- **Claude 3 Sonnet**: Strong reasoning capabilities
- **GPT-4 Turbo**: Balanced performance
- **Gemini Pro**: Google's advanced model

## Development

```bash
# Development mode
npm run dev

# Watch for changes
npm run watch

# Lint and format
npm run lint
npm run format

# Build
npm run build
```

## Risk Warning

⚠️ **CRITICAL**: This software is for educational purposes only.

- Cryptocurrency trading involves substantial risk
- Never trade with money you cannot afford to lose
- Always test in simulation mode first
- AI can make incorrect decisions leading to losses
- Use proper risk management at all times

## License

MIT License - see LICENSE file for details.

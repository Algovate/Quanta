# BetaArena CLI

AI-powered quantitative trading system with real-time decision making.

## 🚀 Quick Start

```bash
# Install dependencies
npm install

# Build the project
npm run build

# Test K-line data
node dist/index.js test kline --exchange simulator --coin BTC

# Start simulation trading
node dist/index.js trading start --mode simulation --coins BTC,ETH,SOL

# Show configuration
node dist/index.js config show

# Get help
node dist/index.js help
```

## 📋 Features

- **🤖 AI Trading**: OpenRouter integration with configurable models
- **📊 Multi-Timeframe**: 3-minute and 4-hour technical analysis
- **🛡️ Risk Management**: Position sizing, stop-loss, take-profit
- **🔄 Dual Mode**: Live trading and simulation
- **📈 Backtesting**: Historical strategy validation
- **⚡ Real-time**: 3-minute cycle updates

## 🏗️ Architecture

**Perception-Decision-Execution** three-stage system:

1. **Perception**: Market data + technical indicators
2. **Decision**: AI agent generates trading signals
3. **Execution**: Order processing with risk management

### Core Modules

```
src/
├── index.ts              # CLI entry point
├── config/settings.ts     # Configuration management
├── data/market.ts         # Market data + indicators
├── ai/agent.ts           # OpenRouter AI integration
├── exchange/
│   ├── generic.ts        # Generic exchange wrapper
│   ├── simulator.ts      # Mock exchange
│   └── types.ts          # Type definitions
├── execution/
│   ├── risk.ts           # Risk management
│   ├── orders.ts         # Order execution
│   └── monitor.ts        # Position monitoring
└── core/workflow.ts      # Main orchestration
```

## 🛠️ Configuration

### Environment Variables

```bash
# Exchange
EXCHANGE_MODE=simulation
BINANCE_API_KEY=your_key
BINANCE_API_SECRET=your_secret

# AI
OPENROUTER_API_KEY=your_key
AI_MODEL=deepseek/deepseek-chat
AI_TEMPERATURE=0.7

# Trading
TRADING_COINS=BTC,ETH,SOL
CYCLE_PERIOD=180000
MAX_POSITIONS=6
DEFAULT_STOP_LOSS=0.03
```

### CLI Commands

```bash
# Trading Operations
beta-arena trading start --mode simulation --coins BTC,ETH,SOL
beta-arena trading backtest --start 2024-01-01 --end 2024-12-31
beta-arena trading status

# Testing & Validation
beta-arena test kline --exchange okx --coin BTC --timeframe 3m
beta-arena test exchanges --coin BTC --timeframe 3m
beta-arena test data-sources --coin BTC --timeframe 3m

# Configuration Management
beta-arena config show
beta-arena config set ai.model deepseek/deepseek-chat
beta-arena config validate

# Help
beta-arena help
```

### Direct Execution (Recommended)

```bash
# Build first
npm run build

# Then run directly
node dist/index.js trading start --mode simulation --coins BTC,ETH
node dist/index.js test kline --exchange okx --coin BTC
node dist/index.js config show
```

## 🔧 Development

```bash
# Install dependencies
npm install

# Build TypeScript
npm run build

# Run in development
npm run dev

# Watch for changes
npm run watch
```

## ⚠️ Risk Warning

**CRITICAL**: This software is for educational purposes only.

- Cryptocurrency trading involves substantial risk
- Never trade with money you cannot afford to lose
- Always test in simulation mode first
- AI can make incorrect decisions leading to losses
- Leverage trading amplifies both gains and losses

## 📈 Performance Metrics

- **Total Return**: Absolute and percentage returns
- **Win Rate**: Percentage of profitable trades
- **Max Drawdown**: Maximum peak-to-trough decline
- **Sharpe Ratio**: Risk-adjusted return measure
- **Trade Statistics**: Number of trades, average PnL

## 🔄 Trading Workflow

1. **Timer Trigger**: 3-minute cycle heartbeat
2. **Market Data**: Fetch candlesticks and indicators
3. **AI Analysis**: Generate trading signals
4. **Risk Validation**: Check position limits
5. **Order Execution**: Place trades with stops
6. **Position Monitoring**: Track P&L and exits
7. **Performance Update**: Calculate metrics

## 🤖 Supported AI Models

- **DeepSeek Chat**: Optimized for trading analysis
- **Claude 3 Sonnet**: Strong reasoning capabilities
- **GPT-4 Turbo**: Balanced performance
- **Gemini Pro**: Google's advanced model
- **Grok Beta**: X.AI's model
- **Qwen 2.5**: Alibaba's model

## 📝 License

MIT License - see LICENSE file for details.

## 🙏 Acknowledgments

BetaArena CLI represents the next generation of AI-powered quantitative trading systems, combining advanced machine learning models with sophisticated risk management and real-time market analysis.

**BetaArena** - Where AI meets quantitative trading in real-time.
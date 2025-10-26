# BetaArena CLI

A TypeScript CLI application for AI-powered quantitative trading with real-time decision making, supporting both Binance Futures (real & simulation), with full risk management, interactive CLI, and backtesting capabilities.

## 🚀 Quick Start

1. **Install dependencies**:

   ```bash
   npm install
   ```
2. **Configure environment**:

   ```bash
   cp .env.example .env
   # Edit .env with your API keys
   ```
3. **Build the project**:

   ```bash
   npm run build
   ```
4. **Run simulation mode**:

   ```bash
   npm start -- --mode simulation --coins BTC,ETH,SOL
   ```
5. **Test the AI agent**:

   ```bash
   npm start test -- --coin BTC
   ```

## 📋 Features

- 🤖 **AI-Powered Trading**: Uses OpenRouter API with configurable models (DeepSeek, Claude, GPT-4, etc.)
- 📊 **Multi-Timeframe Analysis**: 3-minute and 4-hour candlestick data with technical indicators
- 🛡️ **Risk Management**: Position sizing, stop-loss, take-profit monitoring
- 🎮 **Interactive CLI**: Real-time dashboard with live updates and controls
- 🔄 **Dual Mode**: Live trading and simulation modes
- 📈 **Backtesting**: Historical data replay with performance metrics
- ⚡ **Real-time**: 3-minute cycle updates with persistent state

## 🛠️ Configuration

### Environment Variables

```bash
# Exchange Configuration
EXCHANGE_MODE=simulation  # simulation | live
BINANCE_API_KEY=your_key
BINANCE_API_SECRET=your_secret
BINANCE_TESTNET=true

# AI Configuration  
OPENROUTER_API_KEY=your_key
AI_MODEL=deepseek/deepseek-chat
AI_TEMPERATURE=0.7

# Trading Configuration
TRADING_COINS=BTC,ETH,SOL
CYCLE_PERIOD=180000  # 3 minutes
MAX_POSITIONS=6
DEFAULT_STOP_LOSS=0.03  # 3%
```

### CLI Commands

**Direct execution (recommended):**

```bash
# Build first
npm run build

# Start live trading
node dist/index.js start --mode live --coins BTC,ETH,SOL

# Run simulation
node dist/index.js start --mode simulation --coins BTC,ETH

# Run backtest
node dist/index.js start --mode backtest --start 2024-01-01 --end 2024-12-31

# Test AI agent
node dist/index.js test --coin BTC

# Show status
node dist/index.js status

# Configure settings
node dist/index.js config --list
```

**Via npm (may have argument parsing issues):**

```bash
# Start live trading
npm start -- --mode live --coins BTC,ETH,SOL

# Run simulation
npm start -- --mode simulation --coins BTC,ETH

# Test AI agent
npm start test -- --coin BTC

# Show status
npm start status
```

## 🏗️ Architecture

The system follows a "Perception-Decision-Execution" three-stage architecture:

1. **Perception**: Market data acquisition with multi-timeframe analysis
2. **Decision**: AI agent processes data and generates trading signals
3. **Execution**: Order processing with risk management and monitoring

### Core Components

- **Market Data**: Multi-timeframe candlesticks + technical indicators (EMA, MACD, RSI, ATR)
- **AI Agent**: OpenRouter integration with structured prompts and JSON responses
- **Risk Management**: Position sizing, stop-loss enforcement, leverage limits
- **CLI Interface**: Real-time dashboard with account summary, positions, and charts
- **Backtesting**: Historical data replay with performance metrics

> **Note**: This is a simplified implementation with core functionality consolidated into `src/index.ts`. The system prioritizes working functionality and real-time decision making over complex modular architecture.

## 📊 Project Structure

```
beta-arena/
├── src/
│   ├── index.ts                 # CLI entry point (main implementation)
│   ├── config/
│   │   └── settings.ts          # Configuration management
│   └── exchange/
│       └── types.ts             # Exchange data types
├── dist/                        # Compiled JavaScript
├── package.json
├── tsconfig.json
├── .env.example                 # Environment template
├── .env                         # Your actual environment variables
└── README.md
```

## 🔧 Development

```bash
# Install dependencies
npm install

# Build TypeScript
npm run build

# Run in development mode
npm run dev

# Watch for changes
npm run watch

# Clean build artifacts
npm run clean
```

## ⚠️ Risk Warning

**CRITICAL RISK WARNING** ⚠️

- This software is for educational purposes only
- Cryptocurrency trading involves substantial risk of loss
- Past performance does not guarantee future results
- Never trade with money you cannot afford to lose
- Always test thoroughly in simulation mode first
- The AI can make incorrect decisions leading to losses
- Leverage trading amplifies both gains and losses

## 📈 Performance Metrics

The system tracks comprehensive performance metrics:

- **Total Return**: Absolute and percentage returns
- **Win Rate**: Percentage of profitable trades
- **Max Drawdown**: Maximum peak-to-trough decline
- **Sharpe Ratio**: Risk-adjusted return measure
- **Profit Factor**: Gross profit / Gross loss ratio
- **Trade Statistics**: Number of trades, average PnL

## 🔄 Trading Workflow

1. **Timer Trigger**: 3-minute cycle heartbeat
2. **Market Data**: Fetch multi-timeframe candlesticks and indicators
3. **AI Analysis**: Generate trading signals using OpenRouter
4. **Risk Validation**: Check position limits and risk parameters
5. **Order Execution**: Place trades with proper sizing and stops
6. **Position Monitoring**: Track P&L and exit conditions
7. **Performance Update**: Calculate metrics and update state

## 🤖 AI Models Supported

- **DeepSeek Chat**: Optimized for trading analysis
- **Claude 3 Sonnet**: Strong reasoning capabilities
- **GPT-4 Turbo**: Balanced performance
- **Gemini Pro**: Google's advanced model
- **Grok Beta**: X.AI's model
- **Qwen 2.5**: Alibaba's model

## 📝 License

MIT License - see LICENSE file for details.

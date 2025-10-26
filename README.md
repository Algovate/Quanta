# BetaArena CLI

AI-powered quantitative trading system with real-time decision making.

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.3-blue.svg)](https://www.typescriptlang.org/)
[![Node.js](https://img.shields.io/badge/Node.js-18+-green.svg)](https://nodejs.org/)

## 🎯 Overview

BetaArena is an AI-powered quantitative trading system that combines advanced machine learning models with sophisticated risk management to make real-time trading decisions. It uses a three-stage **Perception-Decision-Execution** architecture to analyze market data, generate trading signals, and execute trades with proper risk controls.

## ✨ Key Features

- **🤖 AI-Powered Decisions**: OpenRouter integration with multiple AI models
- **📊 Multi-Timeframe Analysis**: 3-minute and 4-hour technical indicators
- **🛡️ Advanced Risk Management**: Position sizing, stop-loss, take-profit
- **🔄 Dual Operating Modes**: Live trading and simulation
- **📈 Backtesting Engine**: Historical strategy validation
- **⚡ Real-time Updates**: 3-minute cycle processing
- **🔌 Multi-Exchange Support**: Simulator, OKX, Binance, Coinbase
- **🔧 Flexible Configuration**: JSON config + environment variables
- **🔐 Secure API Handling**: Strict API key validation for account-sensitive operations

## 🚀 Quick Start

### Installation

```bash
# Clone the repository
git clone <repository-url>
cd beta-arena

# Install dependencies
npm install

# Build the project
npm run build
```

### First Steps

```bash
# Test K-line data retrieval
beta-arena test kline --exchange simulator --coin BTC

# Test multiple exchanges
beta-arena test exchanges --coin BTC --timeframe 3m

# Start simulation trading
beta-arena trade start --mode simulation --coins BTC,ETH,SOL

# Show configuration
beta-arena config show

# Get help
beta-arena help
```

## 📋 Table of Contents

- [Architecture](#-architecture)
- [Configuration](#-configuration)
- [CLI Commands](#-cli-commands)
- [Development](#-development)
- [Risk Warning](#-risk-warning)
- [Performance Metrics](#-performance-metrics)
- [Supported Models](#-supported-ai-models)

## 🏗️ Architecture

### Three-Stage System

```
┌─────────────┐      ┌─────────────┐      ┌─────────────┐
│  Perception │ ────>│  Decision   │ ────>│ Execution   │
│             │      │             │      │             │
│ Market Data │      │ AI Analysis │      │ Risk Mgmt   │
│ + Indicators│      │  + Signals  │      │ + Orders    │
└─────────────┘      └─────────────┘      └─────────────┘
```

1. **Perception**: Fetch market data, calculate technical indicators
2. **Decision**: AI agent generates trading signals based on analysis
3. **Execution**: Validate with risk management, execute trades

### Project Structure

```
src/
├── index.ts              # CLI entry point
├── cli/
│   ├── app.ts           # CLI application setup
│   └── commands/        # Command handlers
│       ├── trade.ts     # Trading operations
│       ├── test.ts      # Testing commands
│       ├── config.ts    # Configuration
│       └── help.ts      # Help system
├── config/
│   └── settings.ts      # Configuration management
├── core/
│   ├── workflow.ts      # Main orchestration
│   └── data-source-manager.ts  # Exchange management
├── data/
│   └── market.ts        # Market data + indicators
├── ai/
│   └── agent.ts         # OpenRouter AI integration
├── exchange/
│   ├── simulator.ts     # Simulator exchange for testing
│   ├── okx.ts           # OKX exchange implementation
│   ├── binance.ts       # Binance exchange implementation
│   ├── coinbase.ts      # Coinbase exchange implementation
│   └── types.ts         # Type definitions
└── execution/
    ├── risk.ts          # Risk management
    ├── orders.ts        # Order execution
    └── monitor.ts       # Position monitoring
```

## 🛠️ Configuration

### Environment Variables

```bash
# Exchange Configuration
EXCHANGE_MODE=simulation          # live, simulation, backtest
EXCHANGE_NAME=simulator           # simulator, okx, binance, coinbase
EXCHANGE_TESTNET=true             # Use testnet
EXCHANGE_API_KEY=your_api_key
EXCHANGE_API_SECRET=your_secret
OKX_PASSPHRASE=your_passphrase    # Required for OKX

# AI Configuration
OPENROUTER_API_KEY=your_key
AI_MODEL=deepseek/deepseek-chat   # Model to use
AI_TEMPERATURE=0.7                # Creativity level

# Trading Parameters
TRADING_COINS=BTC,ETH,SOL         # Coins to trade
CYCLE_PERIOD=180000               # 3 minutes in ms
MAX_POSITIONS=6                   # Max concurrent positions
LEVERAGE_MIN=5                    # Min leverage
LEVERAGE_MAX=40                   # Max leverage
STOP_LOSS=0.03                    # 3% stop loss
MAX_RISK=0.05                     # 5% max risk per trade

# UI Configuration
UI_MODE=tui                       # tui or cli
UI_REFRESH_RATE=1000              # Refresh rate in ms
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

## 💻 CLI Commands

### Trading Operations

```bash
# Start trading system
beta-arena trade start --mode simulation --coins BTC,ETH,SOL

# Run backtest
beta-arena trade backtest --start 2024-01-01 --end 2024-12-31

# Show trading status
beta-arena trade status
```

### Testing & Validation

```bash
# Test K-line data from specific exchange
beta-arena test kline --exchange okx --coin BTC --timeframe 3m

# Test multiple exchanges
beta-arena test exchanges --coin BTC --timeframe 3m

# Test data source configuration
beta-arena test data-sources --coin BTC --timeframe 3m
```

**Note**: Testing exchanges without API credentials will only work for public data (candlestick data, ticker prices). Account information and trading operations require valid API credentials.

### Configuration Management

```bash
# Show current configuration
beta-arena config show

# Set configuration value
beta-arena config set ai.model deepseek/deepseek-chat

# Validate configuration
beta-arena config validate
```

### Help

```bash
# Show help
beta-arena help

# Command-specific help
beta-arena trade --help
beta-arena test --help
```

## 🔄 Trading Workflow

1. **Timer Trigger**: 3-minute cycle heartbeat
2. **Market Data**: Fetch candlestick data and calculate indicators
3. **AI Analysis**: Generate trading signals based on market conditions
4. **Risk Validation**: Check position limits and risk parameters
5. **Order Execution**: Place trades with stop-loss and take-profit
6. **Position Monitoring**: Track P&L and exit conditions
7. **Performance Update**: Calculate and log metrics

## 🔐 API Credentials

### Exchange API Keys

To use real exchanges (OKX, Binance, Coinbase), you need valid API credentials:

```bash
# Environment variables (recommended)
export OKX_API_KEY=your_key
export OKX_API_SECRET=your_secret
export OKX_PASSPHRASE=your_passphrase  # Required for OKX

export BINANCE_API_KEY=your_key
export BINANCE_API_SECRET=your_secret

export COINBASE_API_KEY=your_key
export COINBASE_API_SECRET=your_secret
```

### What Requires API Keys?

**Requires API credentials:**

- `getAccount()` - Account balance and equity
- `getPositions()` - Current positions
- `placeOrder()` - Order execution
- `cancelOrder()` - Order cancellation

**Public data (no API key needed):**

- `getCandlesticks()` - Historical price data
- `getTicker()` - Current market prices

**Simulator:**

- No API keys required - uses mock data for testing

### Exchange-Specific Notes

**Binance:**
- May be restricted in certain geographic locations (HTTP 451 error)
- If you encounter location restrictions, consider using OKX or Coinbase which have better global availability
- Note: Binance restrictions are based on the exchange's terms of service and legal requirements

**OKX & Coinbase:**
- Generally have good global availability
- OKX requires a passphrase in addition to API key and secret

## 🤖 Supported AI Models

- **DeepSeek Chat**: Optimized for trading analysis (recommended)
- **Claude 3 Sonnet**: Strong reasoning capabilities
- **GPT-4 Turbo**: Balanced performance
- **Gemini Pro**: Google's advanced model
- **Grok Beta**: X.AI's conversational AI
- **Qwen 2.5**: Alibaba's efficient model

Configure via `AI_MODEL` environment variable or config file.

## 📈 Performance Metrics

- **Total Return**: Absolute and percentage returns
- **Win Rate**: Percentage of profitable trades
- **Max Drawdown**: Maximum peak-to-trough decline
- **Sharpe Ratio**: Risk-adjusted return measure
- **Trade Statistics**: Number of trades, average P&L, holding time

## 🔧 Development

### Prerequisites

- Node.js 18+
- npm or yarn
- TypeScript 5.3+

### Setup

```bash
# Install dependencies
npm install

# Build TypeScript
npm run build

# Run in development mode
npm run dev

# Watch for changes
npm run watch

# Run linter
npm run lint

# Format code
npm run format
```

### Testing

```bash
# Test K-line data
npm run dev -- test kline --exchange simulator --coin BTC

# Test multiple exchanges
npm run dev -- test exchanges --coin BTC

# Test data sources
npm run dev -- test data-sources
```

## ⚠️ Risk Warning

**CRITICAL**: This software is for educational purposes only.

- ⚠️ Cryptocurrency trading involves substantial risk
- 💰 Never trade with money you cannot afford to lose
- 🧪 Always test in simulation mode first
- 🤖 AI can make incorrect decisions leading to losses
- 📊 Leverage trading amplifies both gains and losses
- 🔍 Review all signals before executing in live mode
- 🛡️ Use proper risk management at all times

## 🎓 Educational Use

This project demonstrates:

- AI integration with trading systems
- Real-time data processing
- Risk management strategies
- Multi-exchange API integration
- Technical indicator calculations
- Backtesting methodologies

**Not intended for production trading without extensive testing and validation.**

## 📝 License

MIT License - see LICENSE file for details.

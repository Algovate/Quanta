# Getting Started

Quick start guide for Quanta CLI.

## Installation

```bash
# Clone the repository
git clone https://github.com/your-org/quanta.git
cd quanta

# Install dependencies
npm install

# Build the project
npm run build
```

## Quick Start

### 1. Test the System

```bash
# Test with Mock AI (no API key required)
quanta simulate cycle --coins BTC --verbose

# Test AI integration
quanta test ai --type mock --coin BTC

# Test market data
quanta test kline --exchange simulator --coin BTC

# Test different exchanges
quanta test kline --exchange bin --coin BTC
quanta test kline --exchange cb --coin ETH
quanta test kline --exchange hliq --coin SOL
```

### 2. Configure API Keys

```bash
# Set OpenRouter API key
export OPENROUTER_API_KEY=your_key_here

# Or add to .env file
echo "OPENROUTER_API_KEY=your_key_here" >> .env
```

### 3. Run Your First Simulation

```bash
# Basic simulation
quanta simulate cycle --coins BTC --verbose

# Multi-coin simulation
quanta simulate cycle --coins BTC,ETH,SOL --verbose --max-positions 5

# With real AI
quanta simulate cycle --coins BTC,ETH --ai real --verbose
```

### 4. Interactive TUI (Terminal User Interface)

```bash
# Build first (required for TUI)
npm run build

# Start with interactive TUI
quanta trade start --mode simulation --coins BTC,ETH --ui tui

# TUI Keyboard Shortcuts:
# h / ?  - Show help overlay
# p      - Pause/Resume trading
# q      - Quit gracefully
# r      - Refresh data
# 1-7    - Switch between views

# Without TUI (CLI mode)
quanta trade start --mode simulation --coins BTC,ETH
```

## Next Steps

- 🎨 [Learn about TUI](tui-guide.md) - Interactive terminal interface
- 📖 [Read the Trading Guide](trading-guide.md)
- 🔧 [Configure the System](configuration.md)
- 🧪 [Learn Testing](testing-simulation.md)

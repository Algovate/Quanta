# Getting Started

Quick start guide for BetaArena CLI.

## Installation

```bash
# Clone the repository
git clone https://github.com/your-org/beta-arena.git
cd beta-arena

# Install dependencies
npm install

# Build the project
npm run build
```

## Quick Start

### 1. Test the System

```bash
# Test with Mock AI (no API key required)
beta-arena simulate cycle --coins BTC --verbose

# Test AI integration
beta-arena test ai --type mock --coin BTC

# Test market data
beta-arena test kline --exchange simulator --coin BTC
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
beta-arena simulate cycle --coins BTC --verbose

# Multi-coin simulation
beta-arena simulate cycle --coins BTC,ETH,SOL --verbose --max-positions 5

# With real AI
beta-arena simulate cycle --coins BTC,ETH --ai real --verbose
```

## Next Steps

- 📖 [Read the Trading Guide](trading-guide.md)
- 🔧 [Configure the System](configuration.md)
- 🧪 [Learn Testing](testing-simulation.md)

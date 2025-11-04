# Quanta Documentation

Complete documentation index for the Quanta AI trading system.

## 📚 Documentation Index

### 🚀 Getting Started

- **[Getting Started](getting-started.md)** (4.0KB)
  - Installation steps
  - Quick start guide
  - First simulation

### 📈 Trading

- **[Trading Guide](trading-guide.md)** (8.0KB)
  - Trading modes (simulation/paper/live)
  - Trading lifecycle
  - Risk management
  - Best practices
- **[Position Auto-Close Strategy](position-auto-close.md)** (12KB)
  - Flat position detection
  - R-multiple calculation
  - Staged exit strategy
  - Auto-close mechanism
  - Configuration and examples

### ⚙️ Configuration

- **[Configuration Guide](configuration.md)** (8.0KB)
  - Configuration files
  - Environment variables
  - CLI configuration
  - Settings examples

### 📚 Reference

- **[Command Reference](commands.md)** (24KB)
  - Complete command documentation
  - All sub-commands
  - Options and examples
- **[Supported Exchanges](exchanges.md)** (8.0KB)
  - Exchange list and features
  - API configuration
  - Abbreviation guide

- **[Logging Guide](logging-guide.md)**
  - JSONL text logging (daily-rotated)
  - Console interception and original console usage
  - `quanta log view` usage (filters, follow)
  - Configuration (`LOG_DIR`, `logging.textLogDir`, `retentionDays`)
- **[Error Handling & Resilience](error-handling.md)** (20KB)
  - Circuit breaker patterns
  - Retry strategies
  - Error recovery mechanisms
  - Resilience best practices

### 💡 Concepts & Terminology

- **[Core Concepts](concepts.md)** (28KB) ⭐ COMPREHENSIVE
  - Complete architecture
  - Trading modes (detailed)
  - Technical indicators
  - Risk management algorithms
  - AI & signals
  - Execution flow
  - Complete glossary (50+ terms)
  - Algorithm implementations

## 🎯 Quick Navigation

### For New Users

1. Start with [Getting Started](getting-started.md)
2. Understand [core concepts](concepts.md)

### For Traders

1. Read [Trading Guide](trading-guide.md)
2. Configure [system settings](configuration.md)
3. Learn [risk management](concepts.md#risk-management)

### For Developers

1. Check [Command Reference](commands.md)
2. Understand [architecture](concepts.md#architecture)
3. Review [algorithms](concepts.md#algorithms)
4. Learn [logging system](logging-guide.md) for debugging and analysis

## 📊 Documentation Statistics

| Document               | Size       | Lines      | Purpose                           |
| ---------------------- | ---------- | ---------- | --------------------------------- |
| README.md              | 8.0KB      | 218        | Documentation index               |
| getting-started.md     | 4.0KB      | 126        | Quick setup                       |
| trading-guide.md       | 8.0KB      | 252        | Trading operations                |
| position-auto-close.md | 12KB       | ~600       | Flat position auto-close strategy |
| configuration.md       | 12KB       | 347        | System setup                      |
| commands.md            | 28KB       | 1,037      | Command reference                 |
| concepts.md            | 28KB       | 1,293      | Concepts & algorithms             |
| exchanges.md           | 8.0KB      | 183        | Exchange support                  |
| logging-guide.md       | 52KB       | 1,718      | Logging concepts + system guide   |
| error-handling.md      | 20KB       | 688        | Error handling & resilience       |
| **Total**              | **~180KB** | **~6,462** | Complete docs                     |

## 🔍 Key Topics

### Concepts Document Coverage

- **Architecture**: 3-stage system, components
- **Trading**: Modes, order types, positions
- **Indicators**: EMA, MACD, RSI, ATR (with formulas)
- **Risk Management**: Position sizing, stop-loss
- **AI Signals**: Generation, confidence, signals
- **Execution Flow**: Complete trading cycle
- **Glossary**: 50+ terms defined
- **Algorithms**: Code examples

### Quick Links by Topic

**Technical Indicators**

- [EMA (Exponential Moving Average)](concepts.md#moving-averages)
- [MACD](concepts.md#macd-moving-average-convergence-divergence)
- [RSI (Relative Strength Index)](concepts.md#rsi-relative-strength-index)
- [ATR (Average True Range)](concepts.md#atr-average-true-range)

**Risk Management**

- [Position Sizing](concepts.md#position-sizing)
- [Stop Loss](concepts.md#stop-loss)
- [Take Profit](concepts.md#take-profit)
- [Leverage](concepts.md#leverage)
- [Flat Auto-Close Strategy](position-auto-close.md)

**AI & Signals**

- [Signal Generation](concepts.md#signal-generation-process)
- [Confidence Levels](concepts.md#confidence-levels)
- [Mock vs Real AI](concepts.md#mock-ai-vs-real-ai)

**Algorithms**

- [Position Sizing Algorithm](concepts.md#position-sizing-algorithm-optimized)
- [Risk Validation Algorithm](concepts.md#risk-validation-algorithm)
- [Stop-Loss Calculation](concepts.md#stop-loss-calculation-algorithm)

## 📖 Learning Path

### Beginner Path

```
1. Getting Started
   ↓
2. Configure API keys and settings
   ↓
3. Read Trading Guide
   ↓
4. Study Core Concepts
```

### Advanced Path

```
1. Core Concepts (deep dive)
   ↓
2. Algorithms & Formulas
   ↓
3. Advanced Configuration
   ↓
4. Custom Risk Management
```

## 💡 Tips

- **New to trading?** Start with [Getting Started](getting-started.md) and [Concepts](concepts.md)
- **Setting up?** Follow [Configuration Guide](configuration.md)
- **Ready to trade?** Read [Trading Guide](trading-guide.md)
- **Understanding position management?** See [Position Auto-Close Strategy](position-auto-close.md)
- **Need quick reference?** Check [Commands](commands.md)
- **Configuring exchanges?** See [Supported Exchanges](exchanges.md)
- **Understanding concepts?** Study [Concepts](concepts.md)
- **Debugging?** Read [Logging Guide](logging-guide.md)
- **Troubleshooting errors?** See [Error Handling & Resilience](error-handling.md)

## 🎓 Concepts Document Highlights

The comprehensive concepts document provides:

✅ **Complete Architecture** - 3-stage system explanation  
✅ **Trading Fundamentals** - Modes, orders, positions  
✅ **Technical Indicators** - EMA, MACD, RSI, ATR with formulas  
✅ **Risk Management** - Position sizing, stop-loss, leverage  
✅ **AI Concepts** - Signal generation, confidence levels  
✅ **Execution Flow** - Complete trading cycle  
✅ **Comprehensive Glossary** - 50+ terms defined  
✅ **Algorithm Examples** - Code implementations

## 🔄 Documentation Updates

All documentation is actively maintained and continuously improved. Latest updates:

- ✅ Added comprehensive Trading Modes section
- ✅ Expanded glossary (50+ terms)
- ✅ Added algorithm examples with code
- ✅ Enhanced technical indicator explanations
- ✅ Improved risk management section with formulas
- ✅ Streamlined documentation structure
- ✅ Added exchanges support guide
- ✅ Integrated logging guide with operation-driven logging system
- ✅ Added log query CLI commands
- ✅ Added error handling and resilience documentation
- ✅ Added position auto-close strategy documentation
- ✅ Updated all documentation statistics and links

---

**Version**: 0.4.0  
**Last Updated**: January 2025

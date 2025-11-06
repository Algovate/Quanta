# Strategies Guide

This document explains the distinction between execution modes and strategy classes in Quanta.

## Overview

### Execution Mode (ExecutionMode)

**Type**: Configuration setting, not a strategy class

**Purpose**: Controls how the trading system operates - single workflow vs multi-drone arena

**Values**:

- `'single'`: Single trading workflow mode (default)
  - Runs one trading workflow with a single AI agent
  - Uses `TradingWorkflow` for signal generation and execution
- `'arena'`: Multi-drone arena mode
  - Runs multiple independent trading workflows (drones) simultaneously
  - Each drone can have different configurations
  - Used for strategy comparison and competition

**Location**: `Quanta/src/core/types/execution-session.ts`

**Usage**: Set via configuration file (`config.json`) or environment variable (`QUANTA_MODE`)

```typescript
// Type definition
export type ExecutionMode = 'single' | 'arena';

// Configuration example
{
  "mode": "single",  // or "arena"
  "env": "paper"
}
```

### Strategy Classes

**Type**: Concrete classes implementing signal generation logic

**Purpose**: Encapsulate trading signal generation using different approaches

**Base Class**: `BaseStrategy` (in `Quanta/src/strategies/base-strategy.ts`)

#### AIStrategy

**Purpose**: Wraps AI agent to generate trading signals using LLM

**Location**: `Quanta/src/strategies/ai-strategy.ts`

**Implementation**:

- Uses `OpenRouterClient` to call LLM API
- Generates signals based on market data, technical indicators, and context
- Returns `TradingSignal[]` with confidence scores

**Usage**:

```typescript
const aiStrategy = new AIStrategy(
  {
    name: 'ai-strategy',
    description: 'AI-powered signal generation',
    enabled: true,
    params: {},
  },
  aiAgent
);

const result = await aiStrategy.generateSignals({
  account,
  positions,
  marketData,
  cycleCount: 1,
  timestamp: Date.now(),
});
```

#### TechnicalStrategy

**Purpose**: Rule-based technical analysis using indicators

**Location**: `Quanta/src/strategies/technical-strategy.ts`

**Implementation**:

- Uses RSI (Relative Strength Index) and EMA (Exponential Moving Average) crossovers
- Generates signals based on technical indicator thresholds
- Long: RSI < 30 (oversold) + EMA20 > EMA50 (bullish crossover)
- Short: RSI > 70 (overbought) + EMA20 < EMA50 (bearish crossover)
- Close: RSI reversal from extreme levels

**Usage**:

```typescript
const technicalStrategy = new TechnicalStrategy({
  name: 'technical-strategy',
  description: 'RSI + EMA crossover strategy',
  enabled: true,
  params: {},
});

const result = await technicalStrategy.generateSignals({
  account,
  positions,
  marketData,
  cycleCount: 1,
  timestamp: Date.now(),
});
```

## Architecture

### Current State

**Execution Mode**: Used throughout the codebase to determine workflow type

- Single workflow: Uses `TradingWorkflow` directly
- Arena mode: Uses `ArenaManager` to orchestrate multiple `DroneInstance` workflows

**Strategy Classes**: Currently defined but not fully integrated

- `AIStrategy` and `TechnicalStrategy` exist but are not used in the main workflow
- Workflow currently calls `aiAgent.generateTradingSignal()` directly
- `StrategyManager` exists but is not integrated into the workflow

### Integration Plan

1. **Naming Improvements**: Unified to `ExecutionMode` with values `'single'` and `'arena'`
2. **Strategy Pattern Integration**: Refactor workflow to use `AIStrategy` instead of direct AI agent calls
3. **Future Enhancement**: Integrate `StrategyManager` to support multiple strategies simultaneously

## Key Differences

| Aspect       | Execution Mode         | Strategy Classes                        |
| ------------ | ---------------------- | --------------------------------------- |
| **Type**     | Configuration setting  | Implementation classes                  |
| **Purpose**  | Control workflow type  | Generate trading signals                |
| **Values**   | `'single'`, `'arena'`  | `AIStrategy`, `TechnicalStrategy`, etc. |
| **Scope**    | System-wide            | Signal generation only                  |
| **Location** | `execution-session.ts` | `strategies/` directory                 |
| **Example**  | `mode: 'single'`       | `new AIStrategy(...)`                   |

## Best Practices

1. **Use Execution Mode for Workflow Type**: Use `ExecutionMode` to determine whether to run single workflow or arena
2. **Use Strategy Classes for Signal Generation**: Use strategy classes (`AIStrategy`, `TechnicalStrategy`) to generate trading signals
3. **Avoid Confusion**: Don't confuse execution mode values (`'single'`, `'arena'`) with strategy classes (`AIStrategy`, `TechnicalStrategy`)
4. **Naming**: Use `'single'` instead of `'strategy'` for execution mode to avoid confusion

## Related Documentation

- [Configuration Guide](configuration.md) - How to configure execution mode
- [Arena Guide](arena-guide.md) - Multi-drone arena mode
- [Trading Guide](trading-guide.md) - Single workflow trading

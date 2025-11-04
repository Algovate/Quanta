# Log Contexts Reference

This document lists all log context values used in the Quanta logging system.

## Overview

Log contexts are string identifiers used to categorize log entries by their source component. They help filter and analyze logs by component.

## Core Contexts

### Console Interception

- **`Console`** - Default context for intercepted console.log/console.warn/console.error output

### CLI Commands

- **`TradeStart`** - Trading system startup and initialization
- **`Server`** - API server startup, shutdown, and operations

### Core Components

- **`Workflow`** - Trading workflow operations (default)
- **`CycleLogger`** - Cycle event logging
- **`TradingCycle`** - Trading cycle operations (mapped from `trading_cycle`)
- **`AISignal`** - AI signal generation (mapped from `signal_generation`)
- **`Execution`** - Order execution operations (mapped from `order_execution`)
- **`Account`** - Account and position monitoring (mapped from `position_monitoring` and `account_sync`)
- **`MarketData`** - Market data operations (mapped from `market_data`)

### Arena System

- **`ArenaManager`** - Arena manager operations
- **`ArenaOrchestrator`** - Arena orchestrator operations (dynamic: `ArenaOrchestrator:${arenaId}`)
- **`ArenaStorage`** - Arena storage operations
- **`DroneInstance`** - Individual drone instance operations
- **`DroneAIAgent`** - Drone AI agent operations (dynamic: `DroneAIAgent:${droneId}`)

### Web Server Components

- **`Server`** - API server main operations
- **`TradingService`** - Trading service operations
- **`TradingManager`** - Trading manager operations
- **`SystemRoutes`** - System route handlers
- **`TradeRoutes`** - Trade route handlers
- **`DataRoutes`** - Data route handlers
- **`MarketRoutes`** - Market route handlers
- **`BacktestRoutes`** - Backtest route handlers
- **`ErrorHandler`** - Error handling middleware
- **`HealthCheck`** - Health check operations

### Exchange Adapters

- **`OKX`** - OKX exchange adapter
- **`CCXT`** - CCXT helper operations
- **`Exchange`** - Generic exchange adapter (dynamic based on exchange name)

### Other Components

- **`CircuitBreaker`** - Circuit breaker operations (dynamic: `CircuitBreaker:${name}`)
- **`MarketData`** - Market data provider
- **`PromptLoader`** - Prompt loading operations
- **`RiskSnapshotAggregator`** - Risk snapshot aggregation
- **`UnifiedLogger`** - Default context when no context is specified

## Usage Examples

### Filter by Context

```bash
# View logs from trading system startup
quanta log view --context TradeStart

# View logs from server
quanta log view --context Server

# View logs from arena manager
quanta log view --context ArenaManager

# View logs from workflow
quanta log view --context Workflow

# View logs from execution
quanta log view --context Execution

# View logs from AI signal generation
quanta log view --context AISignal
```

### Statistics by Context

```bash
# Get statistics for a specific context
quanta log stats --context TradeStart

# Get statistics for arena operations
quanta log stats --context ArenaManager
```

### Export by Context

```bash
# Export logs from a specific context
quanta log export --output server-logs.json --context Server
```

## Dynamic Contexts

Some contexts are dynamically generated based on runtime values:

- **`ArenaOrchestrator:${arenaId}`** - Per-arena orchestrator
- **`DroneAIAgent:${droneId}`** - Per-drone AI agent
- **`CircuitBreaker:${name}`** - Per-circuit-breaker instance

To filter these, you can use partial matching with `--grep`:

```bash
# View logs from all arena orchestrators
quanta log view --grep "ArenaOrchestrator"

# View logs from a specific arena
quanta log view --grep "ArenaOrchestrator:arena-123"
```

## Finding Available Contexts

To see all contexts present in your logs:

```bash
# View unique contexts from logs
quanta log stats --format json | jq '.byContext | keys'
```

Or use the stats command to see context distribution:

```bash
quanta log stats
```

This will show a breakdown of log entries by context, helping you identify which contexts are present in your logs.

# Logging System Guide

Complete guide to Quanta's operation-driven logging system.

---

## Part 1: Core Concepts

This section explains the key concepts in Quanta's logging system and their relationships: **Cycle**, **Trace**, **Operation**, **Stage**, and **Snapshot**.

### Hierarchy and Relationships

```
Cycle
  └─ Trace [one per cycle]
       └─ Operation [one main operation per cycle, can have nested operations]
            └─ Stage [multiple stages per operation]

Snapshot [created at end of cycle]
```

### 1. Cycle

**Definition**: A complete trading cycle from start to finish. Each cycle represents one iteration of the trading workflow.

**Characteristics**:

- **ID**: Sequential number starting from 1 (`cycleId: 1, 2, 3, ...`)
- **Duration**: Typically 3 minutes (configurable via `cyclePeriod`)
- **Scope**: Contains all operations performed during one trading iteration

**Example**:

```
Cycle #2
  Started: 14:00:33
  Duration: 11.92s
  Activities: Fetch account → Monitor positions → Fetch market data → Generate signals → Execute signals
```

### 2. Trace

**Definition**: A cycle-level trace ID that groups all operations belonging to the same cycle.

**Characteristics**:

- **Format**: `trace-{cycleId}-{timestamp}`
- **Relationship**: One trace per cycle (1:1)
- **Purpose**: Allows querying all operations that occurred in a specific cycle

**Example**:

```
Cycle #2 → Trace ID: trace-2-1761976833581
```

**Usage**:

```bash
# Query all operations in a trace
quanta log trace trace-2-1761976833581

# Filter operations by trace ID
quanta log query --trace-id trace-2
```

### 3. Operation

**Definition**: A discrete unit of work with a clear start and end, tracked for logging and analysis.

**Characteristics**:

- **ID**: UUID (e.g., `456468a4-4faf-463f-bef0-3a0577b9fb13`)
- **Type**: Examples: `trading_cycle`, `signal_generation`, `order_execution`
- **Scope**: Can span multiple stages
- **Parent-Child**: Can have nested operations via `parentOperationId`

**Example**:

```json
{
  "operationId": "456468a4-4faf-463f-bef0-3a0577b9fb13",
  "traceId": "trace-2-1761976833581",
  "cycleId": 2,
  "operationType": "trading_cycle",
  "status": "completed",
  "stages": [...]
}
```

**Common Operation Types**:

- `trading_cycle`: The main cycle operation (one per cycle)
- `signal_generation`: AI signal generation (can be nested)
- `order_execution`: Order placement/execution (can be nested)
- `position_monitoring`: Position updates (can be nested)

**Usage**:

```bash
# Query operations
quanta log query --operation-id 456468a4

# Filter by type
quanta log query --type trading_cycle

# View detailed information
quanta log query --operation-id 456468a4 --verbose
```

### 4. Stage

**Definition**: A step within an operation, providing fine-grained tracking of operation progress.

**Characteristics**:

- **Name**: Descriptive stage name (e.g., `fetch_account`, `generate_signals`)
- **Timing**: Tracks start time, end time, and duration
- **Status**: `started`, `completed`, or `failed`
- **I/O**: Can have input and output data

**Example**:

```json
{
  "stage": "generate_signals",
  "startTime": 1761976834885,
  "endTime": 1761976845501,
  "duration": 10616,
  "status": "completed",
  "input": { "marketDataCount": 6 },
  "output": { "signalCount": 3, "duration": 10615 }
}
```

**Trading Cycle Stages** (in order):

1. `cycle_start` - Cycle initialization
2. `fetch_account` - Fetch account data and balance
3. `monitor_positions` - Monitor existing positions
4. `fetch_market_data` - Fetch market data for all symbols
5. `generate_signals` - Generate AI trading signals
6. `execute_signals` - Execute trading signals
7. `create_snapshot` - Create system state snapshot

**Usage**:

```bash
# View all stages in detailed output
quanta log query --cycle-id 2 --verbose

# Stages are visible in operation details
quanta log trace trace-2-1761976833581 --format json
```

### 5. Snapshot

**Definition**: A complete capture of system state at a specific point in time, created at the end of each cycle.

**Characteristics**:

- **ID**: UUID (e.g., `a9129f1f-5a5f-4ce5-af3c-8ac3b6905899`)
- **Timing**: Created at the end of each trading cycle
- **Content**: Account, positions, system metrics, circuit breakers, recent operations
- **Storage**: Saved to L2 storage layer (persistent across workflow restarts)

**Example**:

```json
{
  "snapshotId": "a9129f1f-5a5f-4ce5-af3c-8ac3b6905899",
  "timestamp": 1761977324000,
  "cycleId": 18,
  "account": {
    "equity": 9978.88,
    "balance": 9978.88,
    "marginUsed": 0.0,
    "availableMargin": 9978.88
  },
  "positions": [],
  "systemMetrics": {
    "memoryUsage": { "heapUsed": 75, "heapTotal": 77, "rss": 228 }
  }
}
```

**Usage**:

```bash
# View latest snapshot
quanta log snapshot

# View specific snapshot
quanta log snapshot a9129f1f-5a5f-4ce5-af3c-8ac3b6905899

# JSON format
quanta log snapshot --format json
```

### Relationships Diagram

```
Cycle #2
│
├─ Trace: trace-2-1761976833581
│  │
│  └─ Operation: trading_cycle (456468a4-...)
│     │
│     ├─ Stage: cycle_start (11.92s)
│     ├─ Stage: fetch_account (1ms)
│     ├─ Stage: monitor_positions
│     ├─ Stage: fetch_market_data (1.30s)
│     ├─ Stage: generate_signals (10.62s)
│     ├─ Stage: execute_signals
│     └─ Stage: create_snapshot
│
└─ Snapshot: a9129f1f-... (created at end)
```

### Data Flow

1. **Cycle Starts**
   - `cycleId` increments (e.g., 1 → 2)
   - `traceId` created: `trace-2-{timestamp}`
   - `operationId` created: `trading_cycle` operation starts

2. **Operation Progress**
   - Multiple stages execute sequentially
   - Each stage logs input/output
   - Stages can fail, but operation continues

3. **Cycle Completes**
   - Operation marked as `completed` or `failed`
   - Snapshot created with current system state
   - All data persisted to storage layers

4. **Query Time**
   - Operations stored in L0 (memory) and L1 (SQLite)
   - Snapshots stored in L2 (files)
   - Query interface combines data from all layers

### Storage Locations

- **L0 (Memory)**: Recent operations, fast access
- **L1 (SQLite)**: Recent cycles (default: 1000), queryable
- **L2 (Files)**: Historical cycles, compressed JSON
- **L3 (Archive)**: Old cycles, long-term storage

Operations are stored in L1 SQLite database:

- Table: `operations`
- Indexes: `cycleId`, `traceId`, `operationType`, `status`, `symbol`, `startTime`

Snapshots are stored in L2 directory:

- Files: `snapshot-{snapshotId}.json` or `.json.gz`
- Location: `logs/l2-history/`

### Summary

- **Cycle**: One complete trading iteration (numbered sequentially)
- **Trace**: One per cycle, groups all cycle operations (format: `trace-{cycleId}-{timestamp}`)
- **Operation**: Discrete unit of work (UUID, belongs to a trace)
- **Stage**: Step within an operation (tracks progress, I/O, timing)
- **Snapshot**: System state capture at cycle end (account, positions, metrics)

All concepts work together to provide complete observability:

- **Trace** links all operations in a cycle
- **Operation** contains multiple **Stages** for detailed tracking
- **Snapshot** captures final state after cycle completes
- **Cycle** number ties everything together chronologically

---

## Part 2: Usage Guide

## Overview

Quanta uses a sophisticated **operation-driven logging system** that tracks the complete lifecycle of operations, aggregates errors intelligently, captures system state snapshots, and provides powerful query capabilities for analysis and debugging.

### Key Features

- **Operation Lifecycle Tracking**: Track complete operation flows with stages, inputs, outputs, and errors
- **Intelligent Error Aggregation**: Group similar errors to reduce noise and identify patterns
- **System State Snapshots**: Periodic capture of critical system state for post-mortem analysis
- **Real-time Metrics**: Collect and monitor performance metrics during runtime
- **Intelligent Sampling**: Dynamically adjust logging detail based on system health
- **Tiered Storage**: Efficient multi-level storage (memory → hot → warm → cold) with SQLite for fast queries
- **Query Interface**: Powerful CLI and programmatic query capabilities
- **Log Cleanup**: Manual cleanup commands to manage storage space

## Architecture

### Components

```
┌─────────────────┐
│ UnifiedLogger   │ ← Main interface
└────────┬────────┘
         │
    ┌────┴──────────────────────────────┐
    │                                  │
┌───▼──────────┐  ┌──────────────┐  ┌─▼───────────┐
│OperationLogger│  │ErrorAggregator│  │MetricsCollector│
└──────────────┘  └──────────────┘  └──────────────┘
         │
┌────────▼──────────┐
│StateSnapshot     │
└──────────────────┘
         │
┌────────▼──────────┐              ┌─────────▼─────────┐
│StorageLayer       │              │StorageOptimizer │
│  (Tiered Storage) │              │  (Batch Writes)  │
└───────────────────┘              └──────────────────┘
         │
┌────────▼──────────┐
│QueryInterface     │
│  (Search/Filter)  │
└───────────────────┘
```

### Component Responsibilities

- **UnifiedLogger**: Main facade coordinating all logging components
- **OperationLogger**: Tracks operation lifecycles with stages and context
- **ErrorAggregator**: Groups similar errors and calculates severity
- **MetricsCollector**: Collects performance metrics (latency, duration, resource usage)
- **StateSnapshotService**: Captures periodic system state snapshots
- **Sampler**: Dynamically adjusts logging detail based on system health
- **StorageLayer**: Manages tiered storage (L0: memory, L1: SQLite, L2: files, L3: archive)
- **StorageOptimizer**: Batches writes for efficient I/O
- **QueryInterface**: Provides query and analysis capabilities

### UnifiedLogger API Reference

The `UnifiedLogger` class provides the main interface for all logging operations:

#### Initialization

- `getInstance()` - Get singleton instance
- `initialize()` - Initialize logging system and set up handlers

#### Operations

- `createTraceContext(cycleId)` - Create trace context for a cycle
- `startOperation(traceContext, type, input, symbol?)` - Start an operation
- `completeOperation(operationId, status, output?, error?)` - Complete an operation
- `startStage(operationId, stageName, input?)` - Start a stage within an operation
- `completeStage(operationId, stageName, output?, error?)` - Complete a stage

#### Metrics & Errors

- `recordAPILatency(endpoint, latency)` - Record API call latency
- `recordCycleTime(cycleId, duration)` - Record cycle execution time
- `recordError(error, context)` - Record error directly
- `getMetricsSnapshot(cycleId?)` - Get current metrics snapshot
- `getErrorRate()` - Get current error rate
- `getAggregatedErrors()` - Get aggregated errors

#### Snapshots

- `createSnapshot(cycleId, account, positions, circuitBreakers, recentOperations)` - Create system snapshot
- `getSnapshotById(snapshotId)` - Get snapshot by ID

#### Data Quality & Validation

- `recordValidationCheck(operationId, stageName, check)` - Record validation check to a stage
- `recordDataQuality(operationId, stageName, qualityInfo)` - Record data quality info to a stage
- `recordDecisionMetrics(operationId, stageName, metrics)` - Record decision metrics to a stage
- `recordValidationResult(operationId, validationResults)` - Record validation results to an operation
- `recordDecisionPath(operationId, decisionPath)` - Record decision path to an operation
- `recordOperationDataQuality(operationId, dataQuality)` - Record data quality metrics to an operation
- `appendDecisionChoice(operationId, choice)` - Append a choice to existing decision path
- `aggregateValidationResults(operationId, stageName)` - Aggregate validation checks from a stage

#### Query & Management

- `getOperationsByCycle(cycleId)` - Get operations by cycle
- `getOperation(operationId)` - Get operation by ID
- `getSamplingState()` - Get current sampling state
- `shouldLog(logType, errorOccurred?)` - Check if should log based on log type
- `cleanup(maxCycles)` - Cleanup old data

## Quick Start

### Basic Usage

```typescript
import { UnifiedLogger } from '../logging/index.js';

// Get logger instance
const logger = UnifiedLogger.getInstance();
logger.initialize();

// Create trace context for a cycle
const traceContext = logger.createTraceContext(cycleId);

// Start an operation
const operationId = logger.startOperation(
  traceContext,
  'signal_generation',
  { symbols: ['BTC/USDT', 'ETH/USDT'] },
  'BTC/USDT'
);

// Track operation stages
logger.startStage(operationId, 'fetch_market_data');
// ... do work ...
logger.completeStage(operationId, 'fetch_market_data', { candles: 100 });

// Record metrics
logger.recordAPILatency('/api/ticker', 150);

// Complete operation
logger.completeOperation(operationId, 'completed', {
  signals: [{ symbol: 'BTC/USDT', action: 'LONG', confidence: 0.85 }],
});
```

## Operation Lifecycle

### 1. Starting Operations

Every operation has a unique ID and belongs to a trace (cycle-level grouping).

```typescript
// Create trace context
const traceContext = logger.createTraceContext(cycleId);

// Start operation
const operationId = logger.startOperation(
  traceContext, // Trace context
  'order_execution', // Operation type
  { orderId: '123' }, // Input data
  'BTC/USDT' // Optional symbol
);
```

**Operation Types**:

- `cycle_execution`: Complete trading cycle
- `signal_generation`: AI signal generation
- `order_execution`: Order placement/execution
- `position_monitoring`: Position updates
- `risk_validation`: Risk checks
- `account_sync`: Account data fetching

### 2. Tracking Stages

Operations can have multiple stages for detailed tracking.

```typescript
// Start a stage
logger.startStage(operationId, 'validate_risk', {
  maxPosition: 5,
  currentPositions: 3,
});

// ... perform validation ...

// Complete stage with output
logger.completeStage(operationId, 'validate_risk', {
  approved: true,
  reason: 'Within limits',
});
```

**Common Stages**:

- `fetch_account_data`: Fetch account information
- `fetch_market_data`: Fetch market/candlestick data
- `generate_signals`: AI signal generation
- `validate_risk`: Risk validation
- `execute_order`: Order placement
- `update_positions`: Position updates

### 3. Error Handling

Errors are automatically captured and aggregated.

```typescript
try {
  await riskyOperation();
  logger.completeOperation(operationId, 'completed', result);
} catch (error) {
  // Error is automatically captured in the operation log
  logger.completeOperation(operationId, 'failed', undefined, error);
  throw error; // Re-throw if needed
}
```

### 4. Completing Operations

```typescript
// Success
logger.completeOperation(operationId, 'completed', {
  result: 'Order placed successfully',
  orderId: 'order-123',
});

// Failure
logger.completeOperation(operationId, 'failed', undefined, error);

// Cancellation
logger.completeOperation(operationId, 'cancelled');
```

## Error Aggregation

The system automatically groups similar errors to reduce noise and identify patterns.

### Features

- **Time-windowed grouping**: Errors within a configurable window (default: 60s) are grouped
- **Fingerprinting**: Similar errors are identified by type and message
- **Trend detection**: Identifies increasing/decreasing error patterns
- **Severity calculation**: Based on frequency, affected symbols, and cycles
- **Recovery tracking**: Tracks recovery attempts and success rates

### Error Information

Each aggregated error includes:

```typescript
{
  fingerprint: string;        // Unique error identifier
  errorType: string;           // Error class name
  message: string;             // Error message
  firstOccurrence: number;     // First seen timestamp
  lastOccurrence: number;     // Most recent timestamp
  totalCount: number;          // Total occurrences
  affectedCycles: number[];    // Cycle IDs affected
  affectedSymbols: string[];   // Symbols affected
  severity: 'low' | 'medium' | 'high' | 'critical';
  trend: 'increasing' | 'stable' | 'decreasing';
  sampleErrors: ErrorInfo[];  // Sample of actual errors
  recoveryAttempts?: number;
  recoverySuccess?: boolean;
}
```

### Accessing Aggregated Errors

```typescript
// Get all aggregated errors
const errors = logger.getAggregatedErrors();

// Filter by severity
const criticalErrors = errors.filter(e => e.severity === 'critical');

// Check error trends
const increasingErrors = errors.filter(e => e.trend === 'increasing');
```

## System Snapshots

Periodic snapshots capture the complete system state for post-mortem analysis.

### Snapshot Content

```typescript
{
  snapshotId: string;
  timestamp: number;
  cycleId: number;
  account: {
    equity: number;
    balance: number;
    marginUsed: number;
    availableMargin: number;
  };
  positions: Array<{
    symbol: string;
    side: 'long' | 'short';
    size: number;
    entryPrice: number;
    unrealizedPnl: number;
  }>;
  systemMetrics: {
    uptime: number;
    errorRate: number;
    avgCycleTime: number;
    memoryUsage: { heapUsed, heapTotal, rss };
    apiLatency: { p50, p75, p90, p95, p99 };
  };
  circuitBreakers: Array<{ name, state, failures }>;
  errorSummary: Record<string, AggregatedError>;
  activeOperations: OperationLog[];
}
```

### Creating Snapshots

```typescript
const snapshot = logger.createSnapshot(cycleId, {
  account: accountData,
  positions: positionsData,
  circuitBreakers: circuitBreakerStates,
  recentOperations: operationsSummary,
});
```

Snapshots are automatically stored and can be retrieved later for analysis.

## Metrics Collection

Real-time metrics are collected automatically during runtime.

### Recorded Metrics

- **Operation Times**: Duration of each operation type (automatic)
- **API Latencies**: Response times for API calls (percentiles: p50, p75, p90, p95, p99)
- **Error Rates**: Errors per cycle, error types
- **Resource Usage**: CPU, memory usage
- **Business Metrics**: Signal generation success, order execution rates

### Recording Metrics

```typescript
// Record API latency
logger.recordAPILatency('/api/ticker', 150);

// Record cycle execution time
logger.recordCycleTime(cycleId, 2500);

// Record error directly
logger.recordError(error, { cycleId, symbol: 'BTC/USDT' });
```

### Accessing Metrics

```typescript
// Get metrics snapshot
const metrics = logger.getMetricsSnapshot(cycleId);

// Get error rate
const errorRate = logger.getErrorRate();

// Metrics include:
// - operationTimes: Record<string, number[]> (durations)
// - apiLatencies: Record<string, number[]> (latencies)
// - errorCounts: Record<string, number> (errors per type)
// - resourceUsage: { cpu, memory }
```

## Intelligent Sampling

The system dynamically adjusts logging detail based on system health to balance observability with performance.

### Sampling States

- **Normal**: Standard sampling rate (100% for operations, 0% for debug)
- **Warning**: Increased sampling (150% for operations, 50% for debug)
- **Critical**: Maximum sampling (200% for operations, 100% for debug)

### Sampling Factors

- Error rate thresholds
- Performance metrics
- Manual state override

### Checking Sampling State

```typescript
// Get current state
const state = logger.getSamplingState(); // 'normal' | 'warning' | 'critical'

// Check if should log
const shouldLog = logger.shouldLog('debug', false); // false in normal state
const shouldLogError = logger.shouldLog('debug', true); // true (errors always logged)
```

## System Health Monitoring

Monitor system health using metrics and error rates to identify issues early.

### Available Metrics

- **Error Rate**: Current error rate calculated from recent operations
- **Performance Metrics**: Latency, cycle times, and API response times
- **Memory Usage**: System memory usage tracked in snapshots
- **Operation Status**: Success/failure rates for different operation types

### Health Monitoring

You can monitor system health by:

- Increase sampling rate automatically
- Force immediate snapshot creation
- Trigger console warnings
- Store additional diagnostic information

### Checking System Health

```typescript
// Get current metrics snapshot
const metrics = logger.getMetricsSnapshot();

// Check error rate
const errorRate = logger.getErrorRate();
// - severity: 'low' | 'medium' | 'high' | 'critical'
// - message: string
// - metrics: Record<string, any>
```

## Storage Architecture

### Tiered Storage

The logging system uses a four-tier storage architecture:

```
L0: In-Memory Cache
  └─ Active operations, recent metrics (fast access)
  └─ Max size: 1000 operations (default)
  └─ Location: Memory (lost on restart)

L1: Hot Storage (SQLite - implemented)
  └─ Recent cycles, full operation records, queryable via SQL
  └─ Uses better-sqlite3 for high-performance synchronous queries
  └─ Max cycles: 1000 (default)
  └─ Location: logs/l1-operations.db
  └─ Automatic cleanup when exceeding l1MaxCycles (moves to L2)

L2: Warm Storage (File System)
  └─ Historical cycles, full operation records
  └─ Organized by cycle: logs/l2-history/cycle-{id}/
  └─ Each operation: {operationId}.json
  └─ Max cycles: 10000 (default)

L3: Cold Storage (Compressed Archive)
  └─ Old cycles, compressed with gzip
  └─ Location: logs/l3-archive/cycle-{id}.json.gz
  └─ Long-term retention
```

### Data Flow

1. **Write Flow**: Operations → L0 → L1 (if L0 full, batch move to L1)
2. **L1 Cleanup**: When L1 exceeds max cycles → Move oldest cycles to L2
3. **L2 Archive**: When L2 exceeds max cycles → Move oldest cycles to L3 (compressed)
4. **Query Flow**: Query → L0 → L1 → L2 → L3 (merged and deduplicated)

### Storage Optimization

- **Batch Writes**: Operations and snapshots are batched for efficient I/O via StorageOptimizer
- **Async Processing**: Storage operations don't block execution
- **SQLite WAL Mode**: L1 uses Write-Ahead Logging for better concurrency
- **Automatic Cleanup**: Old data is archived automatically (L1 → L2 → L3)
- **Manual Cleanup**: Use `quanta log cleanup` command to manually manage storage
- **Compression**: L3 storage uses gzip compression to save space
- **Indexed Queries**: L1 database has indexes on cycleId, traceId, operationType, status, symbol, and startTime for fast queries

### Storage Configuration

```typescript
const LOGGING_CONSTANTS = {
  STORAGE: {
    DEFAULT_LOG_DIR: './logs',
    L0_MAX_SIZE: 1000, // Max operations in memory
    L1_MAX_CYCLES: 1000, // Max cycles in SQLite
    L2_DIR: 'l2-history', // L2 directory name
    L3_DIR: 'l3-archive', // L3 directory name
  },
};
```

## Algorithm Correctness Verification

The logging system tracks detailed information to help verify algorithm correctness, including decision processes, validation results, data quality metrics, and execution validation.

### Viewing Algorithm Correctness Information

#### 1. Decision Process (Decision Path)

The decision path shows the step-by-step decisions made during an operation, including the reason for each decision and confidence levels.

```bash
# View decision paths in detailed output
quanta log query --verbose

# View specific operation's decision path
quanta log query --operation-id <operation-id> --verbose

# JSON format for complete decision path data
quanta log query --format json --verbose | jq '.operations[0].decisionPath'
```

**Decision Path Information:**

- `step`: Decision step name
- `decision`: The decision made
- `reason`: Explanation for the decision
- `confidence`: Confidence level (if available)
- `threshold`: Threshold value (if available)

#### 2. Validation Results

Validation results show all risk checks and validation tests performed, including which checks passed or failed and why.

```bash
# View validation results
quanta log query --verbose

# View failed operations and their validation failures
quanta log query --status failed --verbose

# View specific operation's validation results
quanta log query --operation-id <operation-id> --verbose
```

**Validation Results Information:**

- `passed`: Overall validation status
- `checks`: Array of validation checks
  - `check`: Check name (e.g., `signal_validation`, `position_sizing`)
  - `passed`: Whether the check passed
  - `reason`: Failure reason (if failed)
  - `details`: Additional validation details

**Common Validation Checks:**

- `signal_validation`: Signal format and confidence validation
- `position_sizing`: Position sizing calculation validation
- `execution_price_validation`: Execution price vs expected price (slippage check)

#### 3. Data Quality Metrics

Data quality metrics track the freshness, completeness, and gaps in input data used by algorithms.

```bash
# View data quality metrics
quanta log query --verbose

# View operations with data quality issues
quanta log query --format json | jq '.operations[] | select(.dataQuality.freshness.isStale == true)'

# View operations with data gaps
quanta log query --format json | jq '.operations[] | select(.dataQuality.gaps != null)'
```

**Data Quality Information:**

- `freshness`: Data age (in milliseconds)
  - `latestTimestamp`: Latest data timestamp
  - `ageMs`: Age of data in milliseconds
  - `isStale`: Whether data is stale (> 60 seconds)
- `completeness`: Data completeness metrics
  - `expectedItems`: Expected number of data items
  - `actualItems`: Actual number of data items
  - `missingItems`: List of missing items (if any)
- `gaps`: Array of data gaps
  - `symbol`: Symbol with gap
  - `timeframe`: Timeframe with gap
  - `missingFrom`: Gap start timestamp
  - `missingTo`: Gap end timestamp

#### 4. Stage-Level Information

Each stage within an operation can have its own validation checks, data quality metrics, and decision metrics.

```bash
# View stage-level details
quanta log query --verbose

# View specific stage validation checks
quanta log query --format json | jq '.operations[0].stages[] | select(.validationChecks != null)'
```

**Stage-Level Information:**

- **Validation Checks** (`validationChecks`): Per-stage validation checks
- **Data Quality** (`dataQuality`): Per-stage data quality metrics
- **Decision Metrics** (`decisionMetrics`): Decision-making metrics for the stage
  - `confidence`: Decision confidence level
  - `threshold`: Decision threshold
  - `reasoning`: Decision reasoning text
  - `factors`: Decision factors and context

### Example: Complete Algorithm Correctness Analysis

```bash
# Step 1: Find a trading cycle operation
quanta log query --type trading_cycle --limit 1 --verbose

# Step 2: View its decision path
quanta log query --type trading_cycle --format json | jq '.operations[0].decisionPath'

# Step 3: View validation results
quanta log query --type trading_cycle --format json | jq '.operations[0].validationResults'

# Step 4: View data quality
quanta log query --type trading_cycle --format json | jq '.operations[0].dataQuality'

# Step 5: View stage-level validation checks
quanta log query --type trading_cycle --format json | jq '.operations[0].stages[] | select(.validationChecks != null)'

# Step 6: View stage-level decision metrics
quanta log query --type trading_cycle --format json | jq '.operations[0].stages[] | select(.decisionMetrics != null)'
```

### Use Cases

#### 1. Verify Signal Generation Correctness

```bash
# View signal generation decision process
quanta log query --type trading_cycle --verbose | grep -A 30 "Decision Metrics"

# Check signal validation results
quanta log query --type trading_cycle --format json | jq '.operations[0].stages[] | select(.stage == "generate_signals") | .decisionMetrics'

# View market data quality used for signal generation
quanta log query --type trading_cycle --format json | jq '.operations[0].stages[] | select(.stage == "fetch_market_data") | .dataQuality'
```

#### 2. Verify Order Execution Correctness

```bash
# View execution validation (price slippage)
quanta log query --type trading_cycle --verbose | grep -A 20 "execution_price_validation"

# Check validation results for signal execution
quanta log query --type trading_cycle --format json | jq '.operations[0].stages[] | select(.stage == "execute_signals") | .validationChecks'
```

**Execution Validation Details:**

When using `--verbose`, execution validation shows detailed information for `execution_price_validation`:

- **Expected Price**: The market price when the signal was generated
- **Actual Price**: The actual execution price from the exchange
- **Slippage**: Price deviation percentage (colored: green ≤1%, yellow ≤3%, red >3%)
- **Order ID**: The exchange order ID
- **Realized P&L**: Profit or loss from the trade
- **Fees**: Trading fees charged
- **Size, Leverage, Risk**: Position sizing details

**Example Output:**

```
🔍 Validation Checks (execute_signals):
   ✓ execution_price_validation
      └─ Actual: 0.15, Threshold: 5
      └─ Expected Price: $45000.00, Actual Price: $45067.50
      └─ Slippage: 0.150%
      └─ Order ID: order-123456
      └─ Realized P&L: $0.00
      └─ Fees: $0.90
      └─ Size: 0.001, Leverage: 2x, Risk: $10.00
```

#### 3. Identify Data Quality Issues

```bash
# Find operations with stale data
quanta log query --format json | jq '.operations[] | select(.dataQuality.freshness.isStale == true)'

# Find operations with data gaps
quanta log query --format json | jq '.operations[] | select(.dataQuality.gaps != null and (.dataQuality.gaps | length) > 0)'

# Find operations with incomplete data
quanta log query --format json | jq '.operations[] | select(.dataQuality.completeness.actualItems < .dataQuality.completeness.expectedItems)'
```

#### 4. Analyze Validation Failures

```bash
# View all failed validations
quanta log query --status failed --verbose | grep -A 10 "Validation Results"

# Find operations rejected due to position sizing
quanta log query --format json | jq '.operations[] | select(.stages[].validationChecks[]?.name == "position_sizing" and .stages[].validationChecks[]?.passed == false)'
```

### Programmatic Access

```typescript
import { QueryInterface } from '../logging/index.js';

const query = QueryInterface.getInstance();

// Query operations with algorithm correctness information
const result = await query.queryOperations({
  cycleId: 2,
  operationType: 'trading_cycle',
  limit: 10,
});

for (const op of result.operations) {
  // Access decision path
  if (op.decisionPath) {
    console.log('Decision Path:', op.decisionPath.choices);
  }

  // Access validation results
  if (op.validationResults) {
    console.log('Validation Results:', op.validationResults.checks);
  }

  // Access data quality
  if (op.dataQuality) {
    console.log('Data Quality:', {
      freshness: op.dataQuality.freshness,
      completeness: op.dataQuality.completeness,
      gaps: op.dataQuality.gaps,
    });
  }

  // Access stage-level information
  for (const stage of op.stages) {
    if (stage.validationChecks) {
      console.log(`Stage ${stage.stage} validation:`, stage.validationChecks);
    }
    if (stage.dataQuality) {
      console.log(`Stage ${stage.stage} data quality:`, stage.dataQuality);
    }
    if (stage.decisionMetrics) {
      console.log(`Stage ${stage.stage} decision:`, stage.decisionMetrics);
    }
  }
}
```

## Query Interface

### CLI Commands

#### Query Operations

```bash
# Query all operations
quanta log query

# Filter by cycle
quanta log query --cycle-id 42

# Filter by operation type
quanta log query --type signal_generation

# Filter by status
quanta log query --status failed

# Filter by symbol
quanta log query --symbol BTC/USDT

# Filter by trace ID
quanta log query --trace-id trace-42-1234567890

# Combined filters
quanta log query --cycle-id 42 --type order_execution --status failed

# Pagination
quanta log query --limit 20 --offset 0

# JSON output
quanta log query --format json

# Detailed view with algorithm correctness information
quanta log query --verbose
quanta log query --detail
```

#### Statistics

```bash
# Overall statistics
quanta log stats

# Filtered statistics
quanta log stats --cycle-id 42 --type signal_generation

# JSON output
quanta log stats --format json
```

#### Trace Viewing

```bash
# View complete trace
quanta log trace trace-42-1234567890

# JSON output
quanta log trace trace-42-1234567890 --format json
```

#### Search

```bash
# Search by keyword
quanta log search "API timeout"

# Filtered search
quanta log search "error" --type order_execution --status failed

# Pagination
quanta log search "signal" --limit 10 --offset 0
```

#### Snapshots

```bash
# View latest snapshot
quanta log snapshot

# View specific snapshot
quanta log snapshot snapshot-abc123

# JSON output
quanta log snapshot --format json
```

#### Storage Statistics

```bash
# View storage statistics
quanta log storage
```

Output:

```
💾 Storage Statistics
Log storage layer information

📦 Storage Layers:
   L0 (Hot Cache): 50 operations
   L1 (Warm): 5 cycles
   L2 (Cold): 20 cycles
   L3 (Archive): 10 cycles
   Total Operations: 5000
```

#### Cleanup

```bash
# Preview cleanup (dry-run)
quanta log cleanup --dry-run

# Cleanup: keep only last 500 cycles (archives older to L3)
quanta log cleanup --max-cycles 500

# Cleanup: keep only logs from last 7 days (permanently deletes older)
quanta log cleanup --keep-days 7

# Cleanup with force (no confirmation)
quanta log cleanup --keep-days 7 --force

# Default cleanup (keeps 1000 most recent cycles)
quanta log cleanup
```

**Cleanup Strategies:**

1. **By Cycle Count** (`--max-cycles`): Archives older cycles to L3 (data still accessible but compressed)
2. **By Days** (`--keep-days`): Permanently deletes old data from all storage layers (L1, L2, L3)

### Programmatic API

```typescript
import { QueryInterface } from '../logging/index.js';
import { UnifiedLogger } from '../logging/index.js';

const query = QueryInterface.getInstance();
const logger = UnifiedLogger.getInstance();

// Query operations
const result = await query.queryOperations({
  cycleId: 42,
  operationType: 'signal_generation',
  status: 'completed',
  limit: 50,
});

// Get statistics
const stats = await query.getStatistics({
  cycleId: 42,
  operationType: 'order_execution',
});

// Search operations
const searchResults = await query.searchOperations('timeout', {
  limit: 20,
});

// Get complete trace
const trace = await query.getTrace('trace-42-1234567890');

// Get operations by cycle
const cycleOps = await logger.getOperationsByCycle(42);

// Get snapshot
const snapshot = await logger.getSnapshotById('snapshot-abc123');
```

## Integration with Workflow

The logging system is integrated into the main trading workflow.

### Workflow Integration Points

```typescript
// In TradingWorkflow class

async executeCycle() {
  // Create trace context
  const traceContext = this.unifiedLogger.createTraceContext(this.state.cycleCount);

  // Start cycle operation
  const cycleOpId = this.unifiedLogger.startOperation(
    traceContext,
    'cycle_execution',
    { cycleId: this.state.cycleCount }
  );

  try {
    // Fetch account data (stage)
    this.unifiedLogger.startStage(cycleOpId, 'fetch_account_data');
    const account = await this.exchange.getAccount();
    this.unifiedLogger.completeStage(cycleOpId, 'fetch_account_data', { balance: account.balance });

    // Generate signals (stage)
    this.unifiedLogger.startStage(cycleOpId, 'generate_signals');
    const signals = await this.generateSignals();
    this.unifiedLogger.completeStage(cycleOpId, 'generate_signals', { signalCount: signals.length });

    // Record API latency
    const startTime = Date.now();
    const marketData = await this.exchange.getMarketData();
    this.unifiedLogger.recordAPILatency('/api/market-data', Date.now() - startTime);

    // Execute signals (stage)
    this.unifiedLogger.startStage(cycleOpId, 'execute_signals');
    const orders = await this.executeSignals(signals);
    this.unifiedLogger.completeStage(cycleOpId, 'execute_signals', { ordersPlaced: orders.length });

    // Create snapshot
    const snapshot = this.unifiedLogger.createSnapshot(
      this.state.cycleCount,
      { account, positions, circuitBreakers, recentOperations }
    );

    // Complete cycle
    this.unifiedLogger.completeOperation(cycleOpId, 'completed', {
      signalsProcessed: signals.length,
      ordersPlaced: orders.length
    });
  } catch (error) {
    this.unifiedLogger.completeOperation(cycleOpId, 'failed', undefined, error);
    throw error;
  }
}
```

## Best Practices

### 1. Use Appropriate Operation Types

```typescript
// ✅ Good: Specific operation type
logger.startOperation(traceContext, 'signal_generation', data);

// ❌ Bad: Generic type
logger.startOperation(traceContext, 'operation', data);
```

### 2. Track Meaningful Stages

```typescript
// ✅ Good: Clear stage names
logger.startStage(opId, 'fetch_market_data');
logger.startStage(opId, 'validate_risk');
logger.startStage(opId, 'execute_order');

// ❌ Bad: Vague stages
logger.startStage(opId, 'step1');
logger.startStage(opId, 'step2');
```

### 3. Include Context in Input/Output

```typescript
// ✅ Good: Rich context
logger.startOperation(traceContext, 'order_execution', {
  orderId: '123',
  symbol: 'BTC/USDT',
  side: 'buy',
  amount: 0.1,
  price: 45000,
});

// ❌ Bad: Minimal context
logger.startOperation(traceContext, 'order_execution', {});
```

### 4. Handle Errors Properly

```typescript
// ✅ Good: Capture error details
try {
  await operation();
  logger.completeOperation(opId, 'completed', result);
} catch (error) {
  logger.completeOperation(opId, 'failed', undefined, error);
  throw error; // Re-throw if needed
}

// ❌ Bad: Swallow errors
try {
  await operation();
} catch (error) {
  // Error not logged!
}
```

### 5. Create Snapshots at Key Points

```typescript
// ✅ Good: Regular snapshots
if (this.state.cycleCount % 10 === 0) {
  logger.createSnapshot(this.state.cycleCount, snapshotData);
}

// ✅ Good: Before critical operations
logger.createSnapshot(cycleId, snapshotData);
await criticalOperation();
```

### 6. Use Query Interface for Analysis

```typescript
// ✅ Good: Analyze patterns
const failedOps = await query.queryOperations({
  status: 'failed',
  operationType: 'order_execution',
});

// Analyze error trends
const stats = await query.getStatistics({
  operationType: 'signal_generation',
});
```

### 7. Monitor Storage Usage

```typescript
// ✅ Good: Regular cleanup
await logger.cleanup(1000); // Keep last 1000 cycles

// Or use CLI
// quanta log cleanup --max-cycles 1000
```

## Configuration

### Storage Configuration

Default storage configuration:

```typescript
const LOGGING_CONSTANTS = {
  STORAGE: {
    DEFAULT_LOG_DIR: './logs',
    L0_MAX_SIZE: 1000, // Max operations in memory
    L1_MAX_CYCLES: 1000, // Max cycles in SQLite (hot storage)
    L2_DIR: 'l2-history', // L2 directory name
    L3_DIR: 'l3-archive', // L3 directory name
  },
};
```

### Manual Cleanup

You can manually clean up old logs using the CLI:

```bash
# Preview what would be cleaned
quanta log cleanup --dry-run

# Keep only last 500 cycles (archives older to L3)
quanta log cleanup --max-cycles 500

# Keep only logs from last 7 days (permanently deletes older)
quanta log cleanup --keep-days 7

# Force cleanup without confirmation
quanta log cleanup --keep-days 7 --force
```

**Cleanup Strategies:**

1. **By Cycle Count** (`--max-cycles`): Archives older cycles to L3 (data still accessible but compressed)
2. **By Days** (`--keep-days`): Permanently deletes old data from all storage layers (L1, L2, L3)

### Sampling Configuration

```typescript
const LOGGING_CONSTANTS = {
  SAMPLING: {
    NORMAL_RATE: 1.0, // 100% in normal state
    WARNING_RATE: 1.5, // 150% in warning state
    CRITICAL_RATE: 2.0, // 200% in critical state
  },
};
```

### Monitoring Thresholds

```typescript
// Recommended thresholds for monitoring
const MONITORING_THRESHOLDS = {
  ERROR_RATE_WARNING: 0.05, // 5% error rate
  ERROR_RATE_CRITICAL: 0.1, // 10% error rate
  LATENCY_DEGRADATION: 2.0, // 2x latency increase
  MEMORY_GROWTH: 0.05, // 5% memory increase per cycle
};
```

## Troubleshooting

### No Operations Appearing in Queries

- Check if `logger.initialize()` was called
- Verify operations are being started and completed
- Check storage layer for errors (L1 database initialization)
- Verify cycle IDs match
- Check L1 database is accessible: `ls logs/l1-operations.db`

### High Memory Usage

- Reduce L0 cache size (L0_MAX_SIZE)
- Enable automatic cleanup (L1 → L2 → L3)
- Archive old cycles manually: `quanta log cleanup --max-cycles 500`
- Reduce snapshot frequency

### Slow Queries

- Use filters to narrow results
- Query result caching is enabled by default (60s TTL)
- Consider archiving old data to L3
- Use pagination for large result sets
- L1 SQLite indexes should speed up queries

### Missing Snapshots

- Check snapshot creation is being called
- Verify snapshot is stored: `quanta log snapshot`
- Check storage layer permissions
- Review error logs

### L1 Database Issues

- Check database file exists: `ls logs/l1-operations.db`
- Verify database is initialized (automatic on first query)
- Check for database corruption (SQLite will log errors)
- Fallback: System automatically falls back to L2 file storage if L1 fails

## Examples

### Complete Operation Example

```typescript
const traceContext = logger.createTraceContext(cycleId);
const opId = logger.startOperation(traceContext, 'order_execution', {
  orderId: '123',
  symbol: 'BTC/USDT',
  side: 'buy',
  amount: 0.1,
});

// Stage 1: Validate
logger.startStage(opId, 'validate_order');
const validation = await validateOrder(orderData);
logger.completeStage(opId, 'validate_order', { approved: true });

// Stage 2: Check risk
logger.startStage(opId, 'check_risk');
const riskCheck = await checkRisk(orderData);
logger.completeStage(opId, 'check_risk', { passed: true });

// Stage 3: Execute
logger.startStage(opId, 'place_order');
const order = await exchange.placeOrder(orderData);
logger.completeStage(opId, 'place_order', { orderId: order.id });

// Complete
logger.completeOperation(opId, 'completed', { order });
```

### Error Analysis Example

```typescript
// Query failed operations
const failedOps = await query.queryOperations({
  status: 'failed',
  operationType: 'order_execution',
});

// Analyze patterns
const errorsBySymbol = {};
for (const op of failedOps.operations) {
  const symbol = op.symbol || 'unknown';
  errorsBySymbol[symbol] = (errorsBySymbol[symbol] || 0) + 1;
}

console.log('Errors by symbol:', errorsBySymbol);

// Get full trace for investigation
const trace = await query.getTrace(failedOps.operations[0].traceId);
console.log('Full trace:', trace);

// Get aggregated errors
const aggregatedErrors = logger.getAggregatedErrors();
const criticalErrors = aggregatedErrors.filter(e => e.severity === 'critical');
console.log('Critical errors:', criticalErrors);
```

### Performance Analysis Example

```typescript
// Get statistics
const stats = await query.getStatistics({
  operationType: 'signal_generation',
});

console.log(`Average duration: ${stats.averageDuration}ms`);
console.log(`Success rate: ${(1 - stats.errorRate) * 100}%`);
console.log(`Total operations: ${stats.totalOperations}`);

// Compare cycles
const cycle1Stats = await query.getStatistics({ cycleId: 1 });
const cycle2Stats = await query.getStatistics({ cycleId: 2 });

console.log(`Cycle 1 avg: ${cycle1Stats.averageDuration}ms`);
console.log(`Cycle 2 avg: ${cycle2Stats.averageDuration}ms`);

// Get metrics snapshot
const metrics = logger.getMetricsSnapshot(cycleId);
console.log('API latencies:', metrics.apiLatencies);
console.log('Error rate:', logger.getErrorRate());
```

### Storage Management Example

```typescript
// Check storage stats
const storage = StorageLayer.getInstance();
const stats = await storage.getStats();
console.log(`L0: ${stats.l0Size} ops, L1: ${stats.l1Cycles} cycles`);

// Manual cleanup
await logger.cleanup(500); // Keep last 500 cycles

// Or cleanup by days
await storage.cleanupByDays(7); // Keep last 7 days
```

## Advanced Usage

### Custom Metrics

```typescript
// Record custom business metric (note: UnifiedLogger doesn't have recordMetric method)
// Use MetricsCollector directly for custom metrics
```

**Note**: The `UnifiedLogger` provides `recordAPILatency` and `recordCycleTime` methods. For custom metrics not covered by these methods, use `MetricsCollector` directly:

```typescript
import { MetricsCollector } from '../logging/index.js';

const metrics = MetricsCollector.getInstance();
metrics.recordMetric('custom_metric', value, {
  category: 'trading',
  metadata: { extra: 'data' },
});
```

### Nested Operations

```typescript
// Parent operation
const parentOpId = logger.startOperation(traceContext, 'cycle_execution', {});

// Child operation (manual nesting via trace context)
const childTraceContext = {
  traceId: parentOpId, // Use parent operation ID as trace
  cycleId: cycleId,
};
const childOpId = logger.startOperation(childTraceContext, 'signal_generation', {});

// Complete child
logger.completeOperation(childOpId, 'completed', {});

// Complete parent
logger.completeOperation(parentOpId, 'completed', {});
```

### Monitoring System Health

```typescript
// Monitor system health periodically
setInterval(() => {
  const errorRate = logger.getErrorRate();
  const metrics = logger.getMetricsSnapshot();
  if (errorRate > 0.05) {
    console.warn('High error rate detected:', errorRate);

    // Create emergency snapshot on critical conditions
    if (errorRate > 0.1) {
      const snapshot = logger.createSnapshot(cycleId, snapshotData);
    }
  }
}, 60000); // Check every minute
```

### Query Optimization

```typescript
// Use specific filters to improve performance
const result = await query.queryOperations({
  cycleId: 42, // Use cycle ID for fast L1 lookup
  operationType: 'order_execution', // Filter by type
  status: 'failed', // Filter by status
  limit: 50, // Limit results
});

// Use pagination for large datasets
let offset = 0;
const pageSize = 100;
let hasMore = true;

while (hasMore) {
  const page = await query.queryOperations({
    cycleId: 42,
    limit: pageSize,
    offset,
  });

  // Process page
  processOperations(page.operations);

  hasMore = page.hasMore;
  offset += pageSize;
}
```

---

## Summary

This logging system is designed for production use and provides comprehensive observability for the Quanta trading system. Key features:

- ✅ **Operation-driven tracking** - Complete lifecycle visibility
- ✅ **Intelligent error aggregation** - Reduced noise, better insights
- ✅ **System snapshots** - Post-mortem analysis capability
- ✅ **Tiered storage** - Efficient data management (L0 → L1 → L2 → L3)
- ✅ **Powerful query interface** - CLI and programmatic access
- ✅ **Automatic cleanup** - Storage management with manual overrides

All logs are stored in tiered storage with automatic cleanup and manual management via CLI commands. The system scales efficiently from development to production environments.

---

**Last Updated**: January 2025  
**Version**: 0.3.0

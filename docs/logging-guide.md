# Logging System Guide

Complete guide to Quanta's operation-driven logging system.

## Overview

Quanta uses a sophisticated **operation-driven logging system** that tracks the complete lifecycle of operations, aggregates errors intelligently, captures system state snapshots, and provides powerful query capabilities for analysis and debugging.

### Key Features

- **Operation Lifecycle Tracking**: Track complete operation flows with stages, inputs, outputs, and errors
- **Intelligent Error Aggregation**: Group similar errors to reduce noise and identify patterns
- **System State Snapshots**: Periodic capture of critical system state for post-mortem analysis
- **Real-time Metrics**: Collect and monitor performance metrics during runtime
- **Intelligent Sampling**: Dynamically adjust logging detail based on system health
- **Anomaly Detection**: Automatically detect and respond to unusual system patterns
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
         │                                  │
┌────────▼──────────┐              ┌─────────▼─────────┐
│StateSnapshot     │              │AnomalyDetector   │
└──────────────────┘              └──────────────────┘
         │                                  │
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
- **AnomalyDetector**: Detects unusual patterns (error spikes, performance degradation)
- **StorageLayer**: Manages tiered storage (L0: memory, L1: SQLite, L2: files, L3: archive)
- **StorageOptimizer**: Batches writes for efficient I/O
- **QueryInterface**: Provides query and analysis capabilities

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
- Performance degradation
- Anomaly detection triggers
- Manual state override

### Checking Sampling State

```typescript
// Get current state
const state = logger.getSamplingState(); // 'normal' | 'warning' | 'critical'

// Check if should log
const shouldLog = logger.shouldLog('debug', false); // false in normal state
const shouldLogError = logger.shouldLog('debug', true); // true (errors always logged)
```

## Anomaly Detection

Automatic detection of unusual patterns to help identify issues early.

### Detected Anomalies

- **Error Rate Spike**: Sudden increase in error frequency (>10% threshold)
- **Performance Degradation**: Unusual latency increases (>2x threshold)
- **Memory Leak**: Continuously increasing memory usage (>5% per cycle)
- **API Timeout Pattern**: Repeated timeouts from same endpoint

### Anomaly Response

When anomalies are detected, the system can:

- Increase sampling rate automatically
- Force immediate snapshot creation
- Trigger console warnings
- Store additional diagnostic information

### Checking Anomalies

```typescript
// Check for anomalies
const anomalies = logger.checkAnomalies();

// Anomalies include:
// - type: 'error_rate_spike' | 'performance_degradation' | 'memory_leak' | 'api_timeout'
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
    L0_MAX_SIZE: 1000,        // Max operations in memory
    L1_MAX_CYCLES: 1000,      // Max cycles in SQLite
    L2_DIR: 'l2-history',     // L2 directory name
    L3_DIR: 'l3-archive',      // L3 directory name
  },
};
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
    L0_MAX_SIZE: 1000,        // Max operations in memory
    L1_MAX_CYCLES: 1000,      // Max cycles in SQLite (hot storage)
    L2_DIR: 'l2-history',    // L2 directory name
    L3_DIR: 'l3-archive',      // L3 directory name
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
    NORMAL_RATE: 1.0,    // 100% in normal state
    WARNING_RATE: 1.5,   // 150% in warning state
    CRITICAL_RATE: 2.0,  // 200% in critical state
  },
};
```

### Anomaly Detection Thresholds

```typescript
const LOGGING_CONSTANTS = {
  ANOMALY: {
    ERROR_RATE_SPIKE: 0.1,        // 10% error rate threshold
    LATENCY_DEGRADATION: 2.0,      // 2x latency increase
    MEMORY_LEAK_RATE: 0.05,        // 5% memory increase per cycle
  },
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
// Record custom business metric
logger.recordMetric('custom_metric', value, {
  category: 'trading',
  metadata: { extra: 'data' },
});
```

**Note**: The UnifiedLogger uses `recordAPILatency` and `recordCycleTime` methods. For custom metrics, use MetricsCollector directly:

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

### Monitoring Anomalies

```typescript
// Check for anomalies periodically
setInterval(() => {
  const anomalies = logger.checkAnomalies();
  if (anomalies.length > 0) {
    console.warn('Anomalies detected:', anomalies);
    
    // Force snapshot on critical anomalies
    const criticalAnomalies = anomalies.filter(a => a.severity === 'critical');
    if (criticalAnomalies.length > 0) {
      // Create emergency snapshot
      const snapshot = logger.createSnapshot(cycleId, snapshotData);
    }
  }
}, 60000); // Check every minute
```

### Query Optimization

```typescript
// Use specific filters to improve performance
const result = await query.queryOperations({
  cycleId: 42,              // Use cycle ID for fast L1 lookup
  operationType: 'order_execution', // Filter by type
  status: 'failed',         // Filter by status
  limit: 50,                // Limit results
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
**Version**: 0.1.0

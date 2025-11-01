# Logging System Guide

Complete guide to Quanta's new operation-driven logging system.

## Overview

Quanta uses a sophisticated **operation-driven logging system** that tracks the complete lifecycle of operations, aggregates errors intelligently, captures system state snapshots, and provides powerful query capabilities for analysis and debugging.

### Key Features

- **Operation Lifecycle Tracking**: Track complete operation flows with stages, inputs, outputs, and errors
- **Intelligent Error Aggregation**: Group similar errors to reduce noise and identify patterns
- **System State Snapshots**: Periodic capture of critical system state for post-mortem analysis
- **Real-time Metrics**: Collect and monitor performance metrics during runtime
- **Intelligent Sampling**: Dynamically adjust logging detail based on system health
- **Anomaly Detection**: Automatically detect and respond to unusual system patterns
- **Tiered Storage**: Efficient multi-level storage (memory → hot → warm → cold)
- **Query Interface**: Powerful CLI and programmatic query capabilities
- **Backward Compatibility**: Works alongside existing logger for gradual migration

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
logger.recordMetric('api_latency', 150, { endpoint: '/api/ticker' });

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
} catch (error) {
  // Error is automatically captured in the operation log
  logger.completeOperation(operationId, 'failed', undefined, error);
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

The system automatically groups similar errors to reduce noise.

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

## System Snapshots

Periodic snapshots capture the complete system state.

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

## Metrics Collection

Real-time metrics are collected automatically.

### Recorded Metrics

- **Operation Times**: Duration of each operation type
- **API Latencies**: Response times for API calls (percentiles)
- **Error Rates**: Errors per cycle, error types
- **Resource Usage**: CPU, memory usage
- **Business Metrics**: Signal generation success, order execution rates

### Recording Metrics

```typescript
// Record API latency
logger.recordMetric('api_latency', 150, {
  endpoint: '/api/ticker',
  method: 'GET',
});

// Record operation time (automatic)
// Metrics are recorded when operations complete

// Record signal generation
logger.recordMetric('signal_generation', 1, {
  success: true,
  signalCount: 3,
});
```

## Intelligent Sampling

The system dynamically adjusts logging detail based on system health.

### Sampling States

- **Normal**: Standard sampling rate (default: 100%)
- **Warning**: Increased sampling (150%)
- **Critical**: Maximum sampling (200%)

### Sampling Factors

- Error rate thresholds
- Performance degradation
- Anomaly detection triggers
- Manual override

## Anomaly Detection

Automatic detection of unusual patterns.

### Detected Anomalies

- **Error Rate Spike**: Sudden increase in error frequency
- **Performance Degradation**: Unusual latency increases
- **Memory Leak**: Continuously increasing memory usage
- **API Timeout Pattern**: Repeated timeouts from same endpoint

### Anomaly Response

When anomalies are detected, the system can:

- Increase sampling rate automatically
- Force immediate snapshot creation
- Trigger alerts (console warnings)
- Store additional diagnostic information

## Storage Architecture

### Tiered Storage

```
L0: In-Memory Cache
  └─ Active operations, recent metrics (fast access)

L1: Hot Storage (SQLite - planned)
  └─ Recent cycles, frequently accessed data

L2: Warm Storage (File System)
  └─ Organized by cycle: logs/l2-history/cycle-{id}/

L3: Cold Storage (Compressed Archive)
  └─ Old cycles, compressed: logs/l3-archive/cycle-{id}.json.gz
```

### Storage Optimization

- **Batch Writes**: Operations and snapshots are batched for efficient I/O
- **Async Processing**: Storage operations don't block execution
- **Automatic Cleanup**: Old data is archived automatically
- **Compression**: L3 storage uses gzip compression

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

### Programmatic API

```typescript
import { QueryInterface } from '../logging/index.js';

const query = QueryInterface.getInstance();

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

// Search
const searchResults = await query.searchOperations('timeout', {
  limit: 20,
});

// Get trace
const trace = await query.getTrace('trace-42-1234567890');
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

    // ... more stages ...

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

## Configuration

### Storage Configuration

```typescript
// In unified-logger initialization
const storageConfig = {
  l0MaxSize: 1000, // Max operations in memory
  l1MaxCycles: 10, // Max cycles in hot storage
  l2RetentionDays: 7, // Days to keep in warm storage
  l3RetentionDays: 30, // Days to keep in cold storage
  snapshotInterval: 60000, // Snapshot interval (ms)
};
```

### Sampling Configuration

```typescript
const samplingConfig = {
  normalRate: 1.0, // 100% in normal state
  warningRate: 1.5, // 150% in warning state
  criticalRate: 2.0, // 200% in critical state
};
```

### Anomaly Detection Thresholds

```typescript
const anomalyThresholds = {
  errorRateSpike: 0.1, // 10% error rate threshold
  latencyDegradation: 2.0, // 2x latency increase
  memoryLeakRate: 0.05, // 5% memory increase per cycle
};
```

## Migration from Old Logger

The new logging system works alongside the existing logger.

### Coexistence

```typescript
// Old logger (still works)
import { Logger } from '../utils/logger.js';
const logger = Logger.getInstance('Module');

// New logger (for operation tracking)
import { UnifiedLogger } from '../logging/index.js';
const unifiedLogger = UnifiedLogger.getInstance();
```

### Gradual Migration

1. **Phase 1**: Use both loggers (current state)
2. **Phase 2**: Migrate operation tracking to UnifiedLogger
3. **Phase 3**: Migrate all logging to UnifiedLogger (future)

## Troubleshooting

### No Operations Appearing in Queries

- Check if `logger.initialize()` was called
- Verify operations are being started and completed
- Check storage layer for errors
- Verify cycle IDs match

### High Memory Usage

- Reduce L0 cache size
- Enable automatic cleanup
- Archive old cycles manually
- Reduce snapshot frequency

### Slow Queries

- Use filters to narrow results
- Enable query result caching
- Consider archiving old data
- Use pagination for large result sets

### Missing Snapshots

- Check snapshot interval configuration
- Verify snapshot creation is being called
- Check storage layer permissions
- Review error logs

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

### Nested Operations

```typescript
// Parent operation
const parentOpId = logger.startOperation(traceContext, 'cycle_execution', {});

// Child operation
const childTraceContext = logger.createNestedContext(parentOpId);
const childOpId = logger.startOperation(childTraceContext, 'signal_generation', {});

// Complete child
logger.completeOperation(childOpId, 'completed', {});

// Complete parent
logger.completeOperation(parentOpId, 'completed', {});
```

### Tags and Context

```typescript
// Add tags
logger.addTags(operationId, 'trading', 'high-priority', 'experimental');

// Update context
logger.updateOperationContext(operationId, {
  accountState: { equity: 10000 },
  marketState: { volatility: 'high' },
});
```

---

**Note**: This new logging system is designed for production use and provides comprehensive observability for the Quanta trading system. For basic logging needs, the existing `Logger` class is still available and works alongside the new system.

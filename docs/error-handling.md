# Error Handling & Resilience

This document describes the error handling and resilience strategies implemented in Quanta to ensure reliable operation even when external services fail.

## Overview

Quanta implements multiple layers of error handling and resilience patterns:

1. **Retry Logic with Exponential Backoff** - Automatically retry failed operations
2. **Circuit Breaker Pattern** - Prevent cascading failures
3. **Stale Data Caching** - Use cached market data when live fetches fail
4. **Graceful Degradation** - Continue operating with reduced functionality

## Architecture

```
┌─────────────────────────────────────────┐
│         Application Layer               │
│    (Workflow, Trading Logic)            │
└────────────────┬────────────────────────┘
                 │
┌────────────────▼────────────────────────┐
│      Resilience Layer                   │
│  • Circuit Breakers                     │
│  • Retry Logic                          │
│  • Caching                              │
└────────────────┬────────────────────────┘
                 │
┌────────────────▼────────────────────────┐
│       External Services                 │
│  • OpenRouter AI API                    │
│  • Exchange APIs (OKX, Binance)         │
│  • Market Data Providers                │
└─────────────────────────────────────────┘
```

## Components

### 1. Retry Utility (`src/utils/retry.ts`)

Provides automatic retry with exponential backoff and jitter.

#### Features

- **Exponential Backoff**: Delay increases exponentially (baseDelay × 2^attempt)
- **Jitter**: Random 0-25% variance to prevent thundering herd
- **Smart Retry Logic**: Only retries network errors, timeouts, and 5xx errors
- **Timeout Support**: Overall timeout for all retry attempts
- **Callbacks**: `onRetry` callback for logging and monitoring

#### Usage

```typescript
import { withRetry, createRetryConfig } from './utils/retry.js';

const data = await withRetry(
  async () => {
    return await apiCall();
  },
  createRetryConfig({
    maxRetries: 3,
    baseDelay: 1000,
    maxDelay: 10000,
    onRetry: (attempt, error) => {
      console.log(`Retry attempt ${attempt}:`, error);
    },
  })
);
```

#### Default Behavior

- Network errors (ECONNREFUSED, ETIMEDOUT, etc.) → **Retry**
- Abort errors → **Retry**
- 5xx server errors → **Retry**
- 429 rate limit errors → **Retry**
- 4xx client errors (except 429) → **No retry** (likely auth or validation issues)

#### Configuration

```json
{
  "resilience": {
    "retry": {
      "maxRetries": 3,
      "baseDelay": 1000,
      "maxDelay": 10000
    }
  }
}
```

### 2. Circuit Breaker (`src/utils/circuit-breaker.ts`)

Prevents cascading failures by "opening" the circuit after repeated failures.

#### States

```
                     ┌──────────────┐
                     │   CLOSED     │
                     │  (Normal)    │
                     └──────┬───────┘
                            │
                    failures ≥ threshold
                            │
                     ┌──────▼───────┐
                     │     OPEN     │
                     │  (Failing)   │
                     └──────┬───────┘
                            │
                     reset timeout
                            │
                  ┌─────────▼────────┐
                  │   HALF_OPEN      │
                  │   (Testing)      │
                  └─────────┬────────┘
                            │
              ┌─────────────┴─────────────┐
              │                           │
          success                     failure
              │                           │
       ┌──────▼───────┐          ┌───────▼──────┐
       │   CLOSED     │          │     OPEN     │
       └──────────────┘          └──────────────┘
```

#### Features

- **Failure Tracking**: Counts consecutive failures
- **Auto Recovery**: Attempts to close after timeout
- **Fallback Support**: Optional fallback function when circuit is open
- **Statistics**: Exposes metrics on state, failures, successes

#### Usage

```typescript
import { createCircuitBreaker } from './utils/circuit-breaker.js';

const breaker = createCircuitBreaker('ServiceName', {
  failureThreshold: 5,
  resetTimeout: 60000,
  halfOpenMaxAttempts: 2,
});

const result = await breaker.execute(
  async () => {
    return await riskyOperation();
  },
  async () => {
    // Fallback when circuit is open
    return cachedValue;
  }
);
```

#### Configuration

```json
{
  "resilience": {
    "circuitBreaker": {
      "failureThreshold": 5,
      "resetTimeout": 60000,
      "halfOpenMaxAttempts": 3
    }
  }
}
```

### 3. Stale Data Caching (`src/data/market.ts`)

Market data provider caches successful fetches and uses stale data when live fetches fail.

#### Features

- **Automatic Caching**: Successful market data fetches are cached automatically
- **Fallback on Failure**: Uses cached data when fetch fails
- **Staleness Indicators**: Cached data is marked with `isStale` and `cacheAge`
- **Age Limits**: Cache expires after 5 minutes (configurable)
- **Per-Symbol Cache**: Separate cache entries for each coin/timeframe combination

#### Behavior

1. **Normal Operation**: Fetch live data → cache it → return fresh data
2. **Fetch Fails**: Return cached data if available and not too old
3. **No Cache**: Skip timeframe or throw error (depends on context)

#### Cache Key Format

```
{coin}:{timeframe}
Example: BTC:3m, ETH:4h
```

#### API

```typescript
const provider = new MarketDataProvider(exchange);

// Normal usage - handles caching automatically
const data = await provider.getMarketData('BTC/USDT', ['3m', '4h']);

// Check if data is stale
data.forEach(d => {
  if (d.isStale) {
    console.log(`Using stale data, age: ${d.cacheAge}ms`);
  }
});

// Clear cache manually (if needed)
provider.clearCache();

// Get cache stats
const stats = provider.getCacheStats();
console.log(`Cache size: ${stats.size}, keys: ${stats.keys}`);
```

### 4. OpenRouter AI Client Resilience

The OpenRouter client combines retry logic and circuit breaker for maximum reliability.

#### Implementation

```typescript
// Circuit breaker wraps retry logic
return await this.circuitBreaker.execute(
  async () => {
    // Retry wraps the actual API call
    return await withRetry(
      async () => {
        const response = await axios.post(/* ... */, {
          timeout: 30000,
        });
        return response.data.choices[0].message.content;
      },
      createRetryConfig({
        maxRetries: 3,
        baseDelay: 2000,
        maxDelay: 15000,
        shouldRetry: (error) => {
          // Don't retry 4xx errors (except 429 rate limit)
          if (error.response?.status >= 400 && error.response?.status < 500 && error.response.status !== 429) {
            return false;
          }
          return true;
        },
      })
    );
  },
  async () => {
    // Fallback: return empty signals when circuit is open
    return '{"signals": []}';
  }
);
```

#### Behavior

1. First attempt fails → Retry up to 3 times with exponential backoff
2. All retries fail → Circuit breaker counts failure
3. After 5 consecutive failures → Circuit opens
4. Circuit open → Return empty signals (fallback)
5. After 60 seconds → Circuit enters half-open state
6. Successful request in half-open → Circuit closes

### 5. Exchange API Resilience

All exchange APIs (OKX, Binance, Paper) use retry logic for critical operations.

#### Protected Methods

- `getAccount()` - Account balance and margin
- `getPositions()` - Open positions
- `getCandlesticks()` - Market data candles
- `getTicker()` - Current price (faster retry config)

#### Example: OKX Exchange

```typescript
async getAccount(): Promise<Account> {
  return withRetry(
    async () => {
      const balance = await this.exchange.fetchBalance();
      return {
        balance: balance.total?.USDT || 0,
        equity: balance.total?.USDT || 0,
        // ...
      };
    },
    createRetryConfig({
      maxRetries: 3,
      baseDelay: 1000,
      maxDelay: 5000,
    })
  );
}
```

## Error Categories

### Retryable Errors

- **Network Errors**: ECONNREFUSED, ETIMEDOUT, ENOTFOUND
- **Timeout Errors**: Request timeout, abort errors
- **Server Errors**: 5xx HTTP status codes
- **Rate Limits**: 429 Too Many Requests

### Non-Retryable Errors

- **Authentication Errors**: 401 Unauthorized
- **Authorization Errors**: 403 Forbidden
- **Validation Errors**: 400 Bad Request
- **Not Found**: 404 Not Found
- **Other Client Errors**: Most 4xx errors

### Critical Errors

- **Validation Failures**: Input validation errors
- **Configuration Errors**: Missing API keys, invalid config
- **Business Logic Errors**: Risk limit violations, position conflicts

## Monitoring & Logging

### Error Logging

All resilience components use structured logging:

```typescript
logger.warn('Retrying OpenRouter API call', {
  attempt: 2,
  error: 'Connection timeout',
  status: 504,
});

logger.error('Circuit breaker transitioning to OPEN', {
  consecutiveFailures: 5,
  failureThreshold: 5,
});

logger.warn('Using stale cached data due to fetch failure', {
  coin: 'BTC',
  timeframe: '3m',
  cacheAge: 120000, // 2 minutes
});
```

### Log Levels

- **ERROR**: Critical failures, circuit opens, persistent errors
- **WARN**: Retries, fallbacks, stale data usage
- **INFO**: Successful retries, circuit state changes, cache hits
- **DEBUG**: Detailed retry logic, cache operations

### Metrics to Monitor

1. **Retry Statistics**
   - Retry attempts per operation
   - Success rate after retries
   - Average retry delay

2. **Circuit Breaker Statistics**
   - Circuit state (closed/open/half-open)
   - Failure count
   - Success count
   - Last state change timestamp

3. **Cache Statistics**
   - Cache hit rate
   - Stale data usage frequency
   - Average cache age on hits

4. **API Latency**
   - p50, p95, p99 latencies
   - Timeout frequency
   - Rate limit hits

## Configuration

All resilience settings can be configured in `config/config.json`:

```json
{
  "resilience": {
    "retry": {
      "maxRetries": 3,
      "baseDelay": 1000,
      "maxDelay": 10000
    },
    "circuitBreaker": {
      "failureThreshold": 5,
      "resetTimeout": 60000,
      "halfOpenMaxAttempts": 3
    },
    "timeout": {
      "aiRequest": 30000,
      "exchangeRequest": 10000,
      "cycleMaxDuration": 120000
    },
    "degradedMode": {
      "enabled": true,
      "useMockAIOnFailure": false,
      "maxConsecutiveErrors": 5,
      "pauseOnPersistentErrors": true
    }
  }
}
```

## Best Practices

### 1. When to Use Retries

✅ **Use retries for:**
- Network failures
- Temporary service outages
- Rate limit errors (with backoff)
- Timeout errors

❌ **Don't retry:**
- Authentication failures
- Validation errors
- Business logic errors
- Intentional cancellations

### 2. When to Use Circuit Breakers

✅ **Use circuit breakers for:**
- External API calls
- Database connections
- Third-party services
- Any remote dependency

❌ **Don't use circuit breakers for:**
- Local operations
- Pure functions
- In-process services

### 3. Cache Strategy

✅ **Good use cases:**
- Market data (changes slowly)
- Configuration data
- Reference data (symbols, contracts)

❌ **Bad use cases:**
- Account balances (must be fresh)
- Order status (real-time critical)
- Authentication tokens (security risk)

### 4. Fallback Strategies

When the primary operation fails:

1. **Use cached data** if available and acceptable
2. **Return empty/default values** for non-critical data
3. **Throw error** for critical operations (account balance, order execution)
4. **Use mock/simulation** for testing purposes only

## Troubleshooting

### Issue: Too Many Retries

**Symptoms**: Slow response times, excessive API calls

**Solutions**:
- Reduce `maxRetries` in config
- Increase `baseDelay` to spread out retries
- Check if errors are retryable (auth errors shouldn't retry)

### Issue: Circuit Breaker Opens Too Quickly

**Symptoms**: Circuit opens after few failures, service unavailable errors

**Solutions**:
- Increase `failureThreshold` in config
- Check if underlying service has issues
- Review error logs for root cause

### Issue: Stale Data Used Frequently

**Symptoms**: `isStale: true` appears often in market data

**Solutions**:
- Check exchange API connectivity
- Verify API rate limits aren't exceeded
- Increase `maxRetries` for candle fetches
- Check exchange API status page

### Issue: High Latency

**Symptoms**: Slow trading cycles, timeout errors

**Solutions**:
- Reduce retry attempts for non-critical operations
- Optimize parallel market data fetching
- Check network connectivity
- Verify exchange API performance

## Health Check Endpoints

The system provides two health check endpoints for monitoring:

### Quick Health Check: `GET /health`

Fast, synchronous health check that returns basic system status without performing any async operations.

**Response:**
```json
{
  "status": "healthy",
  "timestamp": 1699564800000,
  "uptime": 3600000
}
```

**Use cases:**
- Load balancer health checks
- Quick service availability checks
- High-frequency monitoring (every few seconds)

### Detailed Health Check: `GET /health/detailed`

Comprehensive health check that inspects all system components.

**Response:**
```json
{
  "status": "healthy",
  "timestamp": 1699564800000,
  "uptime": 3600000,
  "components": {
    "exchange": {
      "status": "healthy",
      "message": "Exchange okx is configured",
      "details": {
        "exchange": "okx",
        "testnet": true
      },
      "lastCheck": 1699564800000,
      "responseTime": 5
    },
    "aiClient": {
      "status": "healthy",
      "message": "AI client circuit is closed (normal operation)",
      "details": {
        "circuitState": "CLOSED",
        "failureCount": 0,
        "successCount": 42,
        "consecutiveFailures": 0,
        "lastFailureTime": null,
        "lastSuccessTime": 1699564795000
      },
      "lastCheck": 1699564800000,
      "responseTime": 2
    },
    "marketData": {
      "status": "healthy",
      "message": "Market data provider is operational",
      "details": {
        "cacheSize": 6,
        "cachedSymbols": ["BTC:3m", "BTC:4h", "ETH:3m", "ETH:4h", "SOL:3m", "SOL:4h"]
      },
      "lastCheck": 1699564800000,
      "responseTime": 1
    },
    "cache": {
      "status": "healthy",
      "message": "Memory usage is normal",
      "details": {
        "memoryUsageMB": {
          "rss": 128,
          "heapTotal": 64,
          "heapUsed": 42,
          "external": 2
        },
        "uptime": 3600
      },
      "lastCheck": 1699564800000,
      "responseTime": 1
    }
  },
  "metrics": {
    "totalChecks": 120,
    "consecutiveFailures": 0,
    "lastFailureTime": null
  }
}
```

**HTTP Status Codes:**
- `200`: System is healthy or degraded (still operational)
- `503`: System is unhealthy (not operational)

**Component Statuses:**
- `healthy`: Component is functioning normally
- `degraded`: Component has issues but is still operational
- `unhealthy`: Component is not functioning

**Use cases:**
- Dashboard health visualization
- Debugging system issues
- Detailed monitoring (every 30-60 seconds)
- Alerting based on component status

### Integration Examples

#### cURL
```bash
# Quick check
curl http://localhost:3001/health

# Detailed check
curl http://localhost:3001/health/detailed
```

#### Monitoring Script
```bash
#!/bin/bash
# Check health and alert if unhealthy
response=$(curl -s -w "%{http_code}" -o /tmp/health.json http://localhost:3001/health/detailed)
if [ "$response" != "200" ]; then
  echo "ALERT: System unhealthy!"
  cat /tmp/health.json
  # Send alert (email, Slack, etc.)
fi
```

#### Kubernetes Liveness Probe
```yaml
livenessProbe:
  httpGet:
    path: /health
    port: 3001
  initialDelaySeconds: 30
  periodSeconds: 10
  timeoutSeconds: 5
  failureThreshold: 3
```

#### Kubernetes Readiness Probe
```yaml
readinessProbe:
  httpGet:
    path: /health/detailed
    port: 3001
  initialDelaySeconds: 10
  periodSeconds: 30
  timeoutSeconds: 10
  failureThreshold: 2
```

## Future Enhancements

1. **Rate Limiting**: Token bucket algorithm for API calls
2. **Metrics Collection**: Prometheus-compatible metrics endpoint
3. **Adaptive Retry**: Dynamic retry config based on error patterns
4. **Distributed Circuit Breaker**: Shared state across instances
5. **Error Budget**: Track error rate and pause trading when exceeded
6. **Health Check Caching**: Cache detailed health check results to reduce overhead

## References

- [Retry Pattern - Microsoft Azure](https://docs.microsoft.com/en-us/azure/architecture/patterns/retry)
- [Circuit Breaker Pattern - Martin Fowler](https://martinfowler.com/bliki/CircuitBreaker.html)
- [Exponential Backoff And Jitter - AWS Architecture Blog](https://aws.amazon.com/blogs/architecture/exponential-backoff-and-jitter/)


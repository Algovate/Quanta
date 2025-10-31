# Health Check Guide

## Overview

Quanta provides comprehensive health check endpoints for monitoring system status and component health. These endpoints are designed for both automated monitoring systems and manual inspection.

## Endpoints

### Quick Health Check: `GET /health`

Fast, synchronous check that returns basic system status.

**Best for:**
- Load balancer health checks
- Kubernetes liveness probes
- High-frequency monitoring (every few seconds)
- Quick availability checks

**Response:**
```json
{
  "status": "healthy",
  "timestamp": 1699564800000,
  "uptime": 3600000
}
```

**Status Values:**
- `healthy`: System is operating normally
- `unhealthy`: System has persistent errors

### Detailed Health Check: `GET /health/detailed`

Comprehensive check that inspects all system components.

**Best for:**
- Monitoring dashboards
- Debugging issues
- Component-level visibility
- Kubernetes readiness probes
- Periodic health checks (every 30-60 seconds)

**Response Example:**
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
        "cachedSymbols": [
          "BTC:3m", "BTC:4h",
          "ETH:3m", "ETH:4h",
          "SOL:3m", "SOL:4h"
        ]
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

## HTTP Status Codes

| Code | Meaning | Action Required |
|------|---------|----------------|
| 200 | Healthy or degraded | No action (system operational) |
| 503 | Unhealthy | Investigation required |

## Component Statuses

Each component can have one of three statuses:

### `healthy` ✅
Component is functioning normally. No action required.

### `degraded` ⚠️
Component has issues but is still operational. Examples:
- AI circuit breaker in HALF_OPEN state (testing recovery)
- High memory usage but still within limits
- Using cached data due to transient API issues

**Action:** Monitor the situation. May resolve automatically.

### `unhealthy` ❌
Component is not functioning. Examples:
- AI circuit breaker OPEN (persistent failures)
- Exchange not configured or unreachable
- Critical system error

**Action:** Immediate investigation required.

## Components Monitored

### 1. Exchange
- **Checks:** Configuration, connectivity
- **Details:** Exchange name, testnet mode
- **Unhealthy if:** Exchange not configured

### 2. AI Client
- **Checks:** Circuit breaker state
- **Details:** Circuit state, failure/success counts
- **Unhealthy if:** Circuit breaker OPEN (5+ consecutive failures)
- **Degraded if:** Circuit breaker HALF_OPEN (testing recovery)

### 3. Market Data
- **Checks:** Provider status, cache availability
- **Details:** Cache size, cached symbols
- **Unhealthy if:** Provider initialization failed

### 4. Cache / Memory
- **Checks:** Memory usage, uptime
- **Details:** Memory usage (RSS, heap), process uptime
- **Degraded if:** Heap usage > 1GB

## Usage Examples

### cURL

```bash
# Quick check
curl http://localhost:3001/health

# Detailed check with pretty output
curl -s http://localhost:3001/health/detailed | jq

# Check specific component status
curl -s http://localhost:3001/health/detailed | jq '.components.aiClient.status'

# Get circuit breaker state
curl -s http://localhost:3001/health/detailed | jq '.components.aiClient.details.circuitState'
```

### Monitoring Script

```bash
#!/bin/bash
# health-monitor.sh - Monitor health and alert on issues

API_URL="http://localhost:3001"
ALERT_EMAIL="ops@example.com"

check_health() {
  response=$(curl -s -w "\n%{http_code}" "$API_URL/health/detailed")
  body=$(echo "$response" | head -n -1)
  status_code=$(echo "$response" | tail -n 1)
  
  if [ "$status_code" != "200" ]; then
    echo "ALERT: System unhealthy (HTTP $status_code)"
    echo "$body" | jq
    # Send alert
    echo "$body" | mail -s "Quanta Health Alert" "$ALERT_EMAIL"
    return 1
  fi
  
  # Check individual components
  ai_status=$(echo "$body" | jq -r '.components.aiClient.status')
  if [ "$ai_status" == "unhealthy" ]; then
    echo "WARNING: AI client is unhealthy"
    echo "$body" | jq '.components.aiClient'
  fi
  
  return 0
}

# Run check
check_health
exit $?
```

### Kubernetes Configuration

```yaml
apiVersion: v1
kind: Pod
metadata:
  name: quanta-trading
spec:
  containers:
  - name: quanta
    image: quanta:latest
    ports:
    - containerPort: 3001
    
    # Liveness probe - restarts pod if unhealthy
    livenessProbe:
      httpGet:
        path: /health
        port: 3001
      initialDelaySeconds: 30
      periodSeconds: 10
      timeoutSeconds: 5
      failureThreshold: 3
    
    # Readiness probe - removes from service if unhealthy
    readinessProbe:
      httpGet:
        path: /health/detailed
        port: 3001
      initialDelaySeconds: 10
      periodSeconds: 30
      timeoutSeconds: 10
      failureThreshold: 2
      successThreshold: 1
```

### Docker Compose with Health Check

```yaml
version: '3.8'
services:
  quanta:
    image: quanta:latest
    ports:
      - "3001:3001"
    healthcheck:
      test: ["CMD", "curl", "-f", "http://localhost:3001/health"]
      interval: 30s
      timeout: 10s
      retries: 3
      start_period: 40s
```

### Monitoring Dashboard (Grafana)

```promql
# HTTP request to health endpoint using Prometheus blackbox exporter
probe_success{job="quanta-health", instance="quanta:3001"}

# Parse health status from response
up{job="quanta-api"} == 1

# Alert on unhealthy status
ALERT QuantaUnhealthy
  IF probe_http_status_code{job="quanta-health"} == 503
  FOR 5m
  LABELS { severity="critical" }
  ANNOTATIONS {
    summary = "Quanta trading system is unhealthy",
    description = "Health check returned 503 for 5 minutes"
  }
```

### Python Monitoring Script

```python
#!/usr/bin/env python3
import requests
import time
import logging

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

API_URL = "http://localhost:3001"

def check_health():
    try:
        response = requests.get(f"{API_URL}/health/detailed", timeout=10)
        data = response.json()
        
        status = data.get('status')
        components = data.get('components', {})
        
        logger.info(f"Overall status: {status}")
        
        # Check each component
        for name, component in components.items():
            comp_status = component.get('status')
            message = component.get('message')
            
            if comp_status == 'unhealthy':
                logger.error(f"Component {name}: {comp_status} - {message}")
            elif comp_status == 'degraded':
                logger.warning(f"Component {name}: {comp_status} - {message}")
            else:
                logger.info(f"Component {name}: {comp_status}")
        
        # Check AI circuit breaker specifically
        if 'aiClient' in components:
            circuit_state = components['aiClient'].get('details', {}).get('circuitState')
            if circuit_state == 'OPEN':
                logger.error("AI circuit breaker is OPEN - trading may be paused")
            elif circuit_state == 'HALF_OPEN':
                logger.warning("AI circuit breaker is HALF_OPEN - testing recovery")
        
        return status == 'healthy'
        
    except requests.exceptions.RequestException as e:
        logger.error(f"Health check failed: {e}")
        return False

if __name__ == '__main__':
    while True:
        is_healthy = check_health()
        time.sleep(60)  # Check every minute
```

## Troubleshooting

### Circuit Breaker OPEN

**Symptoms:**
```json
{
  "aiClient": {
    "status": "unhealthy",
    "message": "AI client circuit is open (failing)",
    "details": {
      "circuitState": "OPEN",
      "consecutiveFailures": 5
    }
  }
}
```

**Causes:**
- OpenRouter API key invalid or expired
- OpenRouter API rate limit exceeded
- OpenRouter service outage
- Network connectivity issues

**Resolution:**
1. Check API key in configuration
2. Check `logs/error.log` for detailed errors
3. Verify OpenRouter API status
4. Wait for circuit to automatically recover (60 seconds)

### High Memory Usage

**Symptoms:**
```json
{
  "cache": {
    "status": "degraded",
    "message": "High memory usage detected",
    "details": {
      "memoryUsageMB": {
        "heapUsed": 1200
      }
    }
  }
}
```

**Causes:**
- Memory leak
- Too many cached symbols
- Long running process without restart

**Resolution:**
1. Restart the application
2. Reduce number of tracked coins
3. Clear market data cache
4. Monitor for memory leaks

### Exchange Not Configured

**Symptoms:**
```json
{
  "exchange": {
    "status": "unhealthy",
    "message": "Exchange not configured"
  }
}
```

**Causes:**
- Trading workflow not started
- Exchange initialization failed

**Resolution:**
1. Start trading workflow
2. Check exchange configuration in `config.json`
3. Verify API credentials

## Best Practices

### Monitoring Frequency

- **Quick Health Check (`/health`)**: Every 5-10 seconds
- **Detailed Health Check (`/health/detailed`)**: Every 30-60 seconds

### Alerting

Set up alerts for:
- HTTP 503 status (unhealthy) persisting > 5 minutes
- AI circuit breaker OPEN > 2 minutes
- Memory usage > 80% of limit
- Consecutive failures > 10

### Dashboard Metrics

Display on monitoring dashboard:
- Overall system status
- Circuit breaker state
- Memory usage trend
- Failure rate
- Component response times

## Integration with QuantaWeb

The QuantaWeb dashboard automatically polls health endpoints and displays:
- System status indicator
- Component health cards
- Circuit breaker state
- Memory usage graphs
- Alert notifications

No additional configuration required - health checks work out of the box once the API server is running.

## Related Documentation

- [Error Handling & Resilience](./error-handling.md) - Comprehensive resilience documentation
- [Configuration](./configuration.md) - Resilience configuration options
- [Logging Guide](./logging-guide.md) - Log analysis for health issues


# Quanta Arena - Multi-Drone Trading System

## Overview

Quanta Arena enables you to run multiple trading workflow instances ("drones") simultaneously, each with different configurations, prompt packs, and parameters. The Arena system compares their performance, PnL, signals, trades, and AI effectiveness to help you find the optimal trading strategy.

> Note on API exclusivity
>
> When the API server is running, only one execution session can be active at a time. This session can be either an Arena run (multiple drones) or a single Trading Workflow (strategy). You cannot run both simultaneously. The server enforces this via a global ExecutionSession with `mode` (`'arena' | 'strategy'`) and `env`.

## Key Features

- **Parallel Execution**: Run multiple drones simultaneously with isolated state
- **Configuration Flexibility**: Each drone can use different prompt packs, risk parameters, coins, and AI models
- **Comprehensive Comparison**: Compare performance metrics, signals, trades, and AI costs across drones
- **Persistent Storage**: SQLite database stores arena results for historical analysis
- **Real-time Monitoring**: CLI and Web UI for live arena status and metrics
- **Cost Tracking**: Track AI API costs per drone and calculate ROI

## Architecture

### Components

1. **ArenaManager**: Singleton managing all arena instances
2. **ArenaOrchestrator**: Manages lifecycle of a single arena
3. **DroneInstance**: Isolated wrapper around TradingWorkflow
4. **AICallQueue**: Rate limiting for concurrent AI API calls
5. **DroneAIAgent**: Cost tracking wrapper around OpenRouterClient
6. **ArenaStorage**: SQLite persistence layer

### Event Isolation

Arena uses event namespacing to prevent conflicts:

- Regular trading events: `cycle:complete`, `cycle:signals`
- Arena events: `arena:started`, `arena:stopped`
- Drone events: `drone:{droneId}:cycle:complete`, etc.

### Logging

All Arena logs are properly tagged:

- Arena logs: `ArenaOrchestrator:{arenaId}`
- Drone logs: `Arena:{arenaId}:Drone:{droneId}`
- No cross-contamination with regular trading logs

## Quick Start

### 1. Create Arena Configuration

Create a JSON file in `config/arena/`:

```json
{
  "name": "My First Arena",
  "mode": "paper",
  "drones": [
    {
      "id": "drone-1",
      "name": "Conservative",
      "coins": ["BTC", "ETH"],
      "promptPack": "conservative",
      "initialBalance": 10000,
      "riskParams": {
        "maxRiskPerTrade": 0.02,
        "maxTotalRisk": 0.15,
        "defaultStopLoss": 0.05,
        "maxLeverage": 3,
        "minLeverage": 2,
        "maxPositions": 3
      }
    },
    {
      "id": "drone-2",
      "name": "Aggressive",
      "coins": ["BTC", "ETH"],
      "promptPack": "aggressive",
      "initialBalance": 10000,
      "riskParams": {
        "maxRiskPerTrade": 0.05,
        "maxTotalRisk": 0.3,
        "defaultStopLoss": 0.03,
        "maxLeverage": 5,
        "minLeverage": 3,
        "maxPositions": 5
      }
    }
  ],
  "settings": {
    "maxConcurrentAICalls": 2
  }
}
```

### 2. Start Arena

```bash
# List available arena configurations
quanta arena configs

# Start arena by name (config file name without .json)
quanta arena start --config my-arena

# Or use full path if needed
quanta arena start --config config/arena/my-arena.json

# Start with duration limit
quanta arena start --config my-arena --duration 30

# Mode is always paper (real market data with simulated execution)
quanta arena start --config my-arena

Note: Arena only supports paper mode. For historical testing, use `quanta trade backtest` instead of arena.
```

### 3. Monitor Status

```bash
# Check arena status
quanta arena status <arenaId>

# List all arenas
quanta arena list
```

### 4. Compare Results

```bash
# Get comprehensive comparison
quanta arena compare <arenaId>
```

### 5. Stop Arena

```bash
quanta arena stop <arenaId>
```

### 6. View Arena Logs

All Arena logs are integrated with the UnifiedLogger system. View logs using:

```bash
# View recent Arena logs (all contexts)
quanta log view --lines 50

# View only ArenaManager logs
quanta log view --context ArenaManager --lines 50

# View only ArenaStorage logs
quanta log view --context ArenaStorage --lines 50

# Real-time log following
quanta log view --context ArenaManager -f

# Search for specific Arena ID
quanta log view --grep "arena-XXXX" --lines 100

# View error logs only
quanta log view --level error --lines 50

# Combined filtering (context + level)
quanta log view --context ArenaManager --level info --lines 100
```

**Available Log Contexts:**

- `ArenaManager` - Arena lifecycle management
- `ArenaStorage` - Database operations
- `ArenaOrchestrator:{arenaId}` - Specific arena orchestrator
- `Arena:{arenaId}:Drone:{droneId}` - Specific drone in an arena

## Configuration Reference

### Arena Configuration

```typescript
{
  name: string;                    // Arena name
  mode: 'paper';                    // Execution mode (always paper - real market data with simulated execution)
  drones: DroneConfig[];           // Array of drone configs
  settings?: {
    maxConcurrentAICalls?: number; // AI rate limiting (default: 2)
    cyclePeriod?: number;          // Cycle duration in ms
    maxDuration?: number;          // Max runtime in ms
  }
}
```

### Drone Configuration

```typescript
{
  id: string;                      // Unique drone ID
  name: string;                    // Display name
  coins: string[];                 // Coins to trade
  promptPack: string;              // Prompt pack name
  initialBalance: number;          // Starting balance
  riskParams: {
    maxRiskPerTrade: number;
    maxTotalRisk: number;
    defaultStopLoss: number;
    maxLeverage: number;
    minLeverage: number;
    maxPositions: number;
  };
  aiConfig?: {
    model?: string;                // AI model override
    temperature?: number;          // Temperature override
  };
}
```

## Web API Endpoints

### 1. Start Arena

Start a new arena with multiple drones.

**Request:**

```http
POST /api/arena/start
Content-Type: application/json

{
  "name": "Prompt Pack Comparison Arena",
  "mode": "paper",
  "drones": [
    {
      "id": "drone-1",
      "name": "Conservative Strategy",
      "coins": ["BTC", "ETH"],
      "promptPack": "conservative",
      "initialBalance": 10000,
      "riskParams": {
        "maxRiskPerTrade": 0.02,
        "maxTotalRisk": 0.15,
        "defaultStopLoss": 0.05,
        "maxLeverage": 3,
        "minLeverage": 2,
        "maxPositions": 3
      },
      "aiConfig": {
        "model": "deepseek/deepseek-chat",
        "temperature": 0.7
      }
    },
    {
      "id": "drone-2",
      "name": "Aggressive Strategy",
      "coins": ["BTC", "ETH"],
      "promptPack": "aggressive",
      "initialBalance": 10000,
      "riskParams": {
        "maxRiskPerTrade": 0.05,
        "maxTotalRisk": 0.3,
        "defaultStopLoss": 0.03,
        "maxLeverage": 5,
        "minLeverage": 3,
        "maxPositions": 5
      }
    }
  ],
  "settings": {
    "maxConcurrentAICalls": 2,
    "cyclePeriod": 60000,
    "maxDuration": 3600000
  }
}
```

**Response (201 Created):**

```json
{
  "success": true,
  "arenaId": "arena-1762181524086-x8kzu1b",
  "drones": [
    { "id": "drone-1", "name": "Conservative Strategy", "status": "running" },
    { "id": "drone-2", "name": "Aggressive Strategy", "status": "running" }
  ]
}
```

**Errors:**

- `400` - Invalid configuration or missing API key
- `500` - Server error

### 2. Stop Arena

Stop a running arena and save results to database.

**Request:**

```http
POST /api/arena/stop/arena-1762181524086-x8kzu1b
```

**Response (200 OK):**

```json
{
  "success": true,
  "arenaId": "arena-1762181524086-x8kzu1b",
  "message": "Arena stopped successfully"
}
```

**Errors:**

- `404` - Arena not found
- `500` - Server error

### 3. Get Arena Status

Get current status and metrics for all drones in an arena.

**Request:**

```http
GET /api/arena/status/arena-1762181524086-x8kzu1b
```

**Response (200 OK):**

```json
{
  "arenaId": "arena-1762181524086-x8kzu1b",
  "status": "running",
  "startTime": 1762181524086,
  "endTime": null,
  "droneCount": 2,
  "drones": [
    {
      "droneId": "drone-1",
      "name": "Conservative Strategy",
      "cycleCount": 45,
      "equity": 10250.5,
      "pnl": 250.5,
      "pnlPercent": 2.51,
      "totalSignals": 120,
      "totalTrades": 18,
      "winRate": 0.67,
      "sharpeRatio": 1.45,
      "maxDrawdown": 3.2,
      "aiCost": 0.12,
      "aiTokens": 45600,
      "aiCallCount": 45,
      "lastUpdate": 1762181580000
    },
    {
      "droneId": "drone-2",
      "name": "Aggressive Strategy",
      "cycleCount": 45,
      "equity": 9875.3,
      "pnl": -124.7,
      "pnlPercent": -1.25,
      "totalSignals": 135,
      "totalTrades": 25,
      "winRate": 0.56,
      "sharpeRatio": 0.85,
      "maxDrawdown": 8.7,
      "aiCost": 0.15,
      "aiTokens": 51200,
      "aiCallCount": 45,
      "lastUpdate": 1762181580000
    }
  ]
}
```

**Errors:**

- `404` - Arena not found
- `500` - Server error

### 4. List All Arenas

List all arena runs (both running and completed).

**Request:**

```http
GET /api/arena/list
```

**Response (200 OK):**

```json
{
  "success": true,
  "count": 5,
  "running": 2,
  "arenas": [
    {
      "arenaId": "arena-1762181524086-x8kzu1b",
      "name": "Prompt Pack Comparison Arena",
      "status": "running",
      "startTime": 1762181524086,
      "endTime": null,
      "droneCount": 3
    },
    {
      "arenaId": "arena-1762179999999-abc123",
      "name": "Risk Sweep Test",
      "status": "completed",
      "startTime": 1762179999999,
      "endTime": 1762181000000,
      "droneCount": 5
    }
  ]
}
```

### 5. Get Drone List

Get detailed information about all drones in an arena.

**Request:**

```http
GET /api/arena/arena-1762181524086-x8kzu1b/drones
```

**Response (200 OK):**

```json
{
  "arenaId": "arena-1762181524086-x8kzu1b",
  "drones": [
    {
      "id": "drone-1",
      "name": "Conservative Strategy",
      "config": {
        "coins": ["BTC", "ETH"],
        "promptPack": "conservative",
        "riskParams": {
          "maxRiskPerTrade": 0.02,
          "maxTotalRisk": 0.15,
          "defaultStopLoss": 0.05,
          "maxLeverage": 3,
          "minLeverage": 2,
          "maxPositions": 3
        }
      },
      "metrics": {
        "cycleCount": 45,
        "equity": 10250.5,
        "pnl": 250.5,
        "pnlPercent": 2.51,
        "totalSignals": 120,
        "totalTrades": 18,
        "winRate": 0.67,
        "sharpeRatio": 1.45,
        "maxDrawdown": 3.2,
        "aiCost": 0.12,
        "lastUpdate": 1762181580000
      }
    }
  ]
}
```

### 6. Get Performance Comparison

Get comprehensive comparison analysis including performance, costs, and correlations.

**Request:**

```http
GET /api/arena/arena-1762181524086-x8kzu1b/comparison
```

**Response (200 OK):**

```json
{
  "arenaId": "arena-1762181524086-x8kzu1b",
  "performance": {
    "winner": {
      "droneId": "drone-1",
      "name": "Conservative Strategy",
      "metrics": {
        /* full drone metrics */
      }
    },
    "comparisons": [
      {
        "droneId": "drone-1",
        "rank": 1,
        "totalReturn": 2.51,
        "sharpeRank": 1,
        "winRateRank": 1
      }
    ],
    "stats": {
      "bestReturn": 2.51,
      "worstReturn": -1.25,
      "avgReturn": 0.63,
      "totalSignals": 255
    }
  },
  "costs": {
    "totalCost": 0.27,
    "averageCost": 0.135,
    "mostEfficient": {
      "droneId": "drone-1",
      "costPerReturn": 0.0048
    },
    "allCosts": [
      /* cost details per drone */
    ]
  },
  "correlations": {
    "pairs": [
      {
        "droneA": "drone-1",
        "droneB": "drone-2",
        "correlation": 0.72,
        "diversification": false
      }
    ],
    "diversification": []
  }
}
```

### 7. Get AI Analysis

Analyze AI effectiveness by prompt pack.

**Request:**

```http
GET /api/arena/arena-1762181524086-x8kzu1b/ai-analysis
```

**Response (200 OK):**

```json
{
  "arenaId": "arena-1762181524086-x8kzu1b",
  "promptEffectiveness": [
    {
      "promptPack": "conservative",
      "drones": 1,
      "avgReturn": 2.51,
      "avgSharpe": 1.45,
      "avgWinRate": 0.67,
      "totalCost": 0.12,
      "totalTokens": 45600,
      "totalCalls": 45,
      "costPerToken": 0.0000026,
      "avgTokensPerCall": 1013
    }
  ],
  "summary": {
    "totalPacks": 2,
    "bestPerforming": "conservative",
    "mostExpensive": "aggressive"
  }
}
```

## WebSocket Events

Connect to `ws://localhost:3001` to receive real-time arena updates:

**Arena Started:**

```json
{
  "type": "arena:started",
  "data": {
    "arenaId": "arena-1762181524086-x8kzu1b",
    "name": "Prompt Pack Comparison Arena",
    "droneCount": 2
  }
}
```

**Arena Stopped:**

```json
{
  "type": "arena:stopped",
  "data": {
    "arenaId": "arena-1762181524086-x8kzu1b",
    "status": "completed"
  }
}
```

**Arena Update (periodic metrics):**

```json
{
  "type": "arena:update",
  "data": {
    "arenaId": "arena-1762181524086-x8kzu1b",
    "status": "running",
    "droneMetrics": [
      /* updated metrics for all drones */
    ]
  }
}
```

## Quick Start Example

### Using the API

```bash
# 1. Start API Server
quanta server start

# 2. Start an Arena
curl -X POST http://localhost:3001/api/arena/start \
  -H "Content-Type: application/json" \
  -d @config/arena/ppc.json

# 3. Check Status
curl http://localhost:3001/api/arena/status/arena-XXXX

# 4. Get Comparison
curl http://localhost:3001/api/arena/arena-XXXX/comparison

# 5. Stop Arena
curl -X POST http://localhost:3001/api/arena/stop/arena-XXXX
```

### Using WebSocket

```javascript
const ws = new WebSocket('ws://localhost:3001');

ws.on('message', data => {
  const msg = JSON.parse(data);
  switch (msg.type) {
    case 'arena:started':
      console.log('Arena started:', msg.data);
      break;
    case 'arena:update':
      console.log('Metrics updated:', msg.data);
      break;
    case 'arena:stopped':
      console.log('Arena stopped:', msg.data);
      ws.close();
      break;
  }
});
```

## Example Configurations

See `config/arena/` for complete examples:

- `example-arena.json` - Basic 3-drone comparison
- `ppc.json` - Prompt pack comparison arena
- `prompt-comparison.json` - Compare prompt packs
- `risk-sweep.json` - Test different risk parameters
- `coin-strategy.json` - Compare different coin selections

## Database Schema

Arena results are stored in `logs/arena.db`:

- **arena_runs**: Arena metadata and config
- **drone_results**: Final metrics per drone
- **drone_snapshots**: Historical equity curves

Query historical arenas:

```bash
quanta arena compare <arenaId>
```

## Best Practices

1. **Start Small**: Test with 2-3 drones before scaling up
2. **Isolate Variables**: Change one parameter at a time (prompt pack OR risk params)
3. **Monitor Costs**: Track AI API costs, especially with many drones
4. **Use Appropriate Duration**: Set duration limits for long-running arenas
5. **Review Correlations**: Check if drones are diversifying or correlated

## Troubleshooting

### Arena won't start

- Check arena config JSON is valid
- Verify all prompt packs exist in `config/prompts/`
- Ensure API key is configured

### Drones not generating different results

- Verify different prompt packs are used
- Check risk parameters differ
- Ensure coins list is correct

### High API costs

- Reduce `maxConcurrentAICalls`
- Use fewer drones
- Increase `cyclePeriod` to slow down

### Viewing Arena Logs

- All Arena logs use isolated contexts to prevent pollution
- Arena execution logs are stored in `logs/text/` as JSONL files
- Arena results are stored in `logs/arena.db` SQLite database
- Use `quanta log view` to view arena logs by context
- Each drone has its own logging context: `Arena:{arenaId}:Drone:{droneId}`

## Advanced Topics

### Custom Prompt Packs

Create new prompt packs in `config/prompts/`:

```bash
quanta prompts diff -g my-custom-prompt
```

Use in drone config:

```json
{
  "promptPack": "my-custom-prompt"
}
```

### Parallel vs Sequential Execution

By default, drones run in parallel. For sequential execution (not recommended), modify `ArenaOrchestrator.start()`.

### Event Subscriptions

Subscribe to arena events:

```typescript
import { EventBus } from '@quanta/core/event-bus';

// Arena lifecycle
EventBus.on('arena:started', payload => {
  console.log('Arena started:', payload);
});

// Drone lifecycle
EventBus.on('drone:abc123:cycle:complete', payload => {
  console.log('Drone completed cycle:', payload);
});
```

## Roadmap

Future enhancements:

- Web UI dashboard with visualizations
- Signal correlation matrix
- Trade overlap analysis
- Historical arena replay
- Arena tournaments
- Strategy marketplace

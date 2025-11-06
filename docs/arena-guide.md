# Quanta Arena - Multi-Drone Trading System

Run multiple trading workflows ("drones") simultaneously to compare strategies, prompt packs, and risk parameters.

> **Note**: When API server is running, only one execution session can be active (Arena or Strategy). Arena only supports paper mode (real market data with simulated execution).

## Quick Start

### 1. Create Arena Configuration

Create JSON file in `config/arena/`:

```json
{
  "name": "My Arena",
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
# List available configurations
quanta arena configs

# Start arena
quanta arena start --config my-arena

# Start with duration limit (minutes)
quanta arena start --config my-arena --duration 30
```

### 3. Monitor and Compare

```bash
# Check status
quanta arena status <arenaId>

# List all arenas
quanta arena list

# Compare results
quanta arena compare <arenaId>

# Stop arena
quanta arena stop <arenaId>
```

### 4. View Logs

```bash
# View arena logs
quanta log view --context ArenaManager --follow

# View specific drone logs
quanta log view --grep "arena-XXXX" --lines 100
```

**Log Contexts**: `ArenaManager`, `ArenaStorage`, `ArenaOrchestrator:{arenaId}`, `Arena:{arenaId}:Drone:{droneId}`

## Configuration

### Arena Config

```typescript
{
  name: string;
  mode: 'paper';  // Always paper
  drones: DroneConfig[];
  settings?: {
    maxConcurrentAICalls?: number;  // Default: 2
    cyclePeriod?: number;          // Cycle duration (ms)
    maxDuration?: number;          // Max runtime (ms)
  }
}
```

### Drone Config

```typescript
{
  id: string;
  name: string;
  coins: string[];
  promptPack: string;
  initialBalance: number;
  riskParams: {
    maxRiskPerTrade: number;
    maxTotalRisk: number;
    defaultStopLoss: number;
    maxLeverage: number;
    minLeverage: number;
    maxPositions: number;
  };
  aiConfig?: {
    model?: string;
    temperature?: number;
  };
}
```

## Web API

### Endpoints

- `POST /api/arena/start` - Start arena
- `POST /api/arena/stop/:arenaId` - Stop arena
- `GET /api/arena/status/:arenaId` - Get status
- `GET /api/arena/list` - List all arenas
- `GET /api/arena/:arenaId/drones` - Get drone details
- `GET /api/arena/:arenaId/comparison` - Get comparison
- `GET /api/arena/:arenaId/ai-analysis` - Get AI analysis

### WebSocket Events

Connect to `ws://localhost:3001`:

- `arena:started` - Arena started
- `arena:stopped` - Arena stopped
- `arena:update` - Periodic metrics update

See [Command Reference](commands.md#arena-commands) for complete API documentation.

## Example Configurations

See `config/arena/` for examples:

- `example-arena.json` - Basic comparison
- `ppc.json` - Prompt pack comparison
- `risk-sweep.json` - Risk parameter sweep
- `coin-strategy.json` - Coin selection comparison

## Storage

Arena results stored in `logs/arena.db`:

- `arena_runs` - Arena metadata
- `drone_results` - Final metrics
- `drone_snapshots` - Historical equity curves

Query: `quanta arena compare <arenaId>`

## Best Practices

1. **Start Small**: Test with 2-3 drones first
2. **Isolate Variables**: Change one parameter at a time
3. **Monitor Costs**: Track AI API costs (especially with many drones)
4. **Set Duration Limits**: Use `maxDuration` for long runs
5. **Review Correlations**: Check if drones are diversifying

## Troubleshooting

**Arena won't start**: Check JSON validity, verify prompt packs exist, ensure API key configured

**Drones not different**: Verify different prompt packs/risk params, check coin lists

**High API costs**: Reduce `maxConcurrentAICalls`, use fewer drones, increase `cyclePeriod`

**View logs**: Use `quanta log view --context ArenaManager` - see [Command Reference](commands.md#log-commands)

## Advanced

### Custom Prompt Packs

Create in `config/prompts/` and reference in drone config:

```json
{
  "promptPack": "my-custom-prompt"
}
```

### Event Subscriptions

```typescript
import { EventBus } from '@quanta/core/event-bus';

EventBus.on('arena:started', payload => console.log('Started:', payload));
EventBus.on('drone:abc123:cycle:complete', payload => console.log('Cycle:', payload));
```

---

**Related**: [Command Reference](commands.md#arena-commands) | [Configuration Guide](configuration.md)

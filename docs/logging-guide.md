# Logging Guide

Quanta captures all console output and application events to structured JSONL files. Use `quanta log` commands to view and manage logs.

## How It Works

- **Console Interception**: All `console.log/warn/error` output is captured to JSONL files (not printed to terminal)
- **Daily Rotation**: New log file each day: `logs/text/text-logs-YYYY-MM-DD.jsonl`
- **Structured Format**: Each line is a JSON object with timestamp, level, context, message, and metadata

**For CLI commands**: Use `UnifiedLogger.getInstance().getOriginalConsole()` to display output.

**For application logging**: Use `unifiedLogger.info/warn/error/debug()` for structured logging.

## CLI Commands

### View Logs

```bash
# Show last 50 lines (default)
quanta log view

# Follow in real-time
quanta log view --follow

# Filter by context
quanta log view --context Workflow

# Filter by level
quanta log view --level error

# Search for pattern
quanta log view --grep "order|signal"

# Raw output (no ANSI)
quanta log view --format raw
```

### List, Stats, Export, Clean

```bash
# List log files
quanta log list

# Show statistics
quanta log stats

# Export logs
quanta log export --output logs.json --format json

# Clean old logs
quanta log clean --days 7
```

See [Command Reference](commands.md#log-commands) for complete options.

## Configuration

### Environment Variable

```bash
# Override log directory (absolute path)
export LOG_DIR=/absolute/path/to/logs/text
```

**Priority**: `LOG_DIR` env → `logging.textLogDir` in config.json → default `./logs/text`

### Config File (Optional)

```json
{
  "logging": {
    "level": "info",
    "textLogDir": "./logs/text",
    "retentionDays": 7
  }
}
```

**Options:**
- `level`: `error`, `warn`, `info`, `debug` (default: `info`)
- `textLogDir`: Directory for JSONL files (overridden by `LOG_DIR`)
- `retentionDays`: Days to keep logs (default: 7)

## Log Format

Each log entry (JSONL format):

```json
{
  "logId": "uuid",
  "timestamp": 1730582400000,
  "level": "info|warn|error|debug",
  "context": "Workflow|TradeStart|Server|...",
  "message": "plain text",
  "formattedMessage": "text with ANSI",
  "metadata": { "cycleId": 42 },
  "cycleId": 42,
  "operationId": "op-123"
}
```

**Common Contexts**: `Workflow`, `TradeStart`, `Server`, `AISignal`, `Execution`, `Account`, `ArenaManager`

See [Log Contexts Reference](log-contexts.md) for complete list.

## Best Practices

### CLI Commands

```typescript
const console = UnifiedLogger.getInstance().getOriginalConsole();
console.log('User-visible message'); // ✅ Appears in terminal
```

### Application Logging

```typescript
const logger = UnifiedLogger.getInstance();
logger.info('Cycle started', { cycleId: 42, coins: ['BTC'] });
logger.warn('Low confidence', { coin: 'BTC', confidence: 0.45 });
logger.error('Order failed', { symbol: 'BTC/USDT', error: error.message });
```

## Troubleshooting

**Logs not appearing**: Check `LOG_DIR`, verify directory exists and is writable

**Console output missing**: Use `getOriginalConsole()` for CLI commands, or view logs with `quanta log view`

**Logs too large**: Reduce log level, clean old logs with `quanta log clean --days 7`

**Can't find logs**: Check `echo $LOG_DIR` or `quanta log list` or default location `logs/text/`

## Common Recipes

```bash
# Monitor trading in real-time
quanta log view --follow --context Workflow

# Monitor errors only
quanta log view --follow --level error

# Export errors for analysis
quanta log export --output errors.json --level error --days 7

# Archive and clean
quanta log export --output archive.json --days 30 && quanta log clean --days 30
```

## FAQ

**Can I use `console.log`?** Yes, but it goes to logs, not terminal. Use `getOriginalConsole()` for CLI output.

**Where are logs?** `logs/text/` (or `LOG_DIR`). Files named `text-logs-YYYY-MM-DD.jsonl`.

**How long kept?** Default 7 days. Configure via `retentionDays` or clean manually.

**How to view?** `quanta log view` - see [Command Reference](commands.md#log-commands) for options.

---

**Related**: [Log Contexts Reference](log-contexts.md) | [Command Reference](commands.md#log-commands)

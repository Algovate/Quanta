# Logging Guide (Lite Mode)

Quanta uses a simplified, non-tiered logging system focused on reliability, clean CLI behavior, and easy log access.

- Text logs are captured to daily-rotated JSONL files in `logs/text/`.
- Set `LOG_DIR` to override the directory. Defaults to `./logs/text`.
- Tiered storage (L0/L1/L2/L3), snapshots, aggregated errors, and metrics persistence are removed.
- Manage logs with `quanta log` commands: `view`, `clean`, `list`, `stats`, and `export`.

---

## How it works

### Console interception

- `UnifiedLogger` intercepts `console.log`, `console.warn`, and `console.error` and writes the output to JSONL files. Intercepted output does not print to the terminal.
- For CLI commands that must display output, use the original console provided by the logger: `UnifiedLogger.getInstance().getOriginalConsole()`.
- For application logging, prefer `unifiedLogger.info/warn/error/debug` which writes directly to JSONL.

### JSONL storage

- Location: `logs/text/text-logs-YYYY-MM-DD.jsonl` (one file per day).
- Rotation: new file each day.
- Retention: keep last N days (default 7).

Record schema (one JSON object per line):

```json
{
  "logId": "string",
  "timestamp": 1730582400000,
  "level": "info|warn|error|debug",
  "context": "Console|UnifiedLogger|TradeStart|Server|...",
  "message": "plain text without ANSI",
  "formattedMessage": "optional text with ANSI styling",
  "metadata": { "any": "structured fields" },
  "cycleId": 0,
  "operationId": "optional",
  "traceId": "optional"
}
```

Notes:

- `message` is ANSI-stripped for easy grepping and machine reads.
- `formattedMessage` may include ANSI styles for pretty terminal rendering.

---

## CLI usage

### View console logs

```bash
# Show last 50 lines (default)
quanta log view

# Tail N lines
quanta log view --lines 200

# Follow (like tail -f)
quanta log view --follow

# Filter by logger context or level
quanta log view --context TradeStart --level warn

# Grep-like filtering on message/context
quanta log view --grep "order|signal"

# Raw output (no ANSI), useful for piping
quanta log view --format raw
```

### Clean old log files

```bash
# Clean files older than retention period (default: 7 days)
quanta log clean

# Clean files older than 14 days
quanta log clean --days 14

# Show what would be deleted without deleting
quanta log clean --days 14 --dry-run

# Delete all log files (with confirmation)
quanta log clean --all

# Delete all files without confirmation
quanta log clean --all --force
```

### List log files

```bash
# List all log files with metadata
quanta log list

# List sorted by size (largest first)
quanta log list --sort size

# Export list as JSON
quanta log list --format json

# Export list as CSV
quanta log list --format csv
```

### Show log statistics

```bash
# Show statistics for all logs
quanta log stats

# Show statistics for last 7 days
quanta log stats --days 7

# Show statistics for errors only
quanta log stats --level error

# Show statistics for specific context
quanta log stats --context TradeStart

# Export statistics as JSON
quanta log stats --format json
```

### Export logs

```bash
# Export all logs as JSON
quanta log export --output logs.json

# Export last 7 days as CSV
quanta log export --output logs.csv --format csv --days 7

# Export errors only as text
quanta log export --output errors.txt --format txt --level error

# Export logs for specific date range
quanta log export --output logs.json --since 2024-01-01 --until 2024-01-31
```

### Common recipes

- Only errors, live:

```bash
quanta log view --level error --follow --format raw
```

- Search for entries related to a component:

```bash
quanta log view --grep "Execution|Position" --lines 500
```

- Clean up old logs before archiving:

```bash
quanta log clean --days 30 --dry-run  # Preview
quanta log clean --days 30             # Clean
```

- Analyze error rates:

```bash
quanta log stats --level error --days 7
```

- Export logs for analysis:

```bash
quanta log export --output errors.json --level error --days 7
```

---

## Configuration

Environment variable:

```bash
# Override JSONL log directory
LOG_DIR=/absolute/path/to/logs/text
```

Optional defaults in `config/config.json`:

```json
{
  "logging": {
    "level": "info",
    "textLogDir": "./logs/text",
    "retentionDays": 7
  }
}
```

- `level`: capture level for text logs.
- `textLogDir`: directory for JSONL files (overridden by `LOG_DIR`).
- `retentionDays`: number of days to keep rotated files.

---

## Best practices

- For human-facing CLI output, always use `getOriginalConsole()` to avoid interception.
- For application events, prefer `unifiedLogger.info/warn/error/debug` with structured metadata.
- Avoid long-running intervals/timers in logging code; the logger should not prevent process exit.
- Keep messages concise; attach structure via `metadata` when needed.

---

## Migration from tiered logging

Removed features in Lite mode:

- L0/L1/L2/L3 storage, SQLite database, snapshots, aggregated errors, metrics persistence, sampling.
- Advanced query commands tied to tiered storage are no longer available.

Alternatives now:

- Use `quanta log view` with filters for operational visibility.
- Use `quanta log stats` for aggregated statistics and error rates.
- Use `quanta log export` to export logs for external analysis.
- Use `quanta log clean` to manage log file retention.
- Emit structured fields in `metadata` for richer context when needed.
- Persist domain data you need elsewhere (e.g., your own stores) rather than relying on logger tiers.

---

## FAQ

### Can I still use `console.log`?

Yes, but intercepted `console.*` writes go to JSONL instead of the terminal. For CLI output that must be shown, use:

```ts
const originalConsole = UnifiedLogger.getInstance().getOriginalConsole();
originalConsole.log('User-visible message');
```

### Why don't commands hang anymore?

Lite logger avoids background intervals and ensures file streams are closed on shutdown. Commands call `UnifiedLogger.getInstance().shutdown()` before exiting.

### Where are logs stored and how do I clean them?

JSONL files are in `logs/text/` (or `LOG_DIR`). Automatic retention deletes files older than `retentionDays` (default: 7 days). Use `quanta log clean` to manually clean old files:

```bash
# Clean files older than retention period
quanta log clean

# Clean files older than N days
quanta log clean --days 14

# Preview what would be deleted
quanta log clean --days 14 --dry-run
```

Use `quanta log list` to see available log files and their sizes.

---

**Last Updated**: November 2025
**Version**: 0.5.0 (Lite)

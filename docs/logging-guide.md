# Logging Guide (Lite Mode)

Quanta uses a simplified, non-tiered logging system focused on reliability, clean CLI behavior, and easy log access.

- Text logs are captured to daily-rotated JSONL files in `logs/text/`.
- Set `LOG_DIR` to override the directory. Defaults to `./logs/text`.
- Tiered storage (L0/L1/L2/L3), snapshots, aggregated errors, and metrics persistence are removed.
- View logs with `quanta log console` (supports `--follow`, `--context`, `--level`, `--grep`, `--format`).

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
quanta log console

# Tail N lines
quanta log console --lines 200

# Follow (like tail -f)
quanta log console --follow

# Filter by logger context or level
quanta log console --context TradeStart --level warn

# Grep-like filtering on message/context
quanta log console --grep "order|signal"

# Raw output (no ANSI), useful for piping
quanta log console --format raw
```

### Common recipes

- Only errors, live:
```bash
quanta log console --level error --follow --format raw
```

- Search for entries related to a component:
```bash
quanta log console --grep "Execution|Position" --lines 500
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
- CLI commands tied to those features are hidden or no-ops (e.g., `log query/trace/stats/snapshot/storage/cleanup`).

Alternatives now:
- Use `quanta log console` with filters for operational visibility.
- Emit structured fields in `metadata` for richer context when needed.
- Persist domain data you need elsewhere (e.g., your own stores) rather than relying on logger tiers.

---

## FAQ

### Can I still use `console.log`?
Yes, but intercepted `console.*` writes go to JSONL instead of the terminal. For CLI output that must be shown, use:

```ts
const originalConsole = UnifiedLogger.getInstance().getOriginalConsole();
originalConsole.log("User-visible message");
```

### Why don’t commands hang anymore?
Lite logger avoids background intervals and ensures file streams are closed on shutdown. Commands call `UnifiedLogger.getInstance().shutdown()` before exiting.

### Where are logs stored and how do I clean them?
JSONL files are in `logs/text/` (or `LOG_DIR`). Retention deletes files older than `retentionDays`. Manual cleanup is just deleting old files.

---

**Last Updated**: November 2025
**Version**: 0.5.0 (Lite)

# Prompt Groups

This directory contains prompt group configurations for the AI trading agent. Each prompt group defines a set of system and user prompts with specific trading strategies and styles.

## File Structure

Each prompt group is defined in a JSON file named `{groupName}.json` with the following structure:

```json
{
  "metadata": {
    "name": "group-name",
    "description": "Description of the prompt group",
    "version": "1.0.0"
  },
  "system": "System prompt template with {{variables}}",
  "user": "User prompt template with {{variables}}"
}
```

## Template Variables

Prompts use Mustache-style variable syntax: `{{variableName}}`

### System Prompt Variables

- `{{tradableCoins}}`: Comma-separated list of tradable coins
- `{{maxPositions}}`: Maximum number of concurrent positions
- `{{maxRiskPerTrade}}`: Maximum risk per trade (as percentage, e.g., "5")
- `{{minLeverage}}`: Minimum leverage
- `{{maxLeverage}}`: Maximum leverage
- `{{defaultStopLoss}}`: Default stop loss percentage (e.g., "3.0")

### User Prompt Variables

- `{{elapsedMinutes}}`: Elapsed time in minutes
- `{{currentTime}}`: Current time in ISO format
- `{{invokeCount}}`: Number of invocations
- `{{candlesTA}}`: Formatted candles and technical analysis section (may be empty if disabled)
- `{{accountInfo}}`: Formatted account information
- `{{positionsInfo}}`: Formatted positions information
- `{{sentimentInfo}}`: Formatted market sentiment section (may be empty if disabled)
- `{{technicalState}}`: Formatted technical state section (may be empty if disabled)

## Configuration

Set the active prompt group in `config/config.json`:

```json
{
  "ai": {
    "prompt": {
      "activeGroup": "default"
    }
  }
}
```

Or via environment variable:

```bash
PROMPT_ACTIVE_GROUP=default
```

## Creating a New Prompt Group

1. Create a new JSON file in this directory: `{yourGroupName}.json`
2. Define the `metadata`, `system`, and `user` fields
3. Use `{{variableName}}` syntax for template variables
4. Set `ai.prompt.activeGroup` in your config to use the new group

## Viewing & Diffing Prompts

```bash
# List groups
quanta prompts list

# View current active prompt group (raw templates)
quanta prompts view

# View a specific group
quanta prompts view --group default

# Rendered view (built-in example context)
quanta prompts view --rendered

# Render with custom context and show variable presence
quanta prompts view --rendered --context config/prompts/context.dev.json --vars

# Only system or only user
quanta prompts view --system-only
quanta prompts view --user-only

# Diff two groups (raw)
quanta prompts diff -g default --with conservative

# Diff two groups (rendered with context)
quanta prompts diff -g default --with aggressive --rendered --context config/prompts/context.dev.json
```

See `docs/commands.md` for complete command documentation.

## Examples

See prompt files in this directory:

- `default.json` - Standard trading prompt with balanced risk approach
- `nofx.json` - Systematic decision framework with strict constraints
- `enhanced.json` - Production-grade prompt with structured output and safety mechanisms (recommended)

## Enhanced Prompt Features

The `enhanced.json` prompt includes:

- **Structured output** with `<thinking>` and `<output>` tags for improved parsing reliability
- **4-stage reasoning framework**: ASSESS → EVALUATE → DECIDE → VALIDATE
- **Concrete examples** of valid signals and rejections
- **Position sizing formulas** and confidence-leverage mapping tables
- **Backward compatibility** with legacy format (without tags)
- **Improved safety** through explicit constraint validation and anti-overtrading rules

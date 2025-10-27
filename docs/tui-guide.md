# Interactive TUI Guide

Quanta includes a comprehensive Terminal User Interface (TUI) powered by Ink for real-time trading visualization and control.

## Features

### Real-Time Dashboard

- **Account Panel** - Live balance, equity, margin usage, total P&L
- **Positions Panel** - Open positions with entry/current prices, leverage, unrealized P&L
- **Market Data Panel** - Current prices, indicators (EMA, RSI, MACD), trend analysis
- **Signals Panel** - Recent AI trading signals with confidence and reasoning
- **Logs Panel** - Scrollable system logs with filtering by level
- **Status Bar** - System status, cycle count, runtime, win rate, risk level

### Visual Charts

- **P&L Sparkline** - Historical profit/loss trend visualization
- **Indicator Gauges** - RSI and MACD visual representations

### Keyboard Controls

- `h` / `?` - Toggle help overlay with all shortcuts
- `p` - Pause/Resume trading cycles
- `q` - Quit gracefully (closes positions and exits)
- `r` - Force refresh/trigger new cycle
- `1-7` - Switch between different view modes

## Getting Started

### Prerequisites

```bash
# Build the project first (required for TUI)
npm run build
```

### Usage

```bash
# Start trading with interactive TUI (ESM version)
node dist/index.js trade start --mode simulation --coins BTC,ETH --ui tui

# Start with CLI output instead
node dist/index.js trade start --mode simulation --coins BTC,ETH

# Using npm script
quanta trade start --mode simulation --coins BTC,ETH --ui tui
```

### Running from Development

The TUI requires the compiled build. Run with `tsx` or `npm run dev` for CLI mode, or build first for TUI.

## Architecture

### Components

- **TUI Manager** (`src/tui/manager.ts`) - Event-driven state management
- **Main App** (`src/tui/app.tsx`) - React component with keyboard handlers
- **Panels** - Modular display components in `src/tui/components/panels/`
- **Charts** - ASCII visualization components in `src/tui/components/charts/`
- **Utils** - Formatting and chart utilities in `src/tui/utils/`

### Event Integration

The TUI receives real-time updates from the trading workflow via EventEmitter:
- Account updates
- Position changes
- New market data
- AI signals
- Order execution

## Troubleshooting

### TUI Not Starting

If TUI fails to start:
1. Ensure project is built: `npm run build`
2. Use compiled binary: `node dist/index.js ...` or `quanta ...`
3. Check terminal size (minimum 120x30 recommended)
4. Verify ESM module system is active (check for `"type": "module"` in package.json)

### Ink/yoga-wasm Errors

If you encounter `yoga-wasm-web` errors:
- Use the compiled build (`npm run build` then run via `quanta`)
- Development mode (`tsx src/index.ts`) will automatically fall back to CLI
- TUI now works with ESM modules

## Future Enhancements

- [ ] Manual order entry dialog
- [ ] Position close interface
- [ ] Coin management dialog
- [ ] Settings/configuration panel
- [ ] Advanced charting modes
- [ ] Multi-terminal layouts

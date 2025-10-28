---
noteId: "840cd930b39c11f09d175548b14f6fd0"
tags: []

---

<!-- 964d5354-1a49-4b3b-87c1-191926cda473 40bbca4d-fdb9-4602-a43a-7a98a4cdbb14 -->
# Remove TUI from Quanta

## Overview

Remove the Terminal User Interface (TUI) implementation while preserving the CLI mode for console-based logging and interaction.

## Implementation Steps

### 1. Delete TUI Source Directory

- Remove entire `/src/tui` directory (27 files including React components, layouts, managers, and utilities)

### 2. Update Trade Command

File: `src/cli/commands/trade.ts`

Remove TUI-related code:

- Remove `--ui <ui>` option from `start` command (line 74)
- Remove `uiMode` variable and logic (lines 147-148, 158-185)
- Remove TUI initialization block (lines 303-367)
- Simplify to only use CLI mode (keep lines 368-373 as default behavior)
- Remove conditional spinner logic (line 265) - always show spinner
- Remove conditional logging checks for `!this.eventEmitter` throughout

### 3. Update Workflow

File: `src/core/workflow.ts`

Remove TUI event emitter support:

- Remove `WorkflowEventEmitter` interface (lines 10-14)
- Remove `eventEmitter` field from class (line 54)
- Remove `eventEmitter` parameter from constructor (line 61)
- Remove all `this.eventEmitter` checks and emit calls (lines 87-92, 163-184, 200-202, 211-213, 235-238, 242-267, 326-328, 346-349, 379-482)
- Remove `setEventEmitter()` method (lines 504-506)
- Simplify `emitLog()` to always use console (remove TUI branch)
- Remove all conditional logging - always log to console

### 4. Update Configuration Schema

File: `src/config/settings.ts`

- Remove `ui` object from `ConfigSchema` (lines 32-35)
- Update TypeScript type inference accordingly

### 5. Update Configuration Files

- `config/config.json`: Remove `ui` section (lines with ui.mode and ui.refreshRate)
- `config/config.example.json`: Remove `ui` section

### 6. Remove Dependencies

File: `package.json`

Remove from dependencies:

- `ink`
- `react`

Remove from devDependencies:

- `@types/react`
- `@types/react-dom`

### 7. Clean Build Artifacts

- Delete `/dist/tui` directory if it exists

### 8. Verify No Remaining References

- Search codebase for any remaining TUI imports or references
- Ensure all TypeScript compilation succeeds

### To-dos

- [x] Delete /src/tui directory
- [x] Remove TUI logic from src/cli/commands/trade.ts
- [x] Remove event emitter and TUI support from src/core/workflow.ts
- [x] Remove ui section from src/config/settings.ts
- [x] Remove ui section from config.json and config.example.json
- [x] Remove React and Ink dependencies from package.json
- [x] Delete /dist/tui directory
- [x] Verify no remaining TUI references and test compilation


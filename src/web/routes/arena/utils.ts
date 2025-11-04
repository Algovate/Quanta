import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import type { ArenaOrchestrator } from '../../../arena/index.js';
import type { ArenaManager } from '../../../arena/index.js';

/**
 * Parse limit query parameter with validation
 */
export function parseLimit(
  queryLimit: string | string[] | undefined,
  defaultValue: number,
  min: number = 1,
  max: number = 1000
): number {
  if (!queryLimit) {
    return defaultValue;
  }

  const parsed = parseInt(String(queryLimit), 10);
  if (isNaN(parsed) || parsed < min) {
    return min;
  }
  if (parsed > max) {
    return max;
  }
  return parsed;
}

/**
 * Get project root directory
 */
export function getProjectRoot(): string {
  const __filename = fileURLToPath(import.meta.url);
  const __dirname = dirname(__filename);
  // From routes/arena/utils.ts -> routes/arena -> routes -> web -> src -> Quanta
  return dirname(dirname(dirname(dirname(__dirname))));
}

/**
 * Get arena config directory path
 */
export function getArenaConfigDir(): string {
  return join(getProjectRoot(), 'config', 'arena');
}

/**
 * Get arena by ID or throw error
 */
export function getArenaOrThrow(arenaManager: ArenaManager, arenaId: string): ArenaOrchestrator {
  const arena = arenaManager.getArena(arenaId);
  if (!arena) {
    throw new Error(`Arena not found: ${arenaId}`);
  }
  return arena;
}

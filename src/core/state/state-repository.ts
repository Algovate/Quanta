/**
 * State Repository
 * Handles persistence of trading system state
 */

import { UnifiedLogger } from '../../logging/index.js';
import type { TradingSystemState } from './state-service.js';
import * as fs from 'fs/promises';
import * as path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export class StateRepository {
  private logger: UnifiedLogger;
  private readonly context = 'StateRepository';
  private readonly stateFilePath: string;

  constructor(stateFilePath?: string) {
    this.logger = UnifiedLogger.getInstance();

    // Default to logs directory
    const logsDir = path.resolve(__dirname, '../../../logs');
    this.stateFilePath = stateFilePath || path.join(logsDir, 'state.json');
  }

  /**
   * Save state to disk
   */
  async save(state: TradingSystemState): Promise<void> {
    try {
      const dir = path.dirname(this.stateFilePath);
      await fs.mkdir(dir, { recursive: true });

      const data = JSON.stringify(state, null, 2);
      await fs.writeFile(this.stateFilePath, data, 'utf-8');

      this.logger.debug(
        'State persisted',
        { filePath: this.stateFilePath, timestamp: state.lastUpdate },
        this.context
      );
    } catch (error) {
      this.logger.error(
        'Failed to persist state',
        error instanceof Error ? error : new Error(String(error)),
        this.context
      );
      throw error;
    }
  }

  /**
   * Load state from disk
   */
  async load(): Promise<TradingSystemState | null> {
    try {
      const data = await fs.readFile(this.stateFilePath, 'utf-8');
      const state = JSON.parse(data) as TradingSystemState;

      this.logger.debug(
        'State loaded from disk',
        { filePath: this.stateFilePath, cycleCount: state.cycleCount },
        this.context
      );

      return state;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        // File doesn't exist yet, that's okay
        return null;
      }

      this.logger.warn(
        'Failed to load persisted state',
        { error: error instanceof Error ? error.message : String(error) },
        this.context
      );

      return null;
    }
  }

  /**
   * Check if state file exists
   */
  async exists(): Promise<boolean> {
    try {
      await fs.access(this.stateFilePath);
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Delete persisted state
   */
  async delete(): Promise<void> {
    try {
      await fs.unlink(this.stateFilePath);
      this.logger.debug('Persisted state deleted', {}, this.context);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
        this.logger.warn(
          'Failed to delete persisted state',
          { error: error instanceof Error ? error.message : String(error) },
          this.context
        );
      }
    }
  }
}

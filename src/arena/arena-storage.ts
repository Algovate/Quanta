/**
 * Arena Storage - SQLite persistence for arena runs
 *
 * Manages persistent storage of arena results in a separate SQLite database.
 * Uses in-memory data during execution, persists to database on completion.
 */

import Database from 'better-sqlite3';
import fs from 'fs';
import path from 'path';
import type { ArenaConfig, ArenaState } from './types.js';
import { UnifiedLogger } from '../logging/index.js';

interface ArenaRunRecord {
  arena_id: string;
  name: string;
  config: string; // JSON
  start_time: number;
  end_time: number | null;
  status: string;
}

interface DroneResultRecord {
  drone_id: string;
  arena_id: string;
  name: string;
  config: string; // JSON
  final_equity: number;
  final_pnl: number;
  total_signals: number;
  total_trades: number;
  win_rate: number;
  sharpe_ratio: number;
  max_drawdown: number;
  ai_cost: number;
  ai_tokens: number;
  ai_call_count: number;
  cycle_count: number;
}

interface DroneSnapshotRecord {
  id?: number;
  drone_id: string;
  timestamp: number;
  equity: number;
  pnl: number;
  cycle_count: number;
  open_positions: number;
}

export class ArenaStorage {
  private db: Database.Database;
  private logger = UnifiedLogger.getInstance();
  private readonly context = 'ArenaStorage';

  constructor(dbPath?: string) {
    const defaultPath = path.join(process.cwd(), 'logs', 'arena.db');
    const finalPath = dbPath || defaultPath;

    // Ensure logs directory exists
    const logsDir = path.dirname(finalPath);
    if (!fs.existsSync(logsDir)) {
      fs.mkdirSync(logsDir, { recursive: true });
    }

    this.db = new Database(finalPath);
    this.initSchema();

    this.logger.info(`ArenaStorage initialized`, { dbPath: finalPath }, this.context);
  }

  private initSchema(): void {
    // Create tables
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS arena_runs (
        arena_id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        config TEXT NOT NULL,
        start_time INTEGER NOT NULL,
        end_time INTEGER,
        status TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS drone_results (
        drone_id TEXT PRIMARY KEY,
        arena_id TEXT NOT NULL,
        name TEXT NOT NULL,
        config TEXT NOT NULL,
        final_equity REAL NOT NULL,
        final_pnl REAL NOT NULL,
        total_signals INTEGER NOT NULL,
        total_trades INTEGER NOT NULL,
        win_rate REAL NOT NULL,
        sharpe_ratio REAL NOT NULL,
        max_drawdown REAL NOT NULL,
        ai_cost REAL NOT NULL,
        ai_tokens INTEGER NOT NULL,
        ai_call_count INTEGER NOT NULL,
        cycle_count INTEGER NOT NULL,
        FOREIGN KEY (arena_id) REFERENCES arena_runs(arena_id)
      );

      CREATE TABLE IF NOT EXISTS drone_snapshots (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        drone_id TEXT NOT NULL,
        timestamp INTEGER NOT NULL,
        equity REAL NOT NULL,
        pnl REAL NOT NULL,
        cycle_count INTEGER NOT NULL,
        open_positions INTEGER NOT NULL,
        FOREIGN KEY (drone_id) REFERENCES drone_results(drone_id)
      );

      CREATE INDEX IF NOT EXISTS idx_drone_timestamp ON drone_snapshots(drone_id, timestamp);
      CREATE INDEX IF NOT EXISTS idx_arena_status ON arena_runs(status);
      CREATE INDEX IF NOT EXISTS idx_arena_time ON arena_runs(start_time DESC);
      CREATE INDEX IF NOT EXISTS idx_drone_arena ON drone_results(arena_id);
    `);
  }

  /**
   * Save an arena run to the database
   */
  async saveArenaRun(state: ArenaState, config: ArenaConfig): Promise<void> {
    const insertRun = this.db.prepare(`
      INSERT INTO arena_runs (arena_id, name, config, start_time, end_time, status)
      VALUES (?, ?, ?, ?, ?, ?)
    `);

    insertRun.run(
      state.arenaId,
      config.name,
      JSON.stringify(config),
      state.startTime,
      state.endTime || null,
      state.status
    );

    // Insert drone results
    const insertDrone = this.db.prepare(`
      INSERT INTO drone_results (
        drone_id, arena_id, name, config, final_equity, final_pnl,
        total_signals, total_trades, win_rate, sharpe_ratio, max_drawdown,
        ai_cost, ai_tokens, ai_call_count, cycle_count
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    for (const [droneId, metrics] of state.droneMetrics) {
      const droneConfig = config.drones.find(d => d.id === droneId);

      insertDrone.run(
        metrics.droneId,
        state.arenaId,
        metrics.name,
        JSON.stringify(droneConfig || {}),
        metrics.equity,
        metrics.pnl,
        metrics.totalSignals,
        metrics.totalTrades,
        metrics.winRate,
        metrics.sharpeRatio,
        metrics.maxDrawdown,
        metrics.aiCost,
        metrics.aiTokens,
        metrics.aiCallCount,
        metrics.cycleCount
      );
    }

    this.logger.info(
      `Saved arena run ${state.arenaId}`,
      {
        arenaId: state.arenaId,
        droneCount: state.droneMetrics.size,
      },
      this.context
    );
  }

  /**
   * Save drone snapshots (equity history)
   */
  async saveSnapshots(
    _arenaId: string,
    snapshots: Array<{
      droneId: string;
      timestamp: number;
      equity: number;
      pnl: number;
      cycleCount: number;
      openPositions: number;
    }>
  ): Promise<void> {
    const insert = this.db.prepare(`
      INSERT INTO drone_snapshots (drone_id, timestamp, equity, pnl, cycle_count, open_positions)
      VALUES (?, ?, ?, ?, ?, ?)
    `);

    const insertMany = this.db.transaction(snaps => {
      for (const snap of snaps) {
        insert.run(
          snap.droneId,
          snap.timestamp,
          snap.equity,
          snap.pnl,
          snap.cycleCount,
          snap.openPositions
        );
      }
    });

    insertMany(snapshots);
  }

  /**
   * Get arena results by ID
   */
  async getArenaResults(arenaId: string): Promise<{
    run: ArenaRunRecord;
    drones: DroneResultRecord[];
    snapshots: DroneSnapshotRecord[];
  } | null> {
    const run = this.db.prepare('SELECT * FROM arena_runs WHERE arena_id = ?').get(arenaId);
    if (!run) {
      return null;
    }

    const drones = this.db
      .prepare('SELECT * FROM drone_results WHERE arena_id = ?')
      .all(arenaId) as DroneResultRecord[];

    const droneIds = drones.map(d => d.drone_id);
    const snapshots =
      droneIds.length > 0
        ? (this.db
            .prepare(
              `
          SELECT * FROM drone_snapshots 
          WHERE drone_id IN (${droneIds.map(() => '?').join(',')})
          ORDER BY drone_id, timestamp
        `
            )
            .all(...droneIds) as DroneSnapshotRecord[])
        : [];

    return { run: run as ArenaRunRecord, drones, snapshots };
  }

  /**
   * List all arena runs
   */
  async listArenaRuns(limit?: number): Promise<ArenaRunRecord[]> {
    const query = limit
      ? this.db.prepare('SELECT * FROM arena_runs ORDER BY start_time DESC LIMIT ?')
      : this.db.prepare('SELECT * FROM arena_runs ORDER BY start_time DESC');

    return limit ? (query.all(limit) as ArenaRunRecord[]) : (query.all() as ArenaRunRecord[]);
  }

  /**
   * Get drone snapshots for a specific drone
   */
  async getDroneSnapshots(droneId: string): Promise<DroneSnapshotRecord[]> {
    return this.db
      .prepare('SELECT * FROM drone_snapshots WHERE drone_id = ? ORDER BY timestamp')
      .all(droneId) as DroneSnapshotRecord[];
  }

  /**
   * Close the database connection
   */
  close(): void {
    this.db.close();
    this.logger.info('ArenaStorage closed', {}, this.context);
  }
}

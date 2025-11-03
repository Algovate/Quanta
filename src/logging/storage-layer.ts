/**
 * Log Storage Layer - Layered storage with intelligent archiving
 *
 * Storage Layers:
 * - L0 (Hot): Recent operations, in-memory cache, full records
 * - L1 (Warm): Recent N cycles, full records, queryable (SQLite)
 * - L2 (Cold): Historical cycles, aggregated summaries, compressed JSON
 * - L3 (Archive): Key events only, compressed archive, long-term storage
 */

import fs from 'fs';
import path from 'path';
import { gzip, gunzip } from 'zlib';
import { promisify } from 'util';
import Database from 'better-sqlite3';
import type {
  OperationLog,
  SystemSnapshot,
  AggregatedError,
  MetricsSnapshot,
  TextLog,
} from './types.js';
import { LOGGING_CONSTANTS } from './utils.js';

const gzipAsync = promisify(gzip);
const gunzipAsync = promisify(gunzip);

interface StorageConfig {
  logDir: string;
  l0MaxSize: number; // Max operations in L0
  l1MaxCycles: number; // Max cycles in L1
  l2MaxCycles: number; // Max cycles in L2 (before archiving)
  l1DatabasePath: string;
  l2Directory: string;
  l3Directory: string;
  compressionEnabled: boolean;
}

export class StorageLayer {
  private static instance: StorageLayer;
  private config: StorageConfig;

  // L0: In-memory cache (recent operations)
  private l0Cache: OperationLog[] = [];

  // L0: In-memory cache (recent text logs)
  private l0TextLogsCache: TextLog[] = [];

  // L1: SQLite database (recent cycles)
  private l1Database: Database.Database | null = null;
  private l1Initialized: boolean = false;

  private constructor() {
    this.config = this.createDefaultConfig();
    this.ensureDirectories();
  }

  static getInstance(): StorageLayer {
    if (!StorageLayer.instance) {
      StorageLayer.instance = new StorageLayer();
    }
    return StorageLayer.instance;
  }

  /**
   * Create default storage configuration
   */
  private createDefaultConfig(): StorageConfig {
    const logDir = process.env.LOG_DIR || LOGGING_CONSTANTS.STORAGE.DEFAULT_LOG_DIR;
    return {
      logDir,
      l0MaxSize: LOGGING_CONSTANTS.STORAGE.L0_MAX_SIZE,
      l1MaxCycles: LOGGING_CONSTANTS.STORAGE.L1_MAX_CYCLES,
      l2MaxCycles: 10000, // Keep last 10000 cycles in L2 (configurable)
      l1DatabasePath: path.join(logDir, 'l1-operations.db'),
      l2Directory: path.join(logDir, LOGGING_CONSTANTS.STORAGE.L2_DIR),
      l3Directory: path.join(logDir, LOGGING_CONSTANTS.STORAGE.L3_DIR),
      compressionEnabled: true,
    };
  }

  /**
   * Ensure storage directories exist
   */
  private ensureDirectories(): void {
    if (!fs.existsSync(this.config.logDir)) {
      fs.mkdirSync(this.config.logDir, { recursive: true });
    }
    if (!fs.existsSync(this.config.l2Directory)) {
      fs.mkdirSync(this.config.l2Directory, { recursive: true });
    }
    if (!fs.existsSync(this.config.l3Directory)) {
      fs.mkdirSync(this.config.l3Directory, { recursive: true });
    }
  }

  /**
   * Store operation log
   */
  async storeOperation(operation: OperationLog): Promise<void> {
    // L0: Add to in-memory cache
    this.l0Cache.push(operation);

    // Trim L0 if exceeds max size
    if (this.l0Cache.length > this.config.l0MaxSize) {
      const toMove = this.l0Cache.slice(0, this.l0Cache.length - this.config.l0MaxSize);
      this.l0Cache = this.l0Cache.slice(-this.config.l0MaxSize);

      // Move to L1
      await this.moveToL1(toMove);
    } else {
      // Also store in L1 for queryability
      await this.storeInL1(operation);
    }
  }

  /**
   * Store operation in L1 (SQLite)
   */
  private async storeInL1(operation: OperationLog): Promise<void> {
    // Initialize L1 database if needed
    if (!this.l1Initialized) {
      await this.initializeL1();
    }

    // If database initialization failed, fallback to file storage
    if (!this.l1Database) {
      await this.storeInL2Fallback(operation);
      return;
    }

    try {
      const stmt = this.l1Database.prepare(`
        INSERT OR REPLACE INTO operations (
          operationId, traceId, cycleId, operationType, symbol, parentOperationId,
          startTime, endTime, status, duration, input, output, error,
          stages, metrics, context, tags, decisionPath, validationResults, dataQuality, createdAt
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);

      stmt.run(
        operation.operationId,
        operation.traceId,
        operation.cycleId,
        operation.operationType,
        operation.symbol || null,
        operation.parentOperationId || null,
        operation.startTime,
        operation.endTime || null,
        operation.status,
        operation.metrics.duration,
        JSON.stringify(operation.input),
        operation.output ? JSON.stringify(operation.output) : null,
        operation.error ? JSON.stringify(operation.error) : null,
        JSON.stringify(operation.stages),
        JSON.stringify(operation.metrics),
        operation.context ? JSON.stringify(operation.context) : null,
        operation.tags ? JSON.stringify(operation.tags) : null,
        operation.decisionPath ? JSON.stringify(operation.decisionPath) : null,
        operation.validationResults ? JSON.stringify(operation.validationResults) : null,
        operation.dataQuality ? JSON.stringify(operation.dataQuality) : null,
        Date.now()
      );

      // Cleanup old cycles if needed
      await this.cleanupOldL1Cycles();
    } catch (error) {
      console.error('Failed to store operation in L1:', error);
      // Fallback to file storage
      await this.storeInL2Fallback(operation);
    }
  }

  /**
   * Fallback to L2 file storage if L1 fails
   */
  private async storeInL2Fallback(operation: OperationLog): Promise<void> {
    const cycleDir = path.join(this.config.l2Directory, `cycle-${operation.cycleId}`);
    if (!fs.existsSync(cycleDir)) {
      fs.mkdirSync(cycleDir, { recursive: true });
    }

    const operationFile = path.join(cycleDir, `${operation.operationId}.json`);
    await fs.promises.writeFile(operationFile, JSON.stringify(operation, null, 2), 'utf-8');
  }

  /**
   * Move operations from L0 to L1
   */
  private async moveToL1(operations: OperationLog[]): Promise<void> {
    for (const operation of operations) {
      await this.storeInL1(operation);
    }
  }

  /**
   * Initialize L1 database
   */
  private async initializeL1(): Promise<void> {
    if (this.l1Initialized) {
      return;
    }

    try {
      // Ensure directory exists
      const dbDir = path.dirname(this.config.l1DatabasePath);
      if (!fs.existsSync(dbDir)) {
        fs.mkdirSync(dbDir, { recursive: true });
      }

      // Open database
      this.l1Database = new Database(this.config.l1DatabasePath);

      // Enable WAL mode for better concurrency
      this.l1Database.pragma('journal_mode = WAL');

      // Create tables
      this.createL1Tables();

      this.l1Initialized = true;
    } catch (error) {
      console.error('Failed to initialize L1 database:', error);
      // Fallback to file-based storage if database initialization fails
      this.l1Initialized = false;
      this.l1Database = null;
    }
  }

  /**
   * Create L1 database tables
   */
  private createL1Tables(): void {
    if (!this.l1Database) {
      return;
    }

    // Create operations table
    this.l1Database.exec(`
      CREATE TABLE IF NOT EXISTS operations (
        operationId TEXT PRIMARY KEY,
        traceId TEXT NOT NULL,
        cycleId INTEGER NOT NULL,
        operationType TEXT NOT NULL,
        symbol TEXT,
        parentOperationId TEXT,
        startTime INTEGER NOT NULL,
        endTime INTEGER,
        status TEXT NOT NULL,
        duration INTEGER NOT NULL,
        input TEXT NOT NULL,
        output TEXT,
        error TEXT,
        stages TEXT NOT NULL,
        metrics TEXT NOT NULL,
        context TEXT,
        tags TEXT,
        decisionPath TEXT,
        validationResults TEXT,
        dataQuality TEXT,
        createdAt INTEGER NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_cycleId ON operations(cycleId);
      CREATE INDEX IF NOT EXISTS idx_traceId ON operations(traceId);
      CREATE INDEX IF NOT EXISTS idx_operationType ON operations(operationType);
      CREATE INDEX IF NOT EXISTS idx_status ON operations(status);
      CREATE INDEX IF NOT EXISTS idx_symbol ON operations(symbol);
      CREATE INDEX IF NOT EXISTS idx_startTime ON operations(startTime);
      CREATE INDEX IF NOT EXISTS idx_parentOperationId ON operations(parentOperationId);
      -- Composite indexes for common query patterns
      CREATE INDEX IF NOT EXISTS idx_operations_cycleId_status ON operations(cycleId, status);
      CREATE INDEX IF NOT EXISTS idx_operations_cycleId_type ON operations(cycleId, operationType);
      CREATE INDEX IF NOT EXISTS idx_operations_traceId_status ON operations(traceId, status);
      CREATE INDEX IF NOT EXISTS idx_operations_startTime_status ON operations(startTime, status);
      CREATE INDEX IF NOT EXISTS idx_operations_startTime_type ON operations(startTime, operationType);
      CREATE INDEX IF NOT EXISTS idx_operations_symbol_status ON operations(symbol, status);
      CREATE INDEX IF NOT EXISTS idx_operations_type_status ON operations(operationType, status);

      CREATE TABLE IF NOT EXISTS text_logs (
        logId TEXT PRIMARY KEY,
        timestamp INTEGER NOT NULL,
        level TEXT NOT NULL,
        context TEXT NOT NULL,
        message TEXT NOT NULL,
        metadata TEXT,
        cycleId INTEGER,
        operationId TEXT,
        traceId TEXT,
        createdAt INTEGER NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_text_logs_timestamp ON text_logs(timestamp);
      CREATE INDEX IF NOT EXISTS idx_text_logs_level ON text_logs(level);
      CREATE INDEX IF NOT EXISTS idx_text_logs_context ON text_logs(context);
      CREATE INDEX IF NOT EXISTS idx_text_logs_cycleId ON text_logs(cycleId);
      CREATE INDEX IF NOT EXISTS idx_text_logs_operationId ON text_logs(operationId);
      CREATE INDEX IF NOT EXISTS idx_text_logs_traceId ON text_logs(traceId);
      -- Composite indexes for common query patterns
      CREATE INDEX IF NOT EXISTS idx_text_logs_timestamp_cycleId ON text_logs(timestamp, cycleId);
      CREATE INDEX IF NOT EXISTS idx_text_logs_timestamp_level ON text_logs(timestamp, level);
      CREATE INDEX IF NOT EXISTS idx_text_logs_timestamp_context ON text_logs(timestamp, context);
      CREATE INDEX IF NOT EXISTS idx_text_logs_cycleId_level ON text_logs(cycleId, level);
      CREATE INDEX IF NOT EXISTS idx_text_logs_cycleId_context ON text_logs(cycleId, context);
      CREATE INDEX IF NOT EXISTS idx_text_logs_operationId_timestamp ON text_logs(operationId, timestamp);
      CREATE INDEX IF NOT EXISTS idx_text_logs_traceId_timestamp ON text_logs(traceId, timestamp);
    `);

    // Migrate existing tables: add missing columns if they don't exist
    this.migrateL1Tables();
  }

  /**
   * Migrate L1 database tables to add new columns
   */
  private migrateL1Tables(): void {
    if (!this.l1Database) {
      return;
    }

    try {
      // Check if table exists
      const tableInfo = this.l1Database
        .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='operations'")
        .get();

      if (!tableInfo) {
        return; // Table doesn't exist, will be created by CREATE TABLE IF NOT EXISTS
      }

      // Get existing columns
      const columns = this.l1Database.prepare('PRAGMA table_info(operations)').all() as Array<{
        name: string;
      }>;

      const columnNames = new Set(columns.map(col => col.name));

      // Add missing columns
      if (!columnNames.has('decisionPath')) {
        this.l1Database.exec('ALTER TABLE operations ADD COLUMN decisionPath TEXT');
      }

      if (!columnNames.has('validationResults')) {
        this.l1Database.exec('ALTER TABLE operations ADD COLUMN validationResults TEXT');
      }

      if (!columnNames.has('dataQuality')) {
        this.l1Database.exec('ALTER TABLE operations ADD COLUMN dataQuality TEXT');
      }

      // Migrate text_logs table
      const textLogsTableInfo = this.l1Database
        .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='text_logs'")
        .get();

      if (textLogsTableInfo) {
        const textLogsColumns = this.l1Database
          .prepare('PRAGMA table_info(text_logs)')
          .all() as Array<{ name: string }>;

        const textLogsColumnNames = new Set(textLogsColumns.map(col => col.name));

        // Add missing columns
        if (!textLogsColumnNames.has('operationId')) {
          this.l1Database.exec('ALTER TABLE text_logs ADD COLUMN operationId TEXT');
        }

        if (!textLogsColumnNames.has('traceId')) {
          this.l1Database.exec('ALTER TABLE text_logs ADD COLUMN traceId TEXT');
        }

        // Note: We don't remove formattedMessage column if it exists to avoid data loss
        // It will just be ignored in future reads/writes
      }
    } catch (error) {
      console.error('Failed to migrate L1 tables:', error);
      // Continue execution - migration failures are not critical
    }
  }

  /**
   * Store system snapshot
   */
  async storeSnapshot(snapshot: SystemSnapshot): Promise<void> {
    const snapshotFile = path.join(this.config.l2Directory, `snapshot-${snapshot.snapshotId}.json`);

    if (this.config.compressionEnabled) {
      const json = JSON.stringify(snapshot);
      const compressed = await gzipAsync(Buffer.from(json, 'utf-8'));
      await fs.promises.writeFile(snapshotFile + '.gz', compressed);
    } else {
      await fs.promises.writeFile(snapshotFile, JSON.stringify(snapshot, null, 2), 'utf-8');
    }
  }

  /**
   * Store aggregated errors
   */
  async storeAggregatedErrors(errors: AggregatedError[]): Promise<void> {
    const timestamp = Date.now();
    const errorFile = path.join(this.config.l2Directory, `errors-${timestamp}.json`);

    if (this.config.compressionEnabled) {
      const json = JSON.stringify(errors);
      const compressed = await gzipAsync(Buffer.from(json, 'utf-8'));
      await fs.promises.writeFile(errorFile + '.gz', compressed);
    } else {
      await fs.promises.writeFile(errorFile, JSON.stringify(errors, null, 2), 'utf-8');
    }
  }

  /**
   * Store metrics snapshot
   */
  async storeMetricsSnapshot(snapshot: MetricsSnapshot): Promise<void> {
    const metricsFile = path.join(this.config.l2Directory, `metrics-${snapshot.cycleId}.json`);

    if (this.config.compressionEnabled) {
      const json = JSON.stringify(snapshot);
      const compressed = await gzipAsync(Buffer.from(json, 'utf-8'));
      await fs.promises.writeFile(metricsFile + '.gz', compressed);
    } else {
      await fs.promises.writeFile(metricsFile, JSON.stringify(snapshot, null, 2), 'utf-8');
    }
  }

  /**
   * Store text log
   */
  async storeTextLog(log: TextLog): Promise<void> {
    // L0: Add to in-memory cache
    this.l0TextLogsCache.push(log);

    // Trim L0 if exceeds max size
    if (this.l0TextLogsCache.length > this.config.l0MaxSize) {
      const toMove = this.l0TextLogsCache.slice(
        0,
        this.l0TextLogsCache.length - this.config.l0MaxSize
      );
      this.l0TextLogsCache = this.l0TextLogsCache.slice(-this.config.l0MaxSize);

      // Move to L1
      await this.moveTextLogsToL1(toMove);
    } else {
      // Also store in L1 for queryability
      await this.storeTextLogInL1(log);
    }
  }

  /**
   * Store text log in L1 (SQLite)
   */
  private async storeTextLogInL1(log: TextLog): Promise<void> {
    // Initialize L1 database if needed
    if (!this.l1Initialized) {
      await this.initializeL1();
    }

    // If database initialization failed, fallback to file storage
    if (!this.l1Database) {
      await this.storeTextLogInL2Fallback(log);
      return;
    }

    try {
      const stmt = this.l1Database.prepare(`
        INSERT OR REPLACE INTO text_logs (
          logId, timestamp, level, context, message, metadata, cycleId, operationId, traceId, createdAt
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);

      stmt.run(
        log.logId,
        log.timestamp,
        log.level,
        log.context,
        log.message,
        log.metadata ? JSON.stringify(log.metadata) : null,
        log.cycleId ?? null,
        log.operationId ?? null,
        log.traceId ?? null,
        Date.now()
      );
    } catch (error) {
      console.error('Failed to store text log in L1:', error);
      // Fallback to file storage
      await this.storeTextLogInL2Fallback(log);
    }
  }

  /**
   * Move text logs from L0 to L1
   */
  private async moveTextLogsToL1(logs: TextLog[]): Promise<void> {
    for (const log of logs) {
      await this.storeTextLogInL1(log);
    }
  }

  /**
   * Fallback to L2 file storage if L1 fails for text logs
   */
  private async storeTextLogInL2Fallback(log: TextLog): Promise<void> {
    const cycleDir = log.cycleId
      ? path.join(this.config.l2Directory, `cycle-${log.cycleId}`)
      : path.join(this.config.l2Directory, 'text-logs');
    if (!fs.existsSync(cycleDir)) {
      fs.mkdirSync(cycleDir, { recursive: true });
    }

    const logFile = path.join(cycleDir, `${log.logId}.json`);
    await fs.promises.writeFile(logFile, JSON.stringify(log, null, 2), 'utf-8');
  }

  /**
   * Get text logs from L0 (in-memory)
   */
  getTextLogsFromL0(count: number = 100): TextLog[] {
    return this.l0TextLogsCache.slice(-count);
  }

  /**
   * Get text logs from L1 (SQLite)
   */
  async getTextLogsFromL1(options: {
    context?: string;
    level?: 'info' | 'warn' | 'error' | 'debug';
    since?: number;
    until?: number;
    cycleId?: number;
    limit?: number;
    offset?: number;
  }): Promise<TextLog[]> {
    // Initialize L1 database if needed
    if (!this.l1Initialized) {
      await this.initializeL1();
    }

    if (!this.l1Database) {
      // Fallback to L0 if L1 is not available
      return this.getTextLogsFromL0(options.limit || 100);
    }

    try {
      const conditions: string[] = [];
      const params: any[] = [];

      if (options.context) {
        conditions.push('context = ?');
        params.push(options.context);
      }

      if (options.level) {
        conditions.push('level = ?');
        params.push(options.level);
      }

      if (options.since !== undefined) {
        conditions.push('timestamp >= ?');
        params.push(options.since);
      }

      if (options.until !== undefined) {
        conditions.push('timestamp <= ?');
        params.push(options.until);
      }

      if (options.cycleId !== undefined) {
        conditions.push('cycleId = ?');
        params.push(options.cycleId);
      }

      const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
      const limit = options.limit || 100;
      const offset = options.offset || 0;

      const query = `
        SELECT logId, timestamp, level, context, message, metadata, cycleId, operationId, traceId
        FROM text_logs
        ${whereClause}
        ORDER BY timestamp DESC
        LIMIT ? OFFSET ?
      `;

      const rows = this.l1Database.prepare(query).all(...params, limit, offset) as Array<{
        logId: string;
        timestamp: number;
        level: string;
        context: string;
        message: string;
        metadata: string | null;
        cycleId: number | null;
        operationId: string | null;
        traceId: string | null;
      }>;

      return rows.map(row => ({
        logId: row.logId,
        timestamp: row.timestamp,
        level: row.level as 'info' | 'warn' | 'error' | 'debug',
        context: row.context,
        message: row.message,
        metadata: row.metadata ? JSON.parse(row.metadata) : undefined,
        cycleId: row.cycleId || undefined,
        operationId: row.operationId || undefined,
        traceId: row.traceId || undefined,
      }));
    } catch (error) {
      console.error('Failed to get text logs from L1:', error);
      // Fallback to L0
      return this.getTextLogsFromL0(options.limit || 100);
    }
  }

  /**
   * Get operations from L0 (in-memory)
   */
  getOperationsFromL0(count: number = 100): OperationLog[] {
    return this.l0Cache.slice(-count);
  }

  /**
   * Get operations from L1 (SQLite)
   */
  async getOperationsFromL1(
    options: {
      cycleId?: number;
      traceId?: string;
      operationId?: string;
      operationType?: string;
      status?: string;
      symbol?: string;
      startTime?: number;
      endTime?: number;
      limit?: number;
      offset?: number;
    } = {}
  ): Promise<OperationLog[]> {
    // Initialize L1 database if not already initialized
    if (!this.l1Initialized) {
      await this.initializeL1();
    }

    if (!this.l1Database || !this.l1Initialized) {
      return [];
    }

    try {
      let query = 'SELECT * FROM operations WHERE 1=1';
      const params: any[] = [];

      if (options.cycleId !== undefined) {
        query += ' AND cycleId = ?';
        params.push(options.cycleId);
      }

      if (options.traceId) {
        // Support partial match using LIKE for SQLite
        query += ' AND traceId LIKE ?';
        params.push(`${options.traceId}%`);
      }

      if (options.operationId) {
        // Support partial match using LIKE for SQLite
        query += ' AND operationId LIKE ?';
        params.push(`${options.operationId}%`);
      }

      if (options.operationType) {
        query += ' AND operationType = ?';
        params.push(options.operationType);
      }

      if (options.status) {
        query += ' AND status = ?';
        params.push(options.status);
      }

      if (options.symbol) {
        query += ' AND symbol = ?';
        params.push(options.symbol);
      }

      if (options.startTime !== undefined) {
        query += ' AND startTime >= ?';
        params.push(options.startTime);
      }

      if (options.endTime !== undefined) {
        query += ' AND startTime <= ?';
        params.push(options.endTime);
      }

      query += ' ORDER BY startTime DESC';

      if (options.limit !== undefined) {
        query += ' LIMIT ?';
        params.push(options.limit);
      }

      if (options.offset !== undefined) {
        query += ' OFFSET ?';
        params.push(options.offset);
      }

      const stmt = this.l1Database.prepare(query);
      const rows = stmt.all(...params) as Array<{
        operationId: string;
        traceId: string;
        cycleId: number;
        operationType: string;
        symbol: string | null;
        parentOperationId: string | null;
        startTime: number;
        endTime: number | null;
        status: string;
        duration: number;
        input: string;
        output: string | null;
        error: string | null;
        stages: string;
        metrics: string;
        context: string | null;
        tags: string | null;
        decisionPath: string | null;
        validationResults: string | null;
        dataQuality: string | null;
        createdAt: number;
      }>;

      // Deserialize JSON fields
      return rows.map(row => ({
        operationId: row.operationId,
        traceId: row.traceId,
        cycleId: row.cycleId,
        operationType: row.operationType,
        symbol: row.symbol || undefined,
        parentOperationId: row.parentOperationId || undefined,
        startTime: row.startTime,
        endTime: row.endTime || undefined,
        status: row.status as OperationLog['status'],
        input: JSON.parse(row.input),
        output: row.output ? JSON.parse(row.output) : undefined,
        error: row.error ? JSON.parse(row.error) : undefined,
        stages: JSON.parse(row.stages),
        metrics: JSON.parse(row.metrics),
        context: row.context ? JSON.parse(row.context) : undefined,
        tags: row.tags ? JSON.parse(row.tags) : undefined,
        decisionPath: row.decisionPath ? JSON.parse(row.decisionPath) : undefined,
        validationResults: row.validationResults ? JSON.parse(row.validationResults) : undefined,
        dataQuality: row.dataQuality ? JSON.parse(row.dataQuality) : undefined,
      }));
    } catch (error) {
      console.error('Failed to query operations from L1:', error);
      return [];
    }
  }

  /**
   * Get count of operations in L1
   */
  async getL1OperationCount(
    options: {
      cycleId?: number;
      traceId?: string;
      operationType?: string;
      status?: string;
      symbol?: string;
    } = {}
  ): Promise<number> {
    // Initialize L1 database if not already initialized
    if (!this.l1Initialized) {
      await this.initializeL1();
    }

    if (!this.l1Database || !this.l1Initialized) {
      return 0;
    }

    try {
      let query = 'SELECT COUNT(*) as count FROM operations WHERE 1=1';
      const params: any[] = [];

      if (options.cycleId !== undefined) {
        query += ' AND cycleId = ?';
        params.push(options.cycleId);
      }

      if (options.traceId) {
        query += ' AND traceId = ?';
        params.push(options.traceId);
      }

      if (options.operationType) {
        query += ' AND operationType = ?';
        params.push(options.operationType);
      }

      if (options.status) {
        query += ' AND status = ?';
        params.push(options.status);
      }

      if (options.symbol) {
        query += ' AND symbol = ?';
        params.push(options.symbol);
      }

      const stmt = this.l1Database.prepare(query);
      const result = stmt.get(...params) as { count: number };
      return result?.count || 0;
    } catch (error) {
      console.error('Failed to count operations in L1:', error);
      return 0;
    }
  }

  /**
   * Get unique cycle IDs from L1
   */
  async getL1CycleIds(): Promise<number[]> {
    // Initialize L1 database if not already initialized
    if (!this.l1Initialized) {
      await this.initializeL1();
    }

    if (!this.l1Database || !this.l1Initialized) {
      return [];
    }

    try {
      const stmt = this.l1Database.prepare(
        'SELECT DISTINCT cycleId FROM operations ORDER BY cycleId DESC'
      );
      const rows = stmt.all() as Array<{ cycleId: number }>;
      return rows.map(row => row.cycleId);
    } catch (error) {
      console.error('Failed to get cycle IDs from L1:', error);
      return [];
    }
  }

  /**
   * Cleanup old L1 cycles
   */
  private async cleanupOldL1Cycles(): Promise<void> {
    if (!this.l1Database || !this.l1Initialized) {
      return;
    }

    try {
      // Get cycle IDs from L1
      const cycleIds = await this.getL1CycleIds();

      if (cycleIds.length <= this.config.l1MaxCycles) {
        return;
      }

      // Archive cycles that exceed L1MaxCycles
      const cyclesToArchive = cycleIds.slice(0, cycleIds.length - this.config.l1MaxCycles);

      for (const cycleId of cyclesToArchive) {
        // Move operations from L1 to L2
        const ops = await this.getOperationsFromL1({ cycleId, limit: 10000 });

        // Store to L2
        for (const op of ops) {
          await this.storeInL2Fallback(op);
        }

        // Delete from L1
        if (this.l1Database) {
          const deleteStmt = this.l1Database.prepare('DELETE FROM operations WHERE cycleId = ?');
          deleteStmt.run(cycleId);
        }
      }
    } catch (error) {
      console.error('Failed to cleanup old L1 cycles:', error);
    }
  }

  /**
   * Get operations by cycle ID
   */
  async getOperationsByCycle(cycleId: number): Promise<OperationLog[]> {
    // First check L0
    const l0Ops = this.l0Cache.filter(op => op.cycleId === cycleId);

    // Then check L1
    const l1Ops = await this.getOperationsFromL1({ cycleId, limit: 10000 });

    // Combine and deduplicate by operationId
    const opsMap = new Map<string, OperationLog>();
    for (const op of [...l0Ops, ...l1Ops]) {
      opsMap.set(op.operationId, op);
    }

    const allOps = Array.from(opsMap.values());

    // Sort by start time
    return allOps.sort((a, b) => a.startTime - b.startTime);
  }

  /**
   * Get snapshot by ID
   */
  async getSnapshotById(snapshotId: string): Promise<SystemSnapshot | null> {
    const snapshotFile = path.join(this.config.l2Directory, `snapshot-${snapshotId}.json`);
    const compressedFile = snapshotFile + '.gz';

    try {
      let content: string;

      if (fs.existsSync(compressedFile)) {
        const compressed = await fs.promises.readFile(compressedFile);
        const decompressed = await gunzipAsync(compressed);
        content = decompressed.toString('utf-8');
      } else if (fs.existsSync(snapshotFile)) {
        content = await fs.promises.readFile(snapshotFile, 'utf-8');
      } else {
        return null;
      }

      return JSON.parse(content) as SystemSnapshot;
    } catch (error) {
      console.error('Error reading snapshot:', error);
      return null;
    }
  }

  /**
   * List all snapshots from storage
   */
  async listSnapshots(): Promise<
    Array<{ snapshotId: string; timestamp: number; cycleId: number }>
  > {
    if (!fs.existsSync(this.config.l2Directory)) {
      return [];
    }

    try {
      const files = await fs.promises.readdir(this.config.l2Directory);
      const snapshots: Array<{ snapshotId: string; timestamp: number; cycleId: number }> = [];

      for (const file of files) {
        if (!file.startsWith('snapshot-')) continue;

        // Remove .json or .json.gz extension
        const snapshotId = file.replace(/^snapshot-/, '').replace(/\.json(\.gz)?$/, '');

        try {
          const snapshot = await this.getSnapshotById(snapshotId);
          if (snapshot) {
            snapshots.push({
              snapshotId: snapshot.snapshotId,
              timestamp: snapshot.timestamp,
              cycleId: snapshot.cycleId,
            });
          }
        } catch {
          // Skip corrupted snapshots
          continue;
        }
      }

      // Sort by timestamp descending (newest first)
      snapshots.sort((a, b) => b.timestamp - a.timestamp);
      return snapshots;
    } catch (error) {
      console.error('Error listing snapshots:', error);
      return [];
    }
  }

  /**
   * Get latest snapshot from storage
   */
  async getLatestSnapshot(): Promise<SystemSnapshot | null> {
    const snapshots = await this.listSnapshots();
    if (snapshots.length === 0) {
      return null;
    }

    // Get the most recent snapshot
    return await this.getSnapshotById(snapshots[0].snapshotId);
  }

  /**
   * Get operations in time range
   */
  async getOperationsInTimeRange(startTime: number, endTime: number): Promise<OperationLog[]> {
    // Get from L0
    const l0Ops = this.l0Cache.filter(op => op.startTime >= startTime && op.startTime <= endTime);

    // Get from L1
    const l1Ops = await this.getOperationsFromL1({ startTime, endTime, limit: 10000 });

    // Combine and deduplicate by operationId
    const opsMap = new Map<string, OperationLog>();
    for (const op of [...l0Ops, ...l1Ops]) {
      opsMap.set(op.operationId, op);
    }

    return Array.from(opsMap.values()).sort((a, b) => a.startTime - b.startTime);
  }

  /**
   * Archive old data to L3
   */
  async archiveToL3(cycleId: number): Promise<void> {
    const cycleDir = path.join(this.config.l2Directory, `cycle-${cycleId}`);
    if (!fs.existsSync(cycleDir)) {
      return;
    }

    // Create archive directory
    const archiveDir = path.join(this.config.l3Directory, `cycle-${cycleId}`);
    if (!fs.existsSync(archiveDir)) {
      fs.mkdirSync(archiveDir, { recursive: true });
    }

    // Move files to archive
    const files = await fs.promises.readdir(cycleDir);
    for (const file of files) {
      const src = path.join(cycleDir, file);
      const dest = path.join(archiveDir, file);
      await fs.promises.rename(src, dest);
    }

    // Remove empty cycle directory
    await fs.promises.rmdir(cycleDir);
  }

  /**
   * Cleanup old data
   */
  async cleanup(maxCycles: number): Promise<void> {
    // Cleanup L1 first
    if (this.l1Database && this.l1Initialized) {
      await this.cleanupOldL1Cycles();
    }

    // List all cycle directories in L2
    if (!fs.existsSync(this.config.l2Directory)) {
      return;
    }

    const cycleDirs = await fs.promises.readdir(this.config.l2Directory);
    const cycleIds = cycleDirs
      .filter(dir => dir.startsWith('cycle-'))
      .map(dir => parseInt(dir.replace('cycle-', ''), 10))
      .filter(id => !isNaN(id))
      .sort((a, b) => a - b);

    // Archive old cycles
    const cyclesToArchive = cycleIds.slice(0, cycleIds.length - maxCycles);
    for (const cycleId of cyclesToArchive) {
      await this.archiveToL3(cycleId);
    }
  }

  /**
   * Cleanup logs older than specified days
   */
  async cleanupByDays(keepDays: number): Promise<{
    deletedCycles: number[];
    deletedOperations: number;
  }> {
    const cutoffTime = Date.now() - keepDays * 24 * 60 * 60 * 1000;
    const deletedCycles: number[] = [];
    let deletedOperations = 0;

    // Cleanup L1: Delete operations older than cutoff
    if (this.l1Database && this.l1Initialized) {
      try {
        const deleteStmt = this.l1Database.prepare('DELETE FROM operations WHERE startTime < ?');
        const result = deleteStmt.run(cutoffTime);
        deletedOperations += result.changes || 0;

        // Get cycles with no operations left
        const cycleIds = await this.getL1CycleIds();
        for (const cycleId of cycleIds) {
          const count = await this.getL1OperationCount({ cycleId });
          if (count === 0) {
            deletedCycles.push(cycleId);
          }
        }
      } catch (error) {
        console.error('Failed to cleanup L1 by days:', error);
      }
    }

    // Cleanup L2: Delete cycle directories older than cutoff
    if (fs.existsSync(this.config.l2Directory)) {
      try {
        const cycleDirs = await fs.promises.readdir(this.config.l2Directory);
        for (const dir of cycleDirs) {
          if (!dir.startsWith('cycle-')) continue;

          const cycleId = parseInt(dir.replace('cycle-', ''), 10);
          if (isNaN(cycleId)) continue;

          const cycleDir = path.join(this.config.l2Directory, dir);
          const files = await fs.promises.readdir(cycleDir);

          // Check if any file is older than cutoff
          let shouldDelete = true;
          for (const file of files) {
            const filePath = path.join(cycleDir, file);
            const stats = await fs.promises.stat(filePath);
            if (stats.mtime.getTime() >= cutoffTime) {
              shouldDelete = false;
              break;
            }
          }

          if (shouldDelete) {
            // Count operations before deleting
            for (const file of files) {
              if (file.endsWith('.json')) {
                deletedOperations++;
              }
            }

            await fs.promises.rm(cycleDir, { recursive: true });
            deletedCycles.push(cycleId);
          }
        }
      } catch (error) {
        console.error('Failed to cleanup L2 by days:', error);
      }
    }

    // Cleanup L3: Delete archive directories older than cutoff
    if (fs.existsSync(this.config.l3Directory)) {
      try {
        const archiveDirs = await fs.promises.readdir(this.config.l3Directory);
        for (const dir of archiveDirs) {
          if (!dir.startsWith('cycle-')) continue;

          const cycleId = parseInt(dir.replace('cycle-', ''), 10);
          if (isNaN(cycleId)) continue;

          const archiveDir = path.join(this.config.l3Directory, dir);
          const stats = await fs.promises.stat(archiveDir);
          if (stats.mtime.getTime() < cutoffTime) {
            await fs.promises.rm(archiveDir, { recursive: true });
            deletedCycles.push(cycleId);
          }
        }
      } catch (error) {
        console.error('Failed to cleanup L3 by days:', error);
      }
    }

    return { deletedCycles, deletedOperations };
  }

  /**
   * Get cleanup preview (dry-run)
   */
  async getCleanupPreview(options: { maxCycles?: number; keepDays?: number }): Promise<{
    l1CyclesToClean: number[];
    l2CyclesToClean: number[];
    l3CyclesToClean: number[];
    totalCyclesToClean: number;
    estimatedOperationsToClean: number;
  }> {
    const l1CyclesToClean: number[] = [];
    const l2CyclesToClean: number[] = [];
    const l3CyclesToClean: number[] = [];
    let estimatedOperationsToClean = 0;

    if (options.keepDays !== undefined) {
      const cutoffTime = Date.now() - options.keepDays * 24 * 60 * 60 * 1000;

      // Check L1
      if (this.l1Database && this.l1Initialized) {
        try {
          const allOps = await this.getOperationsFromL1({ limit: 100000 });
          const oldOps = allOps.filter(op => op.startTime < cutoffTime);
          const oldCycles = new Set(oldOps.map(op => op.cycleId));
          l1CyclesToClean.push(...oldCycles);
          estimatedOperationsToClean += oldOps.length;
        } catch {
          // Ignore errors
        }
      }

      // Check L2
      if (fs.existsSync(this.config.l2Directory)) {
        try {
          const cycleDirs = await fs.promises.readdir(this.config.l2Directory);
          for (const dir of cycleDirs) {
            if (!dir.startsWith('cycle-')) continue;
            const cycleDir = path.join(this.config.l2Directory, dir);
            const stats = await fs.promises.stat(cycleDir);
            if (stats.mtime.getTime() < cutoffTime) {
              l2CyclesToClean.push(parseInt(dir.replace('cycle-', ''), 10));
              const files = await fs.promises.readdir(cycleDir);
              estimatedOperationsToClean += files.filter(f => f.endsWith('.json')).length;
            }
          }
        } catch {
          // Ignore errors
        }
      }

      // Check L3
      if (fs.existsSync(this.config.l3Directory)) {
        try {
          const archiveDirs = await fs.promises.readdir(this.config.l3Directory);
          for (const dir of archiveDirs) {
            if (!dir.startsWith('cycle-')) continue;
            const archiveDir = path.join(this.config.l3Directory, dir);
            const stats = await fs.promises.stat(archiveDir);
            if (stats.mtime.getTime() < cutoffTime) {
              l3CyclesToClean.push(parseInt(dir.replace('cycle-', ''), 10));
            }
          }
        } catch {
          // Ignore errors
        }
      }
    } else if (options.maxCycles !== undefined) {
      // Cleanup by max cycles (L2 only)
      if (fs.existsSync(this.config.l2Directory)) {
        try {
          const cycleDirs = await fs.promises.readdir(this.config.l2Directory);
          const cycleIds = cycleDirs
            .filter(dir => dir.startsWith('cycle-'))
            .map(dir => parseInt(dir.replace('cycle-', ''), 10))
            .filter(id => !isNaN(id))
            .sort((a, b) => a - b);

          const cyclesToArchive = cycleIds.slice(0, cycleIds.length - options.maxCycles);
          l2CyclesToClean.push(...cyclesToArchive);

          // Count operations
          for (const cycleId of cyclesToArchive) {
            const cycleDir = path.join(this.config.l2Directory, `cycle-${cycleId}`);
            if (fs.existsSync(cycleDir)) {
              const files = await fs.promises.readdir(cycleDir);
              estimatedOperationsToClean += files.filter(f => f.endsWith('.json')).length;
            }
          }
        } catch {
          // Ignore errors
        }
      }
    }

    return {
      l1CyclesToClean,
      l2CyclesToClean,
      l3CyclesToClean,
      totalCyclesToClean: l1CyclesToClean.length + l2CyclesToClean.length + l3CyclesToClean.length,
      estimatedOperationsToClean,
    };
  }

  /**
   * Get storage statistics
   */
  async getStats(): Promise<{
    l0Size: number;
    l1Cycles: number;
    l2Cycles: number;
    l3Cycles: number;
    totalOperations: number;
  }> {
    let l2Cycles = 0;
    let l3Cycles = 0;

    try {
      // Count L2 cycles
      if (fs.existsSync(this.config.l2Directory)) {
        const l2Dirs = await fs.promises.readdir(this.config.l2Directory);
        l2Cycles = l2Dirs.filter(dir => dir.startsWith('cycle-')).length;
      }

      // Count L3 cycles
      if (fs.existsSync(this.config.l3Directory)) {
        const l3Dirs = await fs.promises.readdir(this.config.l3Directory);
        l3Cycles = l3Dirs.filter(dir => dir.startsWith('cycle-')).length;
      }
    } catch (error) {
      // Ignore errors in stats calculation
      console.error('Error calculating storage stats:', error);
    }

    // Count L1 cycles
    let l1Cycles = 0;
    if (this.l1Database && this.l1Initialized) {
      try {
        const cycleIds = await this.getL1CycleIds();
        l1Cycles = cycleIds.length;
      } catch (error) {
        console.error('Failed to count L1 cycles:', error);
      }
    }

    // Count total operations
    let totalOperations = this.l0Cache.length;
    if (this.l1Database && this.l1Initialized) {
      try {
        const l1Count = await this.getL1OperationCount();
        totalOperations += l1Count;
      } catch {
        // Ignore errors
      }
    }

    return {
      l0Size: this.l0Cache.length,
      l1Cycles,
      l2Cycles,
      l3Cycles,
      totalOperations,
    };
  }

  /**
   * Update storage configuration
   */
  updateConfig(config: Partial<StorageConfig>): void {
    this.config = { ...this.config, ...config };
    this.ensureDirectories();
  }

  /**
   * Get current configuration
   */
  getConfig(): StorageConfig {
    return { ...this.config };
  }

  /**
   * Get L1 database (for testing/debugging)
   */
  getL1Database(): Database.Database | null {
    return this.l1Database;
  }

  /**
   * Close L1 database connection
   */
  closeL1Database(): void {
    if (this.l1Database) {
      try {
        // Close all prepared statements before closing the database
        // This ensures no pending queries keep the connection alive
        this.l1Database.prepare('PRAGMA optimize').run();
        // Close the database connection
        this.l1Database.close();
      } catch {
        // Ignore errors when closing (connection may already be closed)
      } finally {
        this.l1Database = null;
        this.l1Initialized = false;
      }
    }
  }
}

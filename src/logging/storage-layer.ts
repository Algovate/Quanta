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
import type { OperationLog, SystemSnapshot, AggregatedError, MetricsSnapshot } from './types.js';
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

  // L1: SQLite database (recent cycles)
  private l1Database: any; // SQLite database instance (for future use)
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

    // For now, use simple JSON file storage (SQLite can be added later)
    // Store operations by cycle ID
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
    // TODO: Initialize SQLite database if needed
    // For now, use file-based storage
    this.l1Initialized = true;
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
   * Get operations from L0 (in-memory)
   */
  getOperationsFromL0(count: number = 100): OperationLog[] {
    return this.l0Cache.slice(-count);
  }

  /**
   * Get operations by cycle ID
   */
  async getOperationsByCycle(cycleId: number): Promise<OperationLog[]> {
    // First check L0
    const l0Ops = this.l0Cache.filter(op => op.cycleId === cycleId);

    // Then check L1/L2
    const cycleDir = path.join(this.config.l2Directory, `cycle-${cycleId}`);
    if (!fs.existsSync(cycleDir)) {
      return l0Ops;
    }

    const files = await fs.promises.readdir(cycleDir);
    const operations: OperationLog[] = [];

    for (const file of files) {
      if (file.endsWith('.json')) {
        const filePath = path.join(cycleDir, file);
        const content = await fs.promises.readFile(filePath, 'utf-8');
        operations.push(JSON.parse(content));
      }
    }

    // Combine L0 and L1/L2 operations
    const allOps = [...l0Ops, ...operations];

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
   * Get operations in time range
   */
  async getOperationsInTimeRange(startTime: number, endTime: number): Promise<OperationLog[]> {
    // Get from L0
    const l0Ops = this.l0Cache.filter(op => op.startTime >= startTime && op.startTime <= endTime);

    // TODO: Query L1/L2 for additional operations
    // For now, return L0 operations
    return l0Ops;
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
    // List all cycle directories
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

    return {
      l0Size: this.l0Cache.length,
      l1Cycles: 0, // TODO: Count from database when implemented
      l2Cycles,
      l3Cycles,
      totalOperations: this.l0Cache.length,
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
   * Get L1 database (for future use)
   */
  getL1Database(): any {
    return this.l1Database;
  }
}

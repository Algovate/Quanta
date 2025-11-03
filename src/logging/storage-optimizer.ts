/**
 * Storage Optimizer - Optimizes log storage performance
 *
 * Features:
 * - Batch writes
 * - Compression optimization
 * - Background archiving
 * - Indexing for faster queries
 */

import { StorageLayer } from './storage-layer.js';
import type { OperationLog, SystemSnapshot } from './types.js';

interface BatchWriteBuffer {
  operations: OperationLog[];
  snapshots: SystemSnapshot[];
  lastFlush: number;
  maxBufferSize: number;
  flushInterval: number;
}

export class StorageOptimizer {
  private static instance: StorageOptimizer;
  
  // Store original console methods to avoid recursion when console interception is enabled
  private originalConsole: {
    log: typeof console.log;
    warn: typeof console.warn;
    error: typeof console.error;
  };
  private storageLayer: StorageLayer;
  private batchBuffer: BatchWriteBuffer;
  private flushInterval?: NodeJS.Timeout;
  private started: boolean = false;

  private constructor() {
    // Store original console methods to avoid infinite recursion
    // when UnifiedLogger intercepts console calls
    this.originalConsole = {
      log: console.log.bind(console),
      warn: console.warn.bind(console),
      error: console.error.bind(console),
    };
    this.storageLayer = StorageLayer.getInstance();
    this.batchBuffer = {
      operations: [],
      snapshots: [],
      lastFlush: Date.now(),
      maxBufferSize: 100, // Flush when buffer reaches 100 items
      flushInterval: 5000, // Flush every 5 seconds
    };
    // Do NOT start background flush in constructor - start lazily when first operation is queued
    // This prevents keeping the process alive when logger instance is created but not initialized
  }

  static getInstance(): StorageOptimizer {
    if (!StorageOptimizer.instance) {
      StorageOptimizer.instance = new StorageOptimizer();
    }
    return StorageOptimizer.instance;
  }

  /**
   * Queue operation for batch write
   */
  queueOperation(operation: OperationLog): void {
    // Start background flush on first operation if not already started
    if (!this.started) {
      this.startBackgroundFlush();
      this.started = true;
    }

    this.batchBuffer.operations.push(operation);

    // Flush if buffer is full
    if (this.batchBuffer.operations.length >= this.batchBuffer.maxBufferSize) {
      this.flush();
    }
  }

  /**
   * Queue snapshot for batch write
   */
  queueSnapshot(snapshot: SystemSnapshot): void {
    // Start background flush on first snapshot if not already started
    if (!this.started) {
      this.startBackgroundFlush();
      this.started = true;
    }

    this.batchBuffer.snapshots.push(snapshot);

    // Snapshots are typically less frequent, flush immediately
    if (this.batchBuffer.snapshots.length >= 10) {
      this.flush();
    }
  }

  /**
   * Flush all buffered writes
   */
  async flush(): Promise<void> {
    if (this.batchBuffer.operations.length === 0 && this.batchBuffer.snapshots.length === 0) {
      return;
    }

    const operations = [...this.batchBuffer.operations];
    const snapshots = [...this.batchBuffer.snapshots];

    // Clear buffer
    this.batchBuffer.operations = [];
    this.batchBuffer.snapshots = [];
    this.batchBuffer.lastFlush = Date.now();

    // Write operations in batch
    if (operations.length > 0) {
      await Promise.all(operations.map(op => this.storageLayer.storeOperation(op)));
    }

    // Write snapshots in batch
    if (snapshots.length > 0) {
      await Promise.all(snapshots.map(snap => this.storageLayer.storeSnapshot(snap)));
    }
  }

  /**
   * Start background flush interval
   */
  private startBackgroundFlush(): void {
    this.flushInterval = setInterval(() => {
      this.flush().catch(err => {
        // Use originalConsole to avoid triggering console interception
        this.originalConsole.error('Error flushing storage buffer:', err);
      });
    }, this.batchBuffer.flushInterval);
  }

  /**
   * Stop background flush
   */
  stop(): void {
    if (this.flushInterval) {
      clearInterval(this.flushInterval);
      this.flushInterval = undefined;
    }
    this.started = false;
    // Flush remaining items (fire and forget)
    this.flush().catch(err => {
      // Use originalConsole to avoid triggering console interception
      this.originalConsole.error('Error flushing storage on stop:', err);
    });
  }

  /**
   * Update buffer configuration
   */
  updateConfig(maxBufferSize?: number, flushInterval?: number): void {
    if (maxBufferSize !== undefined) {
      this.batchBuffer.maxBufferSize = maxBufferSize;
    }
    if (flushInterval !== undefined) {
      this.batchBuffer.flushInterval = flushInterval;
      // Restart interval with new timing
      if (this.flushInterval) {
        clearInterval(this.flushInterval);
        this.startBackgroundFlush();
      }
    }
  }

  /**
   * Get buffer statistics
   */
  getBufferStats(): {
    operationCount: number;
    snapshotCount: number;
    timeSinceLastFlush: number;
  } {
    return {
      operationCount: this.batchBuffer.operations.length,
      snapshotCount: this.batchBuffer.snapshots.length,
      timeSinceLastFlush: Date.now() - this.batchBuffer.lastFlush,
    };
  }
}

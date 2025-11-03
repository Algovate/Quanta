/**
 * Storage Layer - Handles persistent storage of logs
 *
 * This module provides storage capabilities for operation logs.
 * Currently implemented as a minimal interface.
 */

import type { OperationLog } from './types.js';

export class StorageLayer {
  private static instance: StorageLayer;
  private operations: OperationLog[] = [];
  private maxOperations: number = 1000;

  private constructor() {}

  static getInstance(): StorageLayer {
    if (!StorageLayer.instance) {
      StorageLayer.instance = new StorageLayer();
    }
    return StorageLayer.instance;
  }

  /**
   * Store an operation log
   */
  async storeOperation(operation: OperationLog): Promise<void> {
    this.operations.push(operation);

    // Limit storage size
    if (this.operations.length > this.maxOperations) {
      this.operations.shift();
    }
  }

  /**
   * Store multiple operations
   */
  async storeOperations(operations: OperationLog[]): Promise<void> {
    for (const op of operations) {
      await this.storeOperation(op);
    }
  }

  /**
   * Get stored operations
   */
  getOperations(limit?: number): OperationLog[] {
    if (limit && limit < this.operations.length) {
      return this.operations.slice(-limit);
    }
    return [...this.operations];
  }

  /**
   * Get operations from L0 tier
   */
  async getOperationsFromL0(limit?: number): Promise<OperationLog[]> {
    return Promise.resolve(this.getOperations(limit));
  }

  /**
   * Get operations from L1 tier (SQLite)
   */
  async getOperationsFromL1(_query: { cycleId?: number; limit?: number }): Promise<OperationLog[]> {
    // Simplified implementation - in real system this would query SQLite
    return Promise.resolve([]);
  }

  /**
   * Get L1 operation count
   */
  async getL1OperationCount(_query: { cycleId?: number }): Promise<number> {
    return Promise.resolve(0);
  }

  /**
   * Get L1 cycle IDs
   */
  async getL1CycleIds(): Promise<number[]> {
    return Promise.resolve([]);
  }

  /**
   * Get operations by cycle
   */
  async getOperationsByCycle(cycleId: number): Promise<OperationLog[]> {
    return this.getOperations().filter(op => op.cycleId === cycleId);
  }

  /**
   * Get storage stats
   */
  async getStats(): Promise<{ l0Size: number; l1Cycles: number; totalOperations: number }> {
    return Promise.resolve({
      l0Size: this.operations.length,
      l1Cycles: 0,
      totalOperations: this.operations.length,
    });
  }

  /**
   * Query operations
   */
  queryOperations(query: (op: OperationLog) => boolean): OperationLog[] {
    return this.operations.filter(query);
  }

  /**
   * Clear all operations
   */
  clearOperations(): void {
    this.operations = [];
  }

  /**
   * Set max operations
   */
  setMaxOperations(max: number): void {
    this.maxOperations = max;
  }
}

/**
 * Query Interface - Efficient log querying and analysis
 *
 * Features:
 * - Time-based queries
 * - Filter by operation type, status, symbol
 * - Search by message content
 * - Aggregate statistics
 * - Trace reconstruction
 */

import { StorageLayer } from './storage-layer.js';
import type { OperationLog, SystemSnapshot } from './types.js';

export interface QueryOptions {
  startTime?: number;
  endTime?: number;
  cycleId?: number;
  operationType?: string;
  status?: 'running' | 'completed' | 'failed' | 'cancelled';
  symbol?: string;
  traceId?: string;
  operationId?: string;
  messageContains?: string;
  limit?: number;
  offset?: number;
  sortBy?: 'startTime' | 'endTime' | 'duration';
  sortOrder?: 'asc' | 'desc';
}

export interface QueryResult {
  operations: OperationLog[];
  total: number;
  hasMore: boolean;
}

export interface TraceResult {
  traceId: string;
  cycleId: number;
  operations: OperationLog[];
  rootOperation?: OperationLog;
  duration?: number;
  status: 'completed' | 'failed' | 'in_progress';
}

export interface Statistics {
  totalOperations: number;
  completedOperations: number;
  failedOperations: number;
  averageDuration: number;
  minDuration: number;
  maxDuration: number;
  operationTypes: Record<string, number>;
  errorRate: number;
  byStatus: Record<string, number>;
}

export class QueryInterface {
  private static instance: QueryInterface;
  private storageLayer: StorageLayer;
  private cache: Map<string, { result: QueryResult; timestamp: number }> = new Map();
  private cacheTTL: number = 60000; // 1 minute

  private constructor() {
    this.storageLayer = StorageLayer.getInstance();
  }

  static getInstance(): QueryInterface {
    if (!QueryInterface.instance) {
      QueryInterface.instance = new QueryInterface();
    }
    return QueryInterface.instance;
  }

  /**
   * Query operations with filters
   */
  async queryOperations(options: QueryOptions = {}): Promise<QueryResult> {
    const cacheKey = this.generateCacheKey(options);
    const cached = this.cache.get(cacheKey);
    if (cached && Date.now() - cached.timestamp < this.cacheTTL) {
      return cached.result;
    }

    // Get from L0 cache first
    let operations = this.storageLayer.getOperationsFromL0(10000);

    // Get from L1 database
    const l1Options: {
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
    } = {};

    if (options.cycleId !== undefined) {
      l1Options.cycleId = options.cycleId;
    }
    if (options.traceId) {
      l1Options.traceId = options.traceId;
    }
    if (options.operationId) {
      l1Options.operationId = options.operationId;
    }
    if (options.operationType) {
      l1Options.operationType = options.operationType;
    }
    if (options.status) {
      l1Options.status = options.status;
    }
    if (options.symbol) {
      l1Options.symbol = options.symbol;
    }
    if (options.startTime !== undefined) {
      l1Options.startTime = options.startTime;
    }
    if (options.endTime !== undefined) {
      l1Options.endTime = options.endTime;
    }

    // Get more from L1 if needed (but don't use offset/limit here as we'll handle pagination later)
    const l1Ops = await this.storageLayer.getOperationsFromL1({
      ...l1Options,
      limit: 10000, // Get a large batch
    });

    // Combine L0 and L1, deduplicate by operationId
    const opsMap = new Map<string, OperationLog>();
    for (const op of operations) {
      opsMap.set(op.operationId, op);
    }
    for (const op of l1Ops) {
      if (!opsMap.has(op.operationId)) {
        opsMap.set(op.operationId, op);
      }
    }

    operations = Array.from(opsMap.values());

    // Apply filters
    if (options.startTime) {
      operations = operations.filter(op => op.startTime >= options.startTime!);
    }
    if (options.endTime) {
      operations = operations.filter(op => op.startTime <= options.endTime!);
    }
    if (options.cycleId !== undefined) {
      operations = operations.filter(op => op.cycleId === options.cycleId);
    }
    if (options.operationType) {
      operations = operations.filter(op => op.operationType === options.operationType);
    }
    if (options.status) {
      operations = operations.filter(op => op.status === options.status);
    }
    if (options.symbol) {
      operations = operations.filter(op => op.symbol === options.symbol);
    }
    if (options.traceId) {
      // Support partial match for trace ID
      operations = operations.filter(
        op => op.traceId === options.traceId || op.traceId.startsWith(options.traceId)
      );
    }
    if (options.operationId) {
      // Support partial match for operation ID
      operations = operations.filter(
        op =>
          op.operationId === options.operationId || op.operationId.startsWith(options.operationId)
      );
    }

    // Sort
    const sortBy = options.sortBy || 'startTime';
    const sortOrder = options.sortOrder || 'desc';
    operations.sort((a, b) => {
      let aVal: number, bVal: number;
      if (sortBy === 'duration') {
        aVal = a.endTime && a.startTime ? a.endTime - a.startTime : 0;
        bVal = b.endTime && b.startTime ? b.endTime - b.startTime : 0;
      } else if (sortBy === 'startTime') {
        aVal = a.startTime;
        bVal = b.startTime;
      } else {
        aVal = a.endTime || a.startTime;
        bVal = b.endTime || b.startTime;
      }
      return sortOrder === 'asc' ? aVal - bVal : bVal - aVal;
    });

    // Pagination
    const offset = options.offset ?? 0;
    const limit = options.limit ?? 100;
    const total = operations.length;
    // Create a new array for pagination to avoid modifying the original
    const paginated = operations.slice(offset, offset + limit);
    const hasMore = offset + limit < total;

    const result: QueryResult = {
      operations: paginated,
      total,
      hasMore,
    };

    // Cache result
    this.cache.set(cacheKey, { result, timestamp: Date.now() });

    return result;
  }

  /**
   * Get complete trace by trace ID
   */
  async getTrace(traceId: string): Promise<TraceResult | null> {
    const operations = await this.queryOperations({ traceId, limit: 1000 });

    if (operations.operations.length === 0) {
      return null;
    }

    const rootOperation = operations.operations.find(op => !op.parentOperationId);
    const allOps = operations.operations;
    const cycleId = rootOperation?.cycleId || allOps[0]?.cycleId || 0;

    // Calculate total duration
    const startTimes = allOps.map(op => op.startTime);
    const endTimes = allOps.map(op => op.endTime || op.startTime).filter(t => t > 0);
    const duration =
      endTimes.length > 0 && startTimes.length > 0
        ? Math.max(...endTimes) - Math.min(...startTimes)
        : undefined;

    // Determine overall status
    const hasFailed = allOps.some(op => op.status === 'failed');
    const allCompleted = allOps.every(op => op.status === 'completed' || op.status === 'cancelled');
    const status: 'completed' | 'failed' | 'in_progress' = hasFailed
      ? 'failed'
      : allCompleted
        ? 'completed'
        : 'in_progress';

    return {
      traceId,
      cycleId,
      operations: allOps,
      rootOperation,
      duration,
      status,
    };
  }

  /**
   * Get operations by cycle ID
   */
  async getOperationsByCycle(cycleId: number): Promise<OperationLog[]> {
    const result = await this.queryOperations({
      cycleId,
      sortBy: 'startTime',
      sortOrder: 'asc',
      limit: 10000,
    });
    return result.operations;
  }

  /**
   * Get statistics for operations
   */
  async getStatistics(options: QueryOptions = {}): Promise<Statistics> {
    const result = await this.queryOperations({ ...options, limit: 10000 });
    const operations = result.operations;

    const totalOperations = operations.length;
    const completedOperations = operations.filter(op => op.status === 'completed').length;
    const failedOperations = operations.filter(op => op.status === 'failed').length;

    const durations = operations
      .map(op => {
        if (op.endTime && op.startTime) {
          return op.endTime - op.startTime;
        }
        return 0;
      })
      .filter(d => d > 0);

    const averageDuration =
      durations.length > 0 ? durations.reduce((a, b) => a + b, 0) / durations.length : 0;
    const minDuration = durations.length > 0 ? Math.min(...durations) : 0;
    const maxDuration = durations.length > 0 ? Math.max(...durations) : 0;

    const operationTypes: Record<string, number> = {};
    for (const op of operations) {
      operationTypes[op.operationType] = (operationTypes[op.operationType] || 0) + 1;
    }

    const errorRate = totalOperations > 0 ? failedOperations / totalOperations : 0;

    const byStatus: Record<string, number> = {};
    for (const op of operations) {
      byStatus[op.status] = (byStatus[op.status] || 0) + 1;
    }

    return {
      totalOperations,
      completedOperations,
      failedOperations,
      averageDuration,
      minDuration,
      maxDuration,
      operationTypes,
      errorRate,
      byStatus,
    };
  }

  /**
   * Find operations that contain a specific message or error
   */
  async searchOperations(
    searchTerm: string,
    options: Omit<QueryOptions, 'messageContains'> = {}
  ): Promise<QueryResult> {
    const result = await this.queryOperations(options);
    const searchLower = searchTerm.toLowerCase();

    const filtered = result.operations.filter(op => {
      // Search in operation type
      if (op.operationType.toLowerCase().includes(searchLower)) {
        return true;
      }

      // Search in symbol
      if (op.symbol && op.symbol.toLowerCase().includes(searchLower)) {
        return true;
      }

      // Search in error message
      if (op.error && op.error.message.toLowerCase().includes(searchLower)) {
        return true;
      }

      // Search in input/output
      const inputStr = JSON.stringify(op.input).toLowerCase();
      const outputStr = op.output ? JSON.stringify(op.output).toLowerCase() : '';
      if (inputStr.includes(searchLower) || outputStr.includes(searchLower)) {
        return true;
      }

      return false;
    });

    return {
      operations: filtered,
      total: filtered.length,
      hasMore: false,
    };
  }

  /**
   * Get snapshots in time range
   */
  async getSnapshotsInRange(_startTime: number, _endTime: number): Promise<SystemSnapshot[]> {
    // TODO: Implement snapshot query from storage
    // For now, return empty array
    return [];
  }

  /**
   * Get latest snapshot
   */
  async getLatestSnapshot(): Promise<SystemSnapshot | null> {
    // TODO: Implement latest snapshot query
    // For now, return null
    return null;
  }

  /**
   * Clear query cache
   */
  clearCache(): void {
    this.cache.clear();
  }

  /**
   * Generate cache key from query options
   */
  private generateCacheKey(options: QueryOptions): string {
    return JSON.stringify(options);
  }
}

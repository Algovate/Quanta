/**
 * Cache statistics and monitoring module
 * Tracks hit rates, evictions, performance metrics
 */

export interface CacheStats {
  hits: number;
  misses: number;
  evictions: number;
  sets: number;
  totalAccessTime: number; // Total time spent on cache operations (ms)
  accessCount: number; // Number of cache accesses
  lastAccessTime?: number; // Timestamp of last access
  lastEvictionTime?: number; // Timestamp of last eviction
}

export interface CachePerformanceMetrics {
  hitRate: number; // Percentage of hits
  missRate: number; // Percentage of misses
  averageAccessTime: number; // Average time per cache operation (ms)
  evictionRate: number; // Evictions per operation
  size: number; // Current cache size
  stats: CacheStats;
}

/**
 * Cache statistics tracker
 * Thread-safe statistics collection for cache performance monitoring
 */
export class CacheStatistics {
  private stats: CacheStats = {
    hits: 0,
    misses: 0,
    evictions: 0,
    sets: 0,
    totalAccessTime: 0,
    accessCount: 0,
  };

  /**
   * Record a cache hit
   * @param accessTime - Time taken for the cache operation (ms)
   */
  recordHit(accessTime: number = 0): void {
    this.stats.hits++;
    this.stats.accessCount++;
    this.stats.totalAccessTime += accessTime;
    this.stats.lastAccessTime = Date.now();
  }

  /**
   * Record a cache miss
   * @param accessTime - Time taken for the cache operation (ms)
   */
  recordMiss(accessTime: number = 0): void {
    this.stats.misses++;
    this.stats.accessCount++;
    this.stats.totalAccessTime += accessTime;
    this.stats.lastAccessTime = Date.now();
  }

  /**
   * Record a cache set operation
   */
  recordSet(): void {
    this.stats.sets++;
  }

  /**
   * Record a cache eviction
   */
  recordEviction(): void {
    this.stats.evictions++;
    this.stats.lastEvictionTime = Date.now();
  }

  /**
   * Get current statistics
   */
  getStats(): Readonly<CacheStats> {
    return { ...this.stats };
  }

  /**
   * Get performance metrics
   * @param currentSize - Current cache size
   */
  getMetrics(currentSize: number): CachePerformanceMetrics {
    const total = this.stats.hits + this.stats.misses;
    const hitRate = total > 0 ? (this.stats.hits / total) * 100 : 0;
    const missRate = total > 0 ? (this.stats.misses / total) * 100 : 0;
    const averageAccessTime =
      this.stats.accessCount > 0 ? this.stats.totalAccessTime / this.stats.accessCount : 0;
    const evictionRate =
      this.stats.accessCount > 0 ? this.stats.evictions / this.stats.accessCount : 0;

    return {
      hitRate,
      missRate,
      averageAccessTime,
      evictionRate,
      size: currentSize,
      stats: { ...this.stats },
    };
  }

  /**
   * Reset all statistics
   */
  reset(): void {
    this.stats = {
      hits: 0,
      misses: 0,
      evictions: 0,
      sets: 0,
      totalAccessTime: 0,
      accessCount: 0,
    };
  }

  /**
   * Merge statistics from another tracker
   * Useful for aggregating stats from multiple cache instances
   */
  merge(other: CacheStatistics): void {
    const otherStats = other.getStats();
    this.stats.hits += otherStats.hits;
    this.stats.misses += otherStats.misses;
    this.stats.evictions += otherStats.evictions;
    this.stats.sets += otherStats.sets;
    this.stats.totalAccessTime += otherStats.totalAccessTime;
    this.stats.accessCount += otherStats.accessCount;
  }
}

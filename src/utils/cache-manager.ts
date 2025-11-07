import { CacheStatistics, type CachePerformanceMetrics } from './cache-stats.js';

/**
 * Cache entry with metadata for strategy selection
 */
interface CacheEntry<T> {
  value: T;
  timestamp: number; // Creation time
  lastAccess: number; // Last access time (for LRU)
  accessCount: number; // Access frequency (for LFU)
  ttl?: number; // Time to live in milliseconds
}

/**
 * Cache strategy type
 */
export type CacheStrategy = 'lru' | 'lfu' | 'ttl' | 'hybrid';

/**
 * Options for cache manager
 */
export interface CacheManagerOptions {
  maxSize?: number; // Maximum number of entries
  defaultTTL?: number; // Default TTL in milliseconds
  strategy?: CacheStrategy; // Cache strategy
  enableStatistics?: boolean; // Enable statistics tracking
}

/**
 * Unified cache manager with LRU/LFU/TTL hybrid strategy
 * Automatically selects optimal strategy based on access patterns
 */
export class CacheManager<T> {
  private cache: Map<string, CacheEntry<T>> = new Map();
  private readonly maxSize: number;
  private readonly defaultTTL?: number;
  private strategy: CacheStrategy;
  private readonly statistics: CacheStatistics;
  private readonly enableStatistics: boolean;

  // Strategy selection thresholds
  private readonly LRU_THRESHOLD = 0.7; // Use LRU if recency score > 0.7
  private readonly LFU_THRESHOLD = 0.3; // Use LFU if frequency score > 0.3

  constructor(options: CacheManagerOptions = {}) {
    this.maxSize = options.maxSize ?? 1000;
    this.defaultTTL = options.defaultTTL;
    this.strategy = options.strategy ?? 'hybrid';
    this.enableStatistics = options.enableStatistics ?? true;
    this.statistics = new CacheStatistics();
  }

  /**
   * Check if entry is expired
   */
  private isExpired(entry: CacheEntry<T>): boolean {
    return entry.ttl !== undefined && Date.now() - entry.timestamp > entry.ttl;
  }

  /**
   * Get value from cache
   * @param key - Cache key
   * @returns Cached value or undefined if not found/expired
   */
  get(key: string): T | undefined {
    const startTime = this.enableStatistics ? performance.now() : 0;

    const entry = this.cache.get(key);

    if (!entry) {
      if (this.enableStatistics) {
        const accessTime = performance.now() - startTime;
        this.statistics.recordMiss(accessTime);
      }
      return undefined;
    }

    // Check TTL expiration
    if (this.isExpired(entry)) {
      this.cache.delete(key);
      if (this.enableStatistics) {
        const accessTime = performance.now() - startTime;
        this.statistics.recordMiss(accessTime);
      }
      return undefined;
    }

    // Update access metadata
    entry.lastAccess = Date.now();
    entry.accessCount++;

    if (this.enableStatistics) {
      const accessTime = performance.now() - startTime;
      this.statistics.recordHit(accessTime);
    }

    return entry.value;
  }

  /**
   * Set value in cache
   * @param key - Cache key
   * @param value - Value to cache
   * @param ttl - Optional TTL override (ms)
   */
  set(key: string, value: T, ttl?: number): void {
    const now = Date.now();

    // Check if we need to evict entries
    if (this.cache.size >= this.maxSize && !this.cache.has(key)) {
      this.evict();
    }

    const entry: CacheEntry<T> = {
      value,
      timestamp: now,
      lastAccess: now,
      accessCount: 1,
      ttl: ttl ?? this.defaultTTL,
    };

    this.cache.set(key, entry);

    if (this.enableStatistics) {
      this.statistics.recordSet();
    }
  }

  /**
   * Check if key exists in cache (without updating access metadata)
   * @param key - Cache key
   * @returns True if key exists and is not expired
   */
  has(key: string): boolean {
    const entry = this.cache.get(key);
    if (!entry) {
      return false;
    }

    // Check TTL expiration
    if (this.isExpired(entry)) {
      this.cache.delete(key);
      return false;
    }

    return true;
  }

  /**
   * Delete entry from cache
   * @param key - Cache key
   * @returns True if entry was deleted
   */
  delete(key: string): boolean {
    return this.cache.delete(key);
  }

  /**
   * Clear all cache entries
   */
  clear(): void {
    this.cache.clear();
  }

  /**
   * Get current cache size
   */
  size(): number {
    return this.cache.size;
  }

  /**
   * Evict entries based on selected strategy
   */
  private evict(): void {
    if (this.cache.size === 0) {
      return;
    }

    // Determine strategy to use
    const effectiveStrategy = this.determineStrategy();

    let entriesToEvict: string[] = [];

    switch (effectiveStrategy) {
      case 'lru':
        entriesToEvict = this.evictLRU();
        break;
      case 'lfu':
        entriesToEvict = this.evictLFU();
        break;
      case 'ttl':
        entriesToEvict = this.evictTTL();
        break;
      case 'hybrid':
        entriesToEvict = this.evictHybrid();
        break;
    }

    // Evict entries (evict up to 10% of cache or at least 1)
    const evictCount = Math.max(1, Math.floor(this.cache.size * 0.1));
    for (let i = 0; i < Math.min(evictCount, entriesToEvict.length); i++) {
      this.cache.delete(entriesToEvict[i]);
      if (this.enableStatistics) {
        this.statistics.recordEviction();
      }
    }
  }

  /**
   * Evict least recently used entries
   */
  private evictLRU(): string[] {
    const entries = Array.from(this.cache.entries());
    entries.sort((a, b) => a[1].lastAccess - b[1].lastAccess);
    return entries.map(e => e[0]);
  }

  /**
   * Evict least frequently used entries
   */
  private evictLFU(): string[] {
    const entries = Array.from(this.cache.entries());
    entries.sort((a, b) => a[1].accessCount - b[1].accessCount);
    return entries.map(e => e[0]);
  }

  /**
   * Evict entries closest to expiration
   */
  private evictTTL(): string[] {
    const entries = Array.from(this.cache.entries()).filter(e => e[1].ttl);
    if (entries.length === 0) {
      // Fallback to LRU if no TTL entries
      return this.evictLRU();
    }
    entries.sort((a, b) => {
      const aExpiry = a[1].timestamp + (a[1].ttl ?? 0);
      const bExpiry = b[1].timestamp + (b[1].ttl ?? 0);
      return aExpiry - bExpiry;
    });
    return entries.map(e => e[0]);
  }

  /**
   * Calculate access pattern metrics for strategy determination
   */
  private calculateAccessMetrics(entries: CacheEntry<T>[]): {
    maxAge: number;
    maxFreq: number;
    avgRecencyScore: number;
    avgFrequencyScore: number;
  } {
    if (entries.length === 0) {
      return { maxAge: 1, maxFreq: 1, avgRecencyScore: 0, avgFrequencyScore: 0 };
    }

    const now = Date.now();
    const maxAge = Math.max(...entries.map(e => now - e.lastAccess), 1);
    const maxFreq = Math.max(...entries.map(e => e.accessCount), 1);

    let totalRecencyScore = 0;
    let totalFrequencyScore = 0;

    entries.forEach(entry => {
      const recencyScore = (now - entry.lastAccess) / maxAge;
      const frequencyScore = entry.accessCount / maxFreq;
      totalRecencyScore += recencyScore;
      totalFrequencyScore += frequencyScore;
    });

    return {
      maxAge,
      maxFreq,
      avgRecencyScore: totalRecencyScore / entries.length,
      avgFrequencyScore: totalFrequencyScore / entries.length,
    };
  }

  /**
   * Evict using hybrid strategy (combines LRU and LFU)
   */
  private evictHybrid(): string[] {
    const entries = Array.from(this.cache.entries());
    const metrics = this.calculateAccessMetrics(entries.map(e => e[1]));

    // Score: lower is better (more likely to evict)
    // Combine recency (LRU) and frequency (LFU) with equal weight
    entries.forEach(entry => {
      const recencyScore = (Date.now() - entry[1].lastAccess) / metrics.maxAge; // Higher = older
      const frequencyScore = 1 - entry[1].accessCount / metrics.maxFreq; // Higher = less frequent
      const combinedScore = (recencyScore + frequencyScore) / 2;
      // Store score temporarily (we'll sort by it)
      (entry[1] as CacheEntry<T> & { _score?: number })._score = combinedScore;
    });

    entries.sort((a, b) => {
      const scoreA = (a[1] as CacheEntry<T> & { _score?: number })._score ?? 0;
      const scoreB = (b[1] as CacheEntry<T> & { _score?: number })._score ?? 0;
      return scoreB - scoreA; // Higher score = evict first
    });

    return entries.map(e => e[0]);
  }

  /**
   * Determine optimal strategy based on access patterns
   */
  private determineStrategy(): CacheStrategy {
    if (this.strategy !== 'hybrid') {
      return this.strategy;
    }

    const entries = Array.from(this.cache.values());
    if (entries.length === 0) {
      return 'lru'; // Default
    }

    const metrics = this.calculateAccessMetrics(entries);

    // Select strategy based on patterns
    if (metrics.avgRecencyScore > this.LRU_THRESHOLD) {
      return 'lru'; // Strong recency pattern
    } else if (metrics.avgFrequencyScore > this.LFU_THRESHOLD) {
      return 'lfu'; // Strong frequency pattern
    } else {
      return 'hybrid'; // Balanced pattern
    }
  }

  /**
   * Clean up expired entries
   * Should be called periodically
   */
  cleanup(): number {
    let cleaned = 0;

    for (const [key, entry] of this.cache.entries()) {
      if (this.isExpired(entry)) {
        this.cache.delete(key);
        cleaned++;
      }
    }

    return cleaned;
  }

  /**
   * Get cache statistics
   */
  getStatistics(): CachePerformanceMetrics | null {
    if (!this.enableStatistics) {
      return null;
    }
    return this.statistics.getMetrics(this.cache.size);
  }

  /**
   * Get raw statistics
   */
  getRawStatistics() {
    if (!this.enableStatistics) {
      return null;
    }
    return this.statistics.getStats();
  }

  /**
   * Reset statistics
   */
  resetStatistics(): void {
    if (this.enableStatistics) {
      this.statistics.reset();
    }
  }
}

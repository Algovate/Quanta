/**
 * Request deduplication utility for preventing duplicate API calls
 * Tracks in-flight requests and shares results between concurrent requests
 */
export class RequestDeduplicator<T> {
  private inFlightRequests = new Map<string, Promise<T>>();

  /**
   * Execute a request with deduplication
   * If a request for the same key is already in flight, returns the existing promise
   * Otherwise, creates a new request and tracks it
   */
  async execute(key: string, requestFn: () => Promise<T>): Promise<T> {
    let promise = this.inFlightRequests.get(key);
    if (!promise) {
      // Create new request and track it
      promise = requestFn();
      this.inFlightRequests.set(key, promise);

      // Clean up after request completes (success or failure)
      promise
        .then(() => {
          this.inFlightRequests.delete(key);
        })
        .catch(() => {
          this.inFlightRequests.delete(key);
        });
    }

    // Wait for in-flight request (or new one if we created it)
    return promise;
  }

  /**
   * Clear all in-flight requests (useful for cleanup)
   */
  clear(): void {
    this.inFlightRequests.clear();
  }

  /**
   * Get count of in-flight requests
   */
  size(): number {
    return this.inFlightRequests.size;
  }
}

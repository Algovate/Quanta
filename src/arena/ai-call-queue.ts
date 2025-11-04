/**
 * AI Call Queue - Rate limiting for concurrent AI calls across drones
 *
 * Manages API call concurrency to prevent rate limit violations when
 * multiple drones need AI service simultaneously.
 */

export class AICallQueue {
  private queue: Array<{
    fn: () => Promise<any>;
    resolve: (value: any) => void;
    reject: (error: any) => void;
  }> = [];
  private activeCount = 0;

  constructor(private maxConcurrent: number = 2) {
    if (maxConcurrent < 1) {
      throw new Error('AICallQueue maxConcurrent must be at least 1');
    }
  }

  /**
   * Enqueue an AI call function for execution
   * @param fn - Async function that makes the AI API call
   * @returns Promise that resolves with the result
   */
  async enqueue<T>(fn: () => Promise<T>): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      this.queue.push({ fn, resolve, reject });
      this.processNext();
    });
  }

  /**
   * Process the next item in the queue if under concurrency limit
   * @private
   */
  private async processNext(): Promise<void> {
    if (this.activeCount >= this.maxConcurrent || this.queue.length === 0) {
      return;
    }

    const { fn, resolve, reject } = this.queue.shift()!;
    this.activeCount++;

    try {
      const result = await fn();
      resolve(result);
    } catch (err) {
      reject(err);
    } finally {
      this.activeCount--;
      this.processNext();
    }
  }

  /**
   * Get current queue statistics
   */
  getStats(): {
    queueLength: number;
    activeCount: number;
    maxConcurrent: number;
  } {
    return {
      queueLength: this.queue.length,
      activeCount: this.activeCount,
      maxConcurrent: this.maxConcurrent,
    };
  }

  /**
   * Clear the queue (cancel all pending requests)
   */
  clear(): void {
    while (this.queue.length > 0) {
      const { reject } = this.queue.shift()!;
      reject(new Error('AICallQueue cleared'));
    }
  }
}

/**
 * Simple semaphore-based rate limiter.
 *
 * Ensures at most `maxConcurrency` async operations run in parallel.
 * All operations share the same semaphore regardless of caller.
 */
export class RateLimiter {
  private maxConcurrency: number;
  private active = 0;
  private queue: Array<() => void> = [];

  /** Total operations that have acquired a slot */
  totalAcquired = 0;
  /** Total operations that were rejected (non-transient errors) */
  totalRejected = 0;

  constructor(maxConcurrency: number) {
    if (maxConcurrency < 1) {
      throw new Error("maxConcurrency must be at least 1");
    }
    this.maxConcurrency = maxConcurrency;
  }

  /**
   * Acquires a semaphore slot, runs `fn`, then releases the slot.
   * @returns The result of `fn`.
   */
  async run<T>(fn: () => Promise<T>): Promise<T> {
    await this.acquire();
    this.totalAcquired++;
    try {
      return await fn();
    } catch (error) {
      this.totalRejected++;
      throw error;
    } finally {
      this.release();
    }
  }

  private acquire(): Promise<void> {
    if (this.active < this.maxConcurrency) {
      this.active++;
      return Promise.resolve();
    }
    return new Promise<void>((resolve) => {
      this.queue.push(() => {
        this.active++;
        resolve();
      });
    });
  }

  private release(): void {
    const next = this.queue.shift();
    if (next) {
      next();
    } else {
      this.active--;
    }
  }
}

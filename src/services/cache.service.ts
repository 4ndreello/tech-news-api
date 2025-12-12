import { singleton } from "tsyringe";
import type { CacheEntry } from "../types";
import { CacheKey } from "../types";

@singleton()
export class CacheService {
  private cache: Record<string, CacheEntry<any>> = {};
  private readonly CACHE_DURATION = 5 * 60 * 1000; // 5 minutes
  private readonly HIGHLIGHTS_CACHE_DURATION = 30 * 60 * 1000; // 30 minutes

  get<T>(key: string): T | null {
    const entry = this.cache[key];
    if (!entry) return null;

    const duration = this.getCacheDuration(key);
    const isExpired = Date.now() - entry.timestamp > duration;
    if (isExpired) {
      delete this.cache[key];
      return null;
    }

    return entry.data;
  }

  set<T>(key: string, data: T): void {
    this.cache[key] = {
      data,
      timestamp: Date.now(),
    };
  }

  clear(): void {
    Object.keys(this.cache).forEach((key) => delete this.cache[key]);
  }

  private getCacheDuration(key: string): number {
    // Use 30 minutes for highlights, 5 minutes for everything else
    if (key === CacheKey.Highlights) {
      return this.HIGHLIGHTS_CACHE_DURATION;
    }
    return this.CACHE_DURATION;
  }
}

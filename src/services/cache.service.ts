import { inject, singleton } from "tsyringe";
import { LoggerService } from "./logger.service";
import { MongoDBCacheService } from "./mongodb-cache.service";

interface CacheEntry<T> {
  data: T;
  timestamp: number;
}

/**
 * Hybrid Cache Service (L1 + L2)
 * L1: In-memory cache (fast, <1ms)
 * L2: MongoDB cache (persistent, 5-50ms)
 */
@singleton()
export class CacheService {
  private memoryCache: Record<string, CacheEntry<unknown>> = {};

  constructor(
    @inject(LoggerService) private logger: LoggerService,
    @inject(MongoDBCacheService) private mongodbCache: MongoDBCacheService,
  ) {
    this.logger.info(
      "CacheService initialized with hybrid cache (L1 memory + L2 MongoDB)",
    );
  }

  async get<T>(key: string): Promise<T | null> {
    // L1: Try in-memory cache (fast, <1ms)
    const entry = this.memoryCache[key];
    if (entry) {
      const duration = this.getCacheDurationMs(key);
      const isExpired = Date.now() - entry.timestamp > duration;
      if (!isExpired) {
        this.logger.debug(`Cache hit (L1) for key: ${key}`);
        return entry.data as T;
      } else {
        delete this.memoryCache[key];
      }
    }

    // L2: Try MongoDB (fallback for persistence, ~5-50ms)
    const mongoData = await this.mongodbCache.get<T>(key);
    if (mongoData) {
      // Populate L1 for next time (rehydration)
      this.memoryCache[key] = {
        data: mongoData,
        timestamp: Date.now(),
      };
      this.logger.debug(`Cache hit (L2) for key: ${key}, populating L1`);
      return mongoData;
    }

    // Cache miss
    this.logger.debug(`Cache miss for key: ${key}`);
    return null;
  }

  async set<T>(key: string, data: T, customTtlSeconds?: number): Promise<void> {
    // Always save to L1 (in-memory) - instant
    this.memoryCache[key] = {
      data,
      timestamp: Date.now(),
    };

    // Always save to L2 (MongoDB) - for persistence
    try {
      await this.mongodbCache.set(key, data, customTtlSeconds);
    } catch (error) {
      this.logger.error(`Error setting cache key ${key} in MongoDB`, {
        key,
        error,
      });
    }
  }

  async clear(): Promise<void> {
    // Clear L1
    Object.keys(this.memoryCache).forEach(
      (key) => delete this.memoryCache[key],
    );

    // Clear L2
    await this.mongodbCache.clear();
  }

  async disconnect(): Promise<void> {
    await this.mongodbCache.disconnect();
  }

  async delete(key: string): Promise<void> {
    delete this.memoryCache[key];
    await this.mongodbCache.delete(key);
  }

  private getCacheDurationSeconds(key: string): number {
    // Tech scores: 2 hours (L1)
    if (key.includes("tech-score")) {
      return 2 * 60 * 60; // 2 hours
    }

    // Comments: 5 minutes (L1)
    if (key.includes("comments")) {
      return 5 * 60; // 5 minutes
    }

    // Default news data: 3 minutes (L1)
    return 3 * 60; // 3 minutes
  }

  private getCacheDurationMs(key: string): number {
    return this.getCacheDurationSeconds(key) * 1000;
  }
}

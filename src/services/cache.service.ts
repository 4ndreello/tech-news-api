import { singleton } from "tsyringe";
import Redis from "ioredis";
import { CacheKey } from "../types";

interface CacheEntry<T> {
  data: T;
  timestamp: number;
}

@singleton()
export class CacheService {
  private redis: Redis | null = null;
  private memoryCache: Record<string, CacheEntry<any>> = {};
  private readonly CACHE_DURATION_SECONDS = 5 * 60; // 5 minutes
  private readonly HIGHLIGHTS_CACHE_DURATION_SECONDS = 10 * 60; // 10 minutes
  private valkeyAvailable = false;

  constructor() {
    const host = process.env.VALKEY_HOST;
    const port = Number(process.env.VALKEY_PORT || 6379);
    const password = process.env.VALKEY_PASSWORD;
    const db = Number(process.env.VALKEY_DB || 0);

    // Only attempt Valkey connection if host is configured
    if (host) {
      this.redis = new Redis({
        host,
        port,
        password,
        db,
        retryStrategy(times) {
          // Retry for 3 times then give up
          if (times > 3) {
            return null;
          }
          const delay = Math.min(times * 50, 2000);
          return delay;
        },
        maxRetriesPerRequest: 3,
        enableOfflineQueue: false,
        lazyConnect: false,
        connectTimeout: 5000, // 5 seconds timeout
      });

      this.redis.on("error", (err) => {
        console.error("Valkey connection error:", err);
        this.valkeyAvailable = false;
      });

      this.redis.on("connect", () => {
        console.log("Connected to Valkey successfully");
        this.valkeyAvailable = true;
      });

      this.redis.on("close", () => {
        console.warn(
          "Valkey connection closed, falling back to in-memory cache",
        );
        this.valkeyAvailable = false;
      });
    } else {
      console.warn(
        "VALKEY_HOST not configured, using in-memory cache only (dev mode)",
      );
    }
  }

  async get<T>(key: string): Promise<T | null> {
    // Try Valkey first if available
    if (this.redis && this.valkeyAvailable) {
      try {
        const data = await this.redis.get(key);
        if (!data) return null;
        return JSON.parse(data) as T;
      } catch (error) {
        console.error(`Error getting cache key ${key} from Valkey:`, error);
        // Fall through to memory cache
      }
    }

    // Fallback to in-memory cache
    const entry = this.memoryCache[key];
    if (!entry) return null;

    const duration = this.getCacheDurationMs(key);
    const isExpired = Date.now() - entry.timestamp > duration;
    if (isExpired) {
      delete this.memoryCache[key];
      return null;
    }

    return entry.data;
  }

  async set<T>(key: string, data: T): Promise<void> {
    // Try Valkey first if available
    if (this.redis && this.valkeyAvailable) {
      try {
        const ttl = this.getCacheDurationSeconds(key);
        await this.redis.setex(key, ttl, JSON.stringify(data));
        return; // Success, no need to use memory cache
      } catch (error) {
        console.error(`Error setting cache key ${key} in Valkey:`, error);
        // Fall through to memory cache
      }
    }

    // Fallback to in-memory cache
    this.memoryCache[key] = {
      data,
      timestamp: Date.now(),
    };
  }

  async clear(): Promise<void> {
    // Clear Valkey if available
    if (this.redis && this.valkeyAvailable) {
      try {
        await this.redis.flushdb();
      } catch (error) {
        console.error("Error clearing Valkey cache:", error);
      }
    }

    // Always clear memory cache
    Object.keys(this.memoryCache).forEach(
      (key) => delete this.memoryCache[key],
    );
  }

  async disconnect(): Promise<void> {
    if (this.redis) {
      await this.redis.quit();
    }
  }

  private getCacheDurationSeconds(key: string): number {
    if (key === CacheKey.Highlights)
      return this.HIGHLIGHTS_CACHE_DURATION_SECONDS;
    return this.CACHE_DURATION_SECONDS;
  }

  private getCacheDurationMs(key: string): number {
    return this.getCacheDurationSeconds(key) * 1000;
  }
}

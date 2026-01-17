import { inject, singleton } from "tsyringe";
import { MongoClient, Db, Collection } from "mongodb";
import { LoggerService } from "./logger.service";

interface CacheEntry<T> {
  _id: string;
  data: T;
  expiresAt: Date;
  tier: "l2";
  createdAt: Date;
}

/**
 * MongoDB L2 Cache Service
 * Temporary cache with TTL expiration (5-15 minutes for news, 2 hours - 7 days for scores)
 * Complements in-memory L1 cache for persistence across server restarts
 */
@singleton()
export class MongoDBCacheService {
  private client: MongoClient | null = null;
  private db: Db | null = null;
  private collection: Collection<any> | null = null;
  private isConnected = false;

  constructor(@inject(LoggerService) private logger: LoggerService) {
    this.initialize();
  }

  private async initialize() {
    const mongoUri = process.env.MONGODB_URI;

    if (!mongoUri) {
      this.logger.warn(
        "MONGODB_URI not configured, MongoDB L2 cache disabled (dev mode)"
      );
      return;
    }

    try {
      this.client = new MongoClient(mongoUri, {
        serverSelectionTimeoutMS: 5000,
        connectTimeoutMS: 5000,
      });

      await this.client.connect();
      this.db = this.client.db("tech_news_cache");
      this.collection = this.db.collection("cache_entries");

      // Create TTL index for automatic expiration
      await this.collection.createIndex(
        { expiresAt: 1 },
        { expireAfterSeconds: 0 }
      );

      this.isConnected = true;
      this.logger.info("Connected to MongoDB L2 cache successfully");
    } catch (error) {
      this.logger.error("Failed to connect to MongoDB L2 cache", { error });
      this.isConnected = false;
    }
  }

  async get<T>(key: string): Promise<T | null> {
    if (!this.isConnected || !this.collection) {
      return null;
    }

    try {
      const entry = await this.collection.findOne<CacheEntry<T>>({
        _id: key,
      });

      if (!entry) {
        return null;
      }

      // Check if expired (shouldn't happen with TTL index, but be safe)
      if (new Date() > entry.expiresAt) {
        return null;
      }

      return entry.data;
    } catch (error) {
      this.logger.error(`Error getting cache key ${key} from MongoDB L2`, {
        key,
        error,
      });
      return null;
    }
  }

  async set<T>(key: string, data: T, customTtlSeconds?: number): Promise<void> {
    if (!this.isConnected || !this.collection) {
      return;
    }

    try {
      const ttl = customTtlSeconds ?? this.getCacheDurationSeconds(key);
      const expiresAt = new Date(Date.now() + ttl * 1000);

      await this.collection.updateOne(
        { _id: key },
        {
          $set: {
            _id: key,
            data,
            expiresAt,
            tier: "l2",
            createdAt: new Date(),
          },
        },
        { upsert: true }
      );
    } catch (error) {
      this.logger.error(`Error setting cache key ${key} in MongoDB L2`, {
        key,
        error,
      });
    }
  }

  async clear(): Promise<void> {
    if (!this.isConnected || !this.collection) {
      return;
    }

    try {
      await this.collection.deleteMany({});
      this.logger.info("Cleared MongoDB L2 cache");
    } catch (error) {
      this.logger.error("Error clearing MongoDB L2 cache", { error });
    }
  }

  async disconnect(): Promise<void> {
    if (this.client) {
      await this.client.close();
      this.isConnected = false;
      this.logger.info("Disconnected from MongoDB L2 cache");
    }
  }

  async delete(key: string): Promise<void> {
    if (!this.isConnected || !this.collection) {
      return;
    }

    try {
      await this.collection.deleteOne({ _id: key });
      this.logger.info(`Deleted key ${key} from MongoDB L2 cache`);
    } catch (error) {
      this.logger.error(`Error deleting cache key ${key} from MongoDB L2`, {
        key,
        error,
      });
    }
  }

  /**
   * L2 TTL Configuration
   * These are longer than L1 to provide fallback during server restarts
   */
  private getCacheDurationSeconds(key: string): number {
    // Tech scores: 7 days (longer persistence in cache)
    if (key.includes("tech-score")) {
      return 7 * 24 * 60 * 60; // 7 days
    }

    // Comments: 30 minutes
    if (key.includes("comments")) {
      return 30 * 60; // 30 minutes
    }

    // Default news data: 15 minutes
    return 15 * 60; // 15 minutes
  }
}

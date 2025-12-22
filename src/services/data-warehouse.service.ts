import { inject, singleton } from "tsyringe";
import { MongoClient, Db, Collection } from "mongodb";
import { LoggerService } from "./logger.service";
import type { NewsItem } from "../types";

@singleton()
export class DataWarehouseService {
  private client: MongoClient | null = null;
  private db: Db | null = null;
  private rawCollection: Collection<any> | null = null;
  private rankedCollection: Collection<any> | null = null;
  private mixedCollection: Collection<any> | null = null;
  private isConnected = false;

  constructor(@inject(LoggerService) private logger: LoggerService) {
    this.initialize();
  }

  private async initialize() {
    const mongoUri = process.env.MONGODB_URI;

    if (!mongoUri) {
      this.logger.warn(
        "MONGODB_URI not configured, data warehouse disabled (dev mode)",
      );
      return;
    }

    try {
      this.client = new MongoClient(mongoUri, {
        serverSelectionTimeoutMS: 5000,
        connectTimeoutMS: 5000,
      });

      await this.client.connect();
      this.db = this.client.db("tech_news_warehouse");

      // Create collections
      this.rawCollection = this.db.collection("raw_news");
      this.rankedCollection = this.db.collection("ranked_news");
      this.mixedCollection = this.db.collection("mixed_feed");

      // Create indexes for efficient querying
      await this.createIndexes();

      this.isConnected = true;
      this.logger.info("Connected to MongoDB data warehouse successfully");
    } catch (error) {
      this.logger.error("Failed to connect to MongoDB warehouse", { error });
      this.isConnected = false;
    }
  }

  private async createIndexes() {
    try {
      // Raw news indexes
      await this.rawCollection?.createIndex({ source: 1, fetchedAt: -1 });
      await this.rawCollection?.createIndex({ fetchedAt: -1 }); // For time range queries
      await this.rawCollection?.createIndex({
        "data.publishedAt": -1,
      }); // Original publish date

      // Ranked news indexes
      await this.rankedCollection?.createIndex({ source: 1, rank: -1 });
      await this.rankedCollection?.createIndex({ score: -1 });
      await this.rankedCollection?.createIndex({ rankedAt: -1 });
      await this.rankedCollection?.createIndex({
        source: 1,
        rankedAt: -1,
      }); // For source + time queries

      // Mixed feed indexes
      await this.mixedCollection?.createIndex({ mixedAt: -1 });

      this.logger.info("Data warehouse indexes created successfully");
    } catch (error) {
      this.logger.error("Failed to create warehouse indexes", { error });
    }
  }

  /**
   * Save raw news data without expiration
   */
  async saveRawNews(newsItems: NewsItem[], source: string): Promise<void> {
    if (!this.isConnected || !this.rawCollection) {
      return;
    }

    try {
      const entries = newsItems.map((item) => ({
        _id: `${source}:${item.id}`,
        source,
        data: item,
        fetchedAt: new Date(),
      }));

      // Use upsert to avoid duplicates
      const bulk = this.rawCollection.initializeUnorderedBulkOp();
      for (const entry of entries) {
        bulk.find({ _id: entry._id }).upsert().updateOne({ $set: entry });
      }
      await bulk.execute();

      this.logger.info(
        `Saved ${newsItems.length} raw news items from ${source}`,
      );
    } catch (error) {
      this.logger.error(`Error saving raw news from ${source}`, {
        source,
        error,
      });
    }
  }

  /**
   * Save ranked news data with scores
   */
  async saveRankedNews(
    newsItems: NewsItem[],
    source: string,
    startRank = 0,
  ): Promise<void> {
    if (!this.isConnected || !this.rankedCollection) {
      return;
    }

    try {
      const entries = newsItems.map((item, index) => ({
        _id: `${source}:ranked:${item.id}`,
        source,
        data: item,
        rank: startRank + index,
        score: item.score || 0,
        techScore: item.techScore || 0,
        rankedAt: new Date(),
      }));

      const bulk = this.rankedCollection.initializeUnorderedBulkOp();
      for (const entry of entries) {
        bulk.find({ _id: entry._id }).upsert().updateOne({ $set: entry });
      }
      await bulk.execute();

      this.logger.info(
        `Saved ${newsItems.length} ranked news items from ${source}`,
      );
    } catch (error) {
      this.logger.error(`Error saving ranked news from ${source}`, {
        source,
        error,
      });
    }
  }

  /**
   * Save mixed/final feed
   */
  async saveMixedFeed(items: NewsItem[]): Promise<void> {
    if (!this.isConnected || !this.mixedCollection) {
      return;
    }

    try {
      const entry = {
        _id: `mixed:${Date.now()}`,
        items,
        mixedAt: new Date(),
        generatedAt: new Date(),
      };

      await this.mixedCollection.insertOne(entry);

      this.logger.info(`Saved mixed feed with ${items.length} items`);
    } catch (error) {
      this.logger.error("Error saving mixed feed", { error });
    }
  }

  /**
   * Query raw news by source and date range
   */
  async getRawNewsBySourceAndDate(
    source: string,
    startDate: Date,
    endDate: Date,
  ): Promise<NewsItem[]> {
    if (!this.isConnected || !this.rawCollection) {
      return [];
    }

    try {
      const items = await this.rawCollection
        .find({
          source,
          fetchedAt: { $gte: startDate, $lte: endDate },
        })
        .sort({ fetchedAt: -1 })
        .toArray();

      return items.map((item) => item.data);
    } catch (error) {
      this.logger.error("Error querying raw news", { source, error });
      return [];
    }
  }

  /**
   * Query ranked news by date range
   */
  async getRankedNewsByDate(
    startDate: Date,
    endDate: Date,
    limit = 100,
  ): Promise<NewsItem[]> {
    if (!this.isConnected || !this.rankedCollection) {
      return [];
    }

    try {
      const items = await this.rankedCollection
        .find({
          rankedAt: { $gte: startDate, $lte: endDate },
        })
        .sort({ score: -1 })
        .limit(limit)
        .toArray();

      return items.map((item) => item.data);
    } catch (error) {
      this.logger.error("Error querying ranked news", { error });
      return [];
    }
  }

  /**
   * Get top ranked news for a specific source
   */
  async getTopRankedBySource(source: string, limit = 50): Promise<NewsItem[]> {
    if (!this.isConnected || !this.rankedCollection) {
      return [];
    }

    try {
      const items = await this.rankedCollection
        .find({ source })
        .sort({ score: -1, rankedAt: -1 })
        .limit(limit)
        .toArray();

      return items.map((item) => item.data);
    } catch (error) {
      this.logger.error("Error querying top ranked news", { source, error });
      return [];
    }
  }

  /**
   * Get stats about stored data
   */
  async getWarehouseStats(): Promise<{
    rawCount: number;
    rankedCount: number;
    mixedCount: number;
  }> {
    if (!this.isConnected) {
      return { rawCount: 0, rankedCount: 0, mixedCount: 0 };
    }

    try {
      const [rawCount, rankedCount, mixedCount] = await Promise.all([
        this.rawCollection?.countDocuments() || 0,
        this.rankedCollection?.countDocuments() || 0,
        this.mixedCollection?.countDocuments() || 0,
      ]);

      return { rawCount, rankedCount, mixedCount };
    } catch (error) {
      this.logger.error("Error getting warehouse stats", { error });
      return { rawCount: 0, rankedCount: 0, mixedCount: 0 };
    }
  }

  async disconnect(): Promise<void> {
    if (this.client) {
      await this.client.close();
      this.isConnected = false;
      this.logger.info("Disconnected from MongoDB warehouse");
    }
  }
}

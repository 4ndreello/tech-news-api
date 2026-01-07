import { inject, singleton } from "tsyringe";
import { MongoClient, Db, Collection } from "mongodb";
import { LoggerService } from "./logger.service";
import type {
  NewsItem,
  EnrichedNewsItem,
  RankedNewsItem,
  Source,
  WarehouseStats,
  TrendingTopic,
  AnalyticsPeriod,
} from "../types";

interface RawNewsDocument {
  _id: string;
  source: string;
  data: NewsItem;
  fetchedAt: Date;
}

interface EnrichedNewsDocument {
  _id: string;
  source: string;
  itemId: string;
  rawData: NewsItem;
  techScore: number;
  techScoreConfidence: number;
  keywords: string[];
  isTechNews: boolean;
  linkMetadata?: {
    title: string;
    description: string;
    imageUrl?: string;
  };
  enrichedAt: Date;
}

interface RankedNewsDocument {
  _id: string;
  source: string;
  itemId: string;
  data: NewsItem;
  rank: number;
  calculatedScore: number;
  originalScore: number;
  techScore: number;
  keywords: string[];
  rankedAt: Date;
}

interface MixedFeedDocument {
  _id: string;
  items: NewsItem[];
  mixedAt: Date;
  generatedAt: Date;
  itemCount: number;
}

@singleton()
export class DataWarehouseService {
  private client: MongoClient | null = null;
  private db: Db | null = null;
  private rawCollection: Collection<RawNewsDocument> | null = null;
  private enrichedCollection: Collection<EnrichedNewsDocument> | null = null;
  private rankedCollection: Collection<RankedNewsDocument> | null = null;
  private mixedCollection: Collection<MixedFeedDocument> | null = null;
  private isConnected = false;

  constructor(@inject(LoggerService) private logger: LoggerService) {
    this.initialize();
  }

  private async initialize() {
    const mongoUri = process.env.MONGODB_URI;

    if (!mongoUri) {
      this.logger.warn(
        "MONGODB_URI not configured, data warehouse disabled (dev mode)"
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

      this.rawCollection = this.db.collection("raw_news");
      this.enrichedCollection = this.db.collection("enriched_news");
      this.rankedCollection = this.db.collection("ranked_news");
      this.mixedCollection = this.db.collection("mixed_feed");

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
      await this.rawCollection?.createIndex({ source: 1, fetchedAt: -1 });
      await this.rawCollection?.createIndex({ fetchedAt: -1 });
      await this.rawCollection?.createIndex({ "data.publishedAt": -1 });

      await this.enrichedCollection?.createIndex({ source: 1, enrichedAt: -1 });
      await this.enrichedCollection?.createIndex({ keywords: 1 });
      await this.enrichedCollection?.createIndex({ techScore: -1 });
      await this.enrichedCollection?.createIndex({ isTechNews: 1, enrichedAt: -1 });

      await this.rankedCollection?.createIndex({ source: 1, rank: 1 });
      await this.rankedCollection?.createIndex({ calculatedScore: -1 });
      await this.rankedCollection?.createIndex({ rankedAt: -1 });
      await this.rankedCollection?.createIndex({ source: 1, rankedAt: -1 });
      await this.rankedCollection?.createIndex({ keywords: 1, rankedAt: -1 });

      await this.mixedCollection?.createIndex({ mixedAt: -1 });

      this.logger.info("Data warehouse indexes created successfully");
    } catch (error) {
      this.logger.error("Failed to create warehouse indexes", { error });
    }
  }

  async saveRawNews(newsItems: NewsItem[], source: string): Promise<void> {
    if (!this.isConnected || !this.rawCollection || newsItems.length === 0) {
      return;
    }

    try {
      const entries: RawNewsDocument[] = newsItems.map((item) => ({
        _id: `${source}:${item.id}`,
        source,
        data: item,
        fetchedAt: new Date(),
      }));

      const bulk = this.rawCollection.initializeUnorderedBulkOp();
      for (const entry of entries) {
        bulk.find({ _id: entry._id }).upsert().updateOne({ $set: entry });
      }
      await bulk.execute();

      this.logger.info(`Saved ${newsItems.length} raw news items from ${source}`);
    } catch (error) {
      this.logger.error(`Error saving raw news from ${source}`, { source, error });
      throw error;
    }
  }

  async saveEnrichedNews(items: EnrichedNewsItem[], source: string): Promise<void> {
    if (!this.isConnected || !this.enrichedCollection || items.length === 0) {
      return;
    }

    try {
      const entries: EnrichedNewsDocument[] = items.map((item) => ({
        _id: `${source}:enriched:${item.itemId}`,
        source: item.source,
        itemId: item.itemId,
        rawData: item.rawData,
        techScore: item.techScore,
        techScoreConfidence: item.techScoreConfidence,
        keywords: item.keywords,
        isTechNews: item.isTechNews,
        linkMetadata: item.linkMetadata,
        enrichedAt: item.enrichedAt,
      }));

      const bulk = this.enrichedCollection.initializeUnorderedBulkOp();
      for (const entry of entries) {
        bulk.find({ _id: entry._id }).upsert().updateOne({ $set: entry });
      }
      await bulk.execute();

      this.logger.info(`Saved ${items.length} enriched news items from ${source}`);
    } catch (error) {
      this.logger.error(`Error saving enriched news from ${source}`, { source, error });
      throw error;
    }
  }

  async saveRankedNews(items: RankedNewsItem[], source: string): Promise<void> {
    if (!this.isConnected || !this.rankedCollection || items.length === 0) {
      return;
    }

    try {
      const entries: RankedNewsDocument[] = items.map((item) => ({
        _id: `${source}:ranked:${item.itemId}`,
        source: item.source,
        itemId: item.itemId,
        data: item.data,
        rank: item.rank,
        calculatedScore: item.calculatedScore,
        originalScore: item.originalScore,
        techScore: item.techScore,
        keywords: item.keywords,
        rankedAt: item.rankedAt,
      }));

      const bulk = this.rankedCollection.initializeUnorderedBulkOp();
      for (const entry of entries) {
        bulk.find({ _id: entry._id }).upsert().updateOne({ $set: entry });
      }
      await bulk.execute();

      this.logger.info(`Saved ${items.length} ranked news items from ${source}`);
    } catch (error) {
      this.logger.error(`Error saving ranked news from ${source}`, { source, error });
      throw error;
    }
  }

  async saveMixedFeed(items: NewsItem[]): Promise<void> {
    if (!this.isConnected || !this.mixedCollection || items.length === 0) {
      return;
    }

    try {
      const entry: MixedFeedDocument = {
        _id: `mixed:${Date.now()}`,
        items,
        mixedAt: new Date(),
        generatedAt: new Date(),
        itemCount: items.length,
      };

      await this.mixedCollection.insertOne(entry);
      this.logger.info(`Saved mixed feed with ${items.length} items`);
    } catch (error) {
      this.logger.error("Error saving mixed feed", { error });
      throw error;
    }
  }

  async getRawNewsBySourceAndDate(
    source: string,
    startDate: Date,
    endDate: Date
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

  async getRankedNewsByDate(
    startDate: Date,
    endDate: Date,
    limit = 100
  ): Promise<RankedNewsDocument[]> {
    if (!this.isConnected || !this.rankedCollection) {
      return [];
    }

    try {
      return await this.rankedCollection
        .find({
          rankedAt: { $gte: startDate, $lte: endDate },
        })
        .sort({ calculatedScore: -1 })
        .limit(limit)
        .toArray();
    } catch (error) {
      this.logger.error("Error querying ranked news", { error });
      return [];
    }
  }

  async getTopRankedBySource(source: string, limit = 50): Promise<NewsItem[]> {
    if (!this.isConnected || !this.rankedCollection) {
      return [];
    }

    try {
      const items = await this.rankedCollection
        .find({ source })
        .sort({ calculatedScore: -1, rankedAt: -1 })
        .limit(limit)
        .toArray();

      return items.map((item) => item.data);
    } catch (error) {
      this.logger.error("Error querying top ranked news", { source, error });
      return [];
    }
  }

  async getTrendingKeywords(period: AnalyticsPeriod, limit = 20): Promise<TrendingTopic[]> {
    if (!this.isConnected || !this.rankedCollection) {
      return [];
    }

    const periodMs = this.getPeriodMs(period);
    const since = new Date(Date.now() - periodMs);

    try {
      const pipeline = [
        { $match: { rankedAt: { $gte: since } } },
        { $unwind: "$keywords" },
        {
          $group: {
            _id: "$keywords",
            count: { $sum: 1 },
            avgScore: { $avg: "$calculatedScore" },
            sources: { $addToSet: "$source" },
            articles: {
              $push: {
                id: "$itemId",
                title: "$data.title",
                score: "$calculatedScore",
                source: "$source",
              },
            },
          },
        },
        { $sort: { count: -1, avgScore: -1 } },
        { $limit: limit },
      ];

      const results = await this.rankedCollection.aggregate(pipeline).toArray();

      return results.map((r) => ({
        keyword: r._id as string,
        count: r.count as number,
        avgScore: Math.round(r.avgScore as number),
        sources: r.sources as Source[],
        topArticles: (r.articles as Array<{id: string; title: string; score: number; source: Source}>)
          .sort((a, b) => b.score - a.score)
          .slice(0, 5),
      }));
    } catch (error) {
      this.logger.error("Error getting trending keywords", { error });
      return [];
    }
  }

  async getMostCommentedTopics(period: AnalyticsPeriod, limit = 20): Promise<TrendingTopic[]> {
    if (!this.isConnected || !this.rankedCollection) {
      return [];
    }

    const periodMs = this.getPeriodMs(period);
    const since = new Date(Date.now() - periodMs);

    try {
      const pipeline = [
        {
          $match: {
            rankedAt: { $gte: since },
            "data.commentCount": { $gt: 0 },
          },
        },
        { $unwind: "$keywords" },
        {
          $group: {
            _id: "$keywords",
            count: { $sum: 1 },
            totalComments: { $sum: "$data.commentCount" },
            avgScore: { $avg: "$calculatedScore" },
            sources: { $addToSet: "$source" },
            articles: {
              $push: {
                id: "$itemId",
                title: "$data.title",
                score: "$calculatedScore",
                source: "$source",
              },
            },
          },
        },
        { $sort: { totalComments: -1 } },
        { $limit: limit },
      ];

      const results = await this.rankedCollection.aggregate(pipeline).toArray();

      return results.map((r) => ({
        keyword: r._id as string,
        count: r.count as number,
        avgScore: Math.round(r.avgScore as number),
        sources: r.sources as Source[],
        topArticles: (r.articles as Array<{id: string; title: string; score: number; source: Source}>)
          .sort((a, b) => b.score - a.score)
          .slice(0, 5),
      }));
    } catch (error) {
      this.logger.error("Error getting most commented topics", { error });
      return [];
    }
  }

  async getWarehouseStats(): Promise<WarehouseStats> {
    if (!this.isConnected) {
      return {
        rawCount: 0,
        enrichedCount: 0,
        rankedCount: 0,
        mixedCount: 0,
        logsCount: 0,
      };
    }

    try {
      const [rawCount, enrichedCount, rankedCount, mixedCount] = await Promise.all([
        this.rawCollection?.countDocuments() || 0,
        this.enrichedCollection?.countDocuments() || 0,
        this.rankedCollection?.countDocuments() || 0,
        this.mixedCollection?.countDocuments() || 0,
      ]);

      const oldest = await this.rawCollection
        ?.find()
        .sort({ fetchedAt: 1 })
        .limit(1)
        .toArray();

      const newest = await this.rawCollection
        ?.find()
        .sort({ fetchedAt: -1 })
        .limit(1)
        .toArray();

      return {
        rawCount,
        enrichedCount,
        rankedCount,
        mixedCount,
        logsCount: 0,
        oldestRecord: oldest?.[0]?.fetchedAt,
        newestRecord: newest?.[0]?.fetchedAt,
      };
    } catch (error) {
      this.logger.error("Error getting warehouse stats", { error });
      return {
        rawCount: 0,
        enrichedCount: 0,
        rankedCount: 0,
        mixedCount: 0,
        logsCount: 0,
      };
    }
  }

  private getPeriodMs(period: AnalyticsPeriod): number {
    switch (period) {
      case "24h":
        return 24 * 60 * 60 * 1000;
      case "7d":
        return 7 * 24 * 60 * 60 * 1000;
      case "30d":
        return 30 * 24 * 60 * 60 * 1000;
      default:
        return 24 * 60 * 60 * 1000;
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

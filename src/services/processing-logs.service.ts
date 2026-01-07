import { inject, singleton } from "tsyringe";
import { MongoClient, Db, Collection } from "mongodb";
import { LoggerService } from "./logger.service";
import type { ProcessingLogEntry, ProcessingStep, Source } from "../types";
import { getCorrelationId } from "../context/request-context";

interface ProcessingLogDocument extends ProcessingLogEntry {
  _id?: string;
  expiresAt: Date;
}

@singleton()
export class ProcessingLogsService {
  private client: MongoClient | null = null;
  private db: Db | null = null;
  private collection: Collection<ProcessingLogDocument> | null = null;
  private isConnected = false;
  private readonly TTL_DAYS = 30;

  constructor(@inject(LoggerService) private logger: LoggerService) {
    this.initialize();
  }

  private async initialize() {
    const mongoUri = process.env.MONGODB_URI;

    if (!mongoUri) {
      this.logger.warn(
        "MONGODB_URI not configured, processing logs disabled"
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
      this.collection = this.db.collection("processing_logs");

      await this.createIndexes();

      this.isConnected = true;
      this.logger.info("ProcessingLogsService connected successfully");
    } catch (error) {
      this.logger.error("Failed to connect ProcessingLogsService", { error });
      this.isConnected = false;
    }
  }

  private async createIndexes() {
    if (!this.collection) return;

    try {
      await this.collection.createIndex(
        { expiresAt: 1 },
        { expireAfterSeconds: 0 }
      );

      await this.collection.createIndex({ correlationId: 1 });
      await this.collection.createIndex({ step: 1, timestamp: -1 });
      await this.collection.createIndex({ source: 1, timestamp: -1 });
      await this.collection.createIndex({ newsItemId: 1 });
      await this.collection.createIndex({ success: 1, timestamp: -1 });

      this.logger.info("Processing logs indexes created");
    } catch (error) {
      this.logger.error("Failed to create processing logs indexes", { error });
    }
  }

  async log(
    step: ProcessingStep,
    source: Source,
    newsItemId: string,
    duration: number,
    success: boolean,
    error?: { message: string; stack?: string },
    metadata?: Record<string, unknown>
  ): Promise<void> {
    if (!this.isConnected || !this.collection) {
      return;
    }

    const correlationId = getCorrelationId() || `fallback-${Date.now()}`;
    const now = new Date();
    const expiresAt = new Date(now.getTime() + this.TTL_DAYS * 24 * 60 * 60 * 1000);

    const entry: ProcessingLogDocument = {
      correlationId,
      timestamp: now,
      step,
      source,
      newsItemId,
      duration,
      success,
      error,
      metadata,
      expiresAt,
    };

    try {
      await this.collection.insertOne(entry);
    } catch (err) {
      this.logger.error("Failed to insert processing log", {
        step,
        source,
        newsItemId,
        error: err,
      });
    }
  }

  async logBatch(entries: Omit<ProcessingLogEntry, "correlationId" | "timestamp">[]): Promise<void> {
    if (!this.isConnected || !this.collection || entries.length === 0) {
      return;
    }

    const correlationId = getCorrelationId() || `fallback-${Date.now()}`;
    const now = new Date();
    const expiresAt = new Date(now.getTime() + this.TTL_DAYS * 24 * 60 * 60 * 1000);

    const documents: ProcessingLogDocument[] = entries.map((entry) => ({
      ...entry,
      correlationId,
      timestamp: now,
      expiresAt,
    }));

    try {
      await this.collection.insertMany(documents);
    } catch (error) {
      this.logger.error("Failed to insert batch processing logs", { error });
    }
  }

  async getLogsByCorrelation(correlationId: string): Promise<ProcessingLogEntry[]> {
    if (!this.isConnected || !this.collection) {
      return [];
    }

    try {
      return await this.collection
        .find({ correlationId })
        .sort({ timestamp: 1 })
        .toArray();
    } catch (error) {
      this.logger.error("Failed to get logs by correlation", { correlationId, error });
      return [];
    }
  }

  async getRecentErrors(limit = 100): Promise<ProcessingLogEntry[]> {
    if (!this.isConnected || !this.collection) {
      return [];
    }

    try {
      return await this.collection
        .find({ success: false })
        .sort({ timestamp: -1 })
        .limit(limit)
        .toArray();
    } catch (error) {
      this.logger.error("Failed to get recent errors", { error });
      return [];
    }
  }

  async getStepStats(
    step: ProcessingStep,
    since: Date
  ): Promise<{ total: number; successful: number; failed: number; avgDuration: number }> {
    if (!this.isConnected || !this.collection) {
      return { total: 0, successful: 0, failed: 0, avgDuration: 0 };
    }

    try {
      const pipeline = [
        { $match: { step, timestamp: { $gte: since } } },
        {
          $group: {
            _id: null,
            total: { $sum: 1 },
            successful: { $sum: { $cond: ["$success", 1, 0] } },
            failed: { $sum: { $cond: ["$success", 0, 1] } },
            avgDuration: { $avg: "$duration" },
          },
        },
      ];

      const results = await this.collection.aggregate(pipeline).toArray();
      if (results.length === 0) {
        return { total: 0, successful: 0, failed: 0, avgDuration: 0 };
      }

      return {
        total: results[0].total,
        successful: results[0].successful,
        failed: results[0].failed,
        avgDuration: Math.round(results[0].avgDuration || 0),
      };
    } catch (error) {
      this.logger.error("Failed to get step stats", { step, error });
      return { total: 0, successful: 0, failed: 0, avgDuration: 0 };
    }
  }

  async disconnect(): Promise<void> {
    if (this.client) {
      await this.client.close();
      this.isConnected = false;
      this.logger.info("ProcessingLogsService disconnected");
    }
  }
}

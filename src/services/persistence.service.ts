import { inject, singleton } from "tsyringe";
import { LoggerService } from "./logger.service";
import { ProcessingLogsService } from "./processing-logs.service";
import { DataWarehouseService } from "./data-warehouse.service";
import { CacheService } from "./cache.service";
import type { NewsItem, EnrichedNewsItem, RankedNewsItem, Source } from "../types";

interface RetryConfig {
  maxRetries: number;
  baseDelayMs: number;
  maxDelayMs: number;
}

@singleton()
export class PersistenceService {
  private readonly defaultRetryConfig: RetryConfig = {
    maxRetries: 3,
    baseDelayMs: 100,
    maxDelayMs: 2000,
  };

  constructor(
    @inject(LoggerService) private logger: LoggerService,
    @inject(ProcessingLogsService) private processingLogs: ProcessingLogsService,
    @inject(DataWarehouseService) private warehouse: DataWarehouseService,
    @inject(CacheService) private cache: CacheService
  ) {}

  async persistRawNews(
    items: NewsItem[],
    source: Source
  ): Promise<{ success: boolean; persistedCount: number }> {
    const startTime = Date.now();

    try {
      await this.withRetry(
        () => this.warehouse.saveRawNews(items, source),
        `persistRawNews:${source}`
      );

      await this.processingLogs.logBatch(
        items.map((item) => ({
          step: "fetch" as const,
          source,
          newsItemId: item.id,
          duration: Date.now() - startTime,
          success: true,
        }))
      );

      this.logger.info(`Persisted ${items.length} raw news from ${source}`);
      return { success: true, persistedCount: items.length };
    } catch (error) {
      this.logger.error(`Failed to persist raw news from ${source}`, { error });

      await this.processingLogs.logBatch(
        items.map((item) => ({
          step: "fetch" as const,
          source,
          newsItemId: item.id,
          duration: Date.now() - startTime,
          success: false,
          error: {
            message: error instanceof Error ? error.message : String(error),
          },
        }))
      );

      return { success: false, persistedCount: 0 };
    }
  }

  async persistEnrichedNews(
    items: EnrichedNewsItem[],
    source: Source
  ): Promise<{ success: boolean; persistedCount: number }> {
    const startTime = Date.now();

    try {
      await this.withRetry(
        () => this.warehouse.saveEnrichedNews(items, source),
        `persistEnrichedNews:${source}`
      );

      this.logger.info(`Persisted ${items.length} enriched news from ${source}`);
      return { success: true, persistedCount: items.length };
    } catch (error) {
      this.logger.error(`Failed to persist enriched news from ${source}`, { error });
      return { success: false, persistedCount: 0 };
    }
  }

  async persistRankedNews(
    items: RankedNewsItem[],
    source: Source
  ): Promise<{ success: boolean; persistedCount: number }> {
    const startTime = Date.now();

    try {
      await this.withRetry(
        () => this.warehouse.saveRankedNews(items, source),
        `persistRankedNews:${source}`
      );

      await this.processingLogs.logBatch(
        items.map((item) => ({
          step: "rank" as const,
          source,
          newsItemId: item.itemId,
          duration: Date.now() - startTime,
          success: true,
          metadata: {
            rank: item.rank,
            calculatedScore: item.calculatedScore,
          },
        }))
      );

      this.logger.info(`Persisted ${items.length} ranked news from ${source}`);
      return { success: true, persistedCount: items.length };
    } catch (error) {
      this.logger.error(`Failed to persist ranked news from ${source}`, { error });
      return { success: false, persistedCount: 0 };
    }
  }

  async persistMixedFeed(
    items: NewsItem[],
    cacheKey: string
  ): Promise<{ success: boolean }> {
    const startTime = Date.now();

    try {
      const [warehouseResult] = await Promise.allSettled([
        this.withRetry(
          () => this.warehouse.saveMixedFeed(items),
          "persistMixedFeed:warehouse"
        ),
        this.cache.set(cacheKey, items),
      ]);

      const success = warehouseResult.status === "fulfilled";

      await this.processingLogs.log(
        "mix",
        items[0]?.source || ("mixed" as Source),
        `mixed-feed-${Date.now()}`,
        Date.now() - startTime,
        success,
        success ? undefined : { message: "Failed to persist mixed feed" }
      );

      if (success) {
        this.logger.info(`Persisted mixed feed with ${items.length} items`);
      }

      return { success };
    } catch (error) {
      this.logger.error("Failed to persist mixed feed", { error });
      return { success: false };
    }
  }

  async persistAll(data: {
    raw?: { items: NewsItem[]; source: Source }[];
    enriched?: { items: EnrichedNewsItem[]; source: Source }[];
    ranked?: { items: RankedNewsItem[]; source: Source }[];
    mixed?: { items: NewsItem[]; cacheKey: string };
  }): Promise<{
    raw: { success: boolean; count: number };
    enriched: { success: boolean; count: number };
    ranked: { success: boolean; count: number };
    mixed: { success: boolean };
  }> {
    const results = {
      raw: { success: true, count: 0 },
      enriched: { success: true, count: 0 },
      ranked: { success: true, count: 0 },
      mixed: { success: true },
    };

    const operations: Promise<void>[] = [];

    if (data.raw) {
      for (const { items, source } of data.raw) {
        operations.push(
          this.persistRawNews(items, source).then((r) => {
            results.raw.success = results.raw.success && r.success;
            results.raw.count += r.persistedCount;
          })
        );
      }
    }

    if (data.enriched) {
      for (const { items, source } of data.enriched) {
        operations.push(
          this.persistEnrichedNews(items, source).then((r) => {
            results.enriched.success = results.enriched.success && r.success;
            results.enriched.count += r.persistedCount;
          })
        );
      }
    }

    if (data.ranked) {
      for (const { items, source } of data.ranked) {
        operations.push(
          this.persistRankedNews(items, source).then((r) => {
            results.ranked.success = results.ranked.success && r.success;
            results.ranked.count += r.persistedCount;
          })
        );
      }
    }

    if (data.mixed) {
      operations.push(
        this.persistMixedFeed(data.mixed.items, data.mixed.cacheKey).then((r) => {
          results.mixed.success = r.success;
        })
      );
    }

    await Promise.allSettled(operations);

    this.logger.info("Persistence complete", {
      raw: results.raw,
      enriched: results.enriched,
      ranked: results.ranked,
      mixed: results.mixed,
    });

    return results;
  }

  private async withRetry<T>(
    operation: () => Promise<T>,
    operationName: string,
    config: RetryConfig = this.defaultRetryConfig
  ): Promise<T> {
    let lastError: Error | undefined;

    for (let attempt = 1; attempt <= config.maxRetries; attempt++) {
      try {
        return await operation();
      } catch (error) {
        lastError = error instanceof Error ? error : new Error(String(error));

        if (attempt < config.maxRetries) {
          const delay = Math.min(
            config.baseDelayMs * Math.pow(2, attempt - 1),
            config.maxDelayMs
          );

          this.logger.warn(`Retry ${attempt}/${config.maxRetries} for ${operationName}`, {
            delay,
            error: lastError.message,
          });

          await this.sleep(delay);
        }
      }
    }

    throw lastError;
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}

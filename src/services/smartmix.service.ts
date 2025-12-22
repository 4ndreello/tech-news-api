import { singleton, inject } from "tsyringe";
import type { NewsItem } from "../types";
import { TabNewsService } from "./tabnews.service";
import { HackerNewsService } from "./hackernews.service";
import { RankingService } from "./ranking.service";
import { CacheService } from "./cache.service";
import { DataWarehouseService } from "./data-warehouse.service";
import { CacheKey } from "../types";
import { LoggerService } from "./logger.service";

@singleton()
export class SmartMixService {
  private fetchLock: Promise<NewsItem[]> | null = null;

  constructor(
    @inject(TabNewsService) private tabNewsService: TabNewsService,
    @inject(HackerNewsService) private hackerNewsService: HackerNewsService,
    @inject(RankingService) private rankingService: RankingService,
    @inject(CacheService) private cacheService: CacheService,
    @inject(DataWarehouseService)
    private dataWarehouseService: DataWarehouseService,
    @inject(LoggerService) private logger: LoggerService
  ) {}

  /**
   * Fetches and mixes news from both sources
   * Uses cache to avoid repeated fetches
   */
  async fetchMix(): Promise<NewsItem[]> {
    const cached = await this.cacheService.get<NewsItem[]>(CacheKey.SmartMix);
    if (cached) return cached;

    if (this.fetchLock) {
      return this.fetchLock;
    }

    this.fetchLock = this.doFetchAndRank();

    try {
      const result = await this.fetchLock;
      return result;
    } finally {
      this.fetchLock = null;
    }
  }

  private async doFetchAndRank(): Promise<NewsItem[]> {
    // Fetch first page from each source
    const [tabNewsResults, hnResults] = await Promise.allSettled([
      this.tabNewsService.fetchPage(1),
      this.hackerNewsService.fetchBatch(0),
    ]);

    const tabNews =
      tabNewsResults.status === "fulfilled" ? tabNewsResults.value : [];
    const hn = hnResults.status === "fulfilled" ? hnResults.value : [];

    if (
      tabNewsResults.status === "rejected" &&
      hnResults.status === "rejected"
    ) {
      throw new Error("Não foi possível carregar nenhuma fonte de notícias.");
    }

    // Rank items and replace score field with our normalized score
    const sortedTab = [...tabNews]
      .map((item) => ({
        ...item,
        score: this.rankingService.calculateRank(item),
      }))
      .sort((a, b) => b.score - a.score);

    const sortedHn = [...hn]
      .map((item) => ({
        ...item,
        score: this.rankingService.calculateRank(item),
      }))
      .sort((a, b) => b.score - a.score);

    this.persistToWarehouse(tabNews, sortedTab, hn, sortedHn).catch((error: Error) =>
      this.logger.error("Error persisting to Data Warehouse", { error })
    );

    const mixed: NewsItem[] = [];
    const maxLength = Math.max(sortedTab.length, sortedHn.length);

    for (let i = 0; i < maxLength; i++) {
      if (i < sortedTab.length) mixed.push(sortedTab[i]);
      if (i < sortedHn.length) mixed.push(sortedHn[i]);
    }

    this.logger.info(
      `SmartMix: mixed ${mixed.length} items (${sortedTab.length} TabNews + ${sortedHn.length} HN)`
    );

    await this.cacheService.set(CacheKey.SmartMix, mixed);

    await this.dataWarehouseService.saveMixedFeed(mixed).catch((error: Error) =>
      this.logger.error("Error saving mixed feed to warehouse", { error })
    );

    return mixed;
  }

  private async persistToWarehouse(
    rawTab: NewsItem[],
    rankedTab: NewsItem[],
    rawHn: NewsItem[],
    rankedHn: NewsItem[]
  ): Promise<void> {
    await Promise.allSettled([
      this.dataWarehouseService.saveRawNews(rawTab, "TabNews"),
      this.dataWarehouseService.saveRankedNews(rankedTab, "TabNews"),
      this.dataWarehouseService.saveRawNews(rawHn, "HackerNews"),
      this.dataWarehouseService.saveRankedNews(rankedHn, "HackerNews"),
    ]);
  }

  /**
   * Legacy method for backward compatibility
   * @deprecated
   */
  async fetchMixPaginated(
    limit: number,
    after?: string
  ): Promise<{ items: NewsItem[]; nextCursor: string | null }> {
    const allItems = await this.fetchMix();

    let startIdx = 0;
    if (after) {
      const idx = allItems.findIndex((item) => item.id === after);
      if (idx >= 0) {
        startIdx = idx + 1;
      }
    }

    const items = allItems.slice(startIdx, startIdx + limit);

    const nextCursor =
      items.length === limit && startIdx + limit < allItems.length
        ? items[items.length - 1].id
        : null;

    return { items, nextCursor };
  }
}

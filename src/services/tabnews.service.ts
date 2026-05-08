import { singleton, inject } from "tsyringe";
import type { NewsItem, TabNewsItem } from "../types";
import { Source, CacheKey } from "../types";
import { CacheService } from "./cache.service";
import { LoggerService } from "./logger.service";
import { TechScoringService } from "./tech-scoring.service";

@singleton()
export class TabNewsService {
  private readonly TABNEWS_API = "https://www.tabnews.com.br/api/v1/contents";
  private readonly PER_PAGE = 30; // Items per page from TabNews API
  private fetchLocks: Map<number, Promise<NewsItem[]>> = new Map(); // Lock per page

  constructor(
    @inject(CacheService) private cacheService: CacheService,
    @inject(LoggerService) private logger: LoggerService,
    @inject(TechScoringService) private techScoringService: TechScoringService,
  ) {}

  /**
   * Fetches a single page of TabNews content with lock protection
   * @param page - Page number to fetch (1-indexed)
   * @returns Array of filtered NewsItems from that page
   */
  async fetchPage(page: number): Promise<NewsItem[]> {
    // Check cache first
    const cacheKey = `${CacheKey.TabNews}:page:${page}`;
    const cached = await this.cacheService.get<NewsItem[]>(cacheKey);
    if (cached) {
      this.logger.info(`TabNews page ${page} served from cache`);
      return cached;
    }

    // Check if there's already a fetch in progress for this page
    const existingLock = this.fetchLocks.get(page);
    if (existingLock) {
      this.logger.info(
        `TabNews page ${page} fetch already in progress, waiting...`,
      );
      return existingLock;
    }

    // Create new fetch promise with lock
    const fetchPromise = this.doFetchPage(page);
    this.fetchLocks.set(page, fetchPromise);

    try {
      const result = await fetchPromise;
      return result;
    } finally {
      this.fetchLocks.delete(page);
    }
  }

  private async doFetchPage(page: number): Promise<NewsItem[]> {
    this.logger.info(`Fetching TabNews page ${page}...`);

    const res = await fetch(
      `${this.TABNEWS_API}?strategy=relevant&page=${page}&per_page=${this.PER_PAGE}`,
    );

    if (!res.ok) {
      this.logger.error(`Failed to fetch TabNews page ${page}`);
      return [];
    }

    const data = (await res.json()) as TabNewsItem[];

    if (data.length === 0) {
      this.logger.info(`TabNews page ${page} is empty`);
      return [];
    }

    // Map to NewsItem
    const mapped = data.map((item) => ({
      id: item.id,
      title: item.title,
      author: item.owner_username,
      score: item.tabcoins,
      publishedAt: item.published_at,
      source: Source.TabNews,
      slug: item.slug,
      owner_username: item.owner_username,
      body: item.body,
      sourceUrl: item.source_url,
      commentsUrl: `https://www.tabnews.com.br/${item.owner_username}/${item.slug}`,
      commentCount: item.children_deep_count,
    }));

    const withScores = await this.techScoringService.attachCachedScores(mapped, "");
    const filtered = this.techScoringService.filterByScore(withScores);
    this.techScoringService.scoreInBackground(withScores, "");

    this.logger.info(
      `TabNews page ${page}: ${filtered.length}/${mapped.length} posts are tech-related`,
    );

    // Cache this page for 5 minutes
    const cacheKey = `${CacheKey.TabNews}:page:${page}`;
    await this.cacheService.set(cacheKey, filtered);
    return filtered;
  }

  /**
   * Legacy method for backward compatibility - fetches first page only
   * @deprecated Use fetchPage() instead for better control
   */
  async fetchNews(): Promise<NewsItem[]> {
    return this.fetchPage(1);
  }


}

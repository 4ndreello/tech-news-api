import { inject, singleton } from "tsyringe";
import type { HackerNewsItem, NewsItem } from "../types";
import { CacheKey, Source } from "../types";
import { CacheService } from "./cache.service";
import { LoggerService } from "./logger.service";
import { TechScoringService } from "./tech-scoring.service";
import { LinkScraperService } from "./link-scraper.service";

@singleton()
export class HackerNewsService {
  private readonly HN_BASE_URL = "https://hacker-news.firebaseio.com/v0";
  private readonly BATCH_SIZE = 30; // Items per batch
  private fetchLocks: Map<number, Promise<NewsItem[]>> = new Map(); // Lock per batch
  private topStoriesIds: number[] | null = null; // Cache all IDs
  private topStoriesIdsFetchLock: Promise<number[]> | null = null;

  constructor(
    @inject(CacheService) private cacheService: CacheService,
    @inject(LoggerService) private logger: LoggerService,
    @inject(TechScoringService) private techScoringService: TechScoringService,
    @inject(LinkScraperService) private linkScraperService: LinkScraperService,
  ) {}

  /**
   * Fetches all top stories IDs from HackerNews (cached in memory)
   */
  private async fetchTopStoriesIds(): Promise<number[]> {
    // Check memory cache first
    if (this.topStoriesIds) {
      return this.topStoriesIds;
    }

    // Check if fetch is already in progress
    if (this.topStoriesIdsFetchLock) {
      return this.topStoriesIdsFetchLock;
    }

    // Create fetch promise with lock
    this.topStoriesIdsFetchLock = (async () => {
      const idsRes = await fetch(`${this.HN_BASE_URL}/topstories.json`);
      if (!idsRes.ok) {
        throw new Error("Falha ao carregar IDs do Hacker News");
      }
      const ids = (await idsRes.json()) as number[];
      this.topStoriesIds = ids;
      this.logger.info(`Loaded ${ids.length} top story IDs from HackerNews`);
      return ids;
    })();

    try {
      const result = await this.topStoriesIdsFetchLock;
      return result;
    } finally {
      this.topStoriesIdsFetchLock = null;
    }
  }

  /**
   * Fetches a batch of HackerNews stories
   * @param batch - Batch number (0-indexed: 0 = items 0-29, 1 = items 30-59, etc.)
   * @returns Array of filtered NewsItems from that batch
   */
  async fetchBatch(batch: number): Promise<NewsItem[]> {
    // Check cache first
    const cacheKey = `${CacheKey.HackerNews}:batch:${batch}`;
    const cached = await this.cacheService.get<NewsItem[]>(cacheKey);
    if (cached) {
      this.logger.info(`HackerNews batch ${batch} served from cache`);
      return cached;
    }

    // Check if there's already a fetch in progress for this batch
    const existingLock = this.fetchLocks.get(batch);
    if (existingLock) {
      this.logger.info(
        `HackerNews batch ${batch} fetch already in progress, waiting...`,
      );
      return existingLock;
    }

    // Create new fetch promise with lock
    const fetchPromise = this.doFetchBatch(batch);
    this.fetchLocks.set(batch, fetchPromise);

    try {
      const result = await fetchPromise;
      return result;
    } finally {
      this.fetchLocks.delete(batch);
    }
  }

  private async doFetchBatch(batch: number): Promise<NewsItem[]> {
    this.logger.info(`Fetching HackerNews batch ${batch}...`);

    // Get all top stories IDs
    const allIds = await this.fetchTopStoriesIds();

    // Calculate batch range
    const startIdx = batch * this.BATCH_SIZE;
    const endIdx = startIdx + this.BATCH_SIZE;
    const batchIds = allIds.slice(startIdx, endIdx);

    if (batchIds.length === 0) {
      this.logger.info(`HackerNews batch ${batch} is empty (out of range)`);
      return [];
    }

    this.logger.info(
      `Fetching ${batchIds.length} stories from HackerNews batch ${batch}...`,
    );

    // Fetch all items in this batch in parallel
    const itemPromises = batchIds.map((id) =>
      fetch(`${this.HN_BASE_URL}/item/${id}.json`).then((res) => res.json()),
    );

    const itemsRaw = (await Promise.all(itemPromises)) as HackerNewsItem[];

    // Filter out dead/flagged posts
    const filtered = itemsRaw.filter(
      (item) =>
        item &&
        item.title &&
        !item.title.startsWith("[dead]") &&
        !item.title.startsWith("[flagged]"),
    );

    // Map to NewsItem
    const mapped = filtered.map((item) => {
      const commentsUrl = `https://news.ycombinator.com/item?id=${item.id}`;
      const url = item.url || commentsUrl;

      return {
        id: String(item.id),
        title: item.title,
        author: item.by,
        score: item.score,
        publishedAt: new Date(item.time * 1000).toISOString(),
        source: Source.HackerNews,
        url,
        commentsUrl,
        commentCount: item.descendants || 0,
        body: item.text
          ? this.linkScraperService.extractTextFromHTML(item.text)
          : undefined,
      };
    });

    const withScores = await this.techScoringService.attachCachedScores(mapped, "hn:");
    const techFiltered = this.techScoringService.filterByScore(withScores);
    this.techScoringService.scoreInBackground(withScores, "hn:");

    this.logger.info(
      `HackerNews batch ${batch}: ${techFiltered.length}/${mapped.length} posts are tech-related`,
    );

    // Cache this batch for 5 minutes
    const cacheKey = `${CacheKey.HackerNews}:batch:${batch}`;
    await this.cacheService.set(cacheKey, techFiltered);
    return techFiltered;
  }

  /**
   * Legacy method for backward compatibility - fetches first batch only
   * @deprecated Use fetchBatch() instead for better control
   */
  async fetchNews(): Promise<NewsItem[]> {
    return this.fetchBatch(0);
  }

}

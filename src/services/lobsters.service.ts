import { inject, singleton } from "tsyringe";
import { CacheService } from "./cache.service";
import { LoggerService } from "./logger.service";
import { RankingService } from "./ranking.service";
import { CacheKey, Source, type LobstersItem, type NewsItem } from "../types";

const LOBSTERS_API = "https://lobste.rs/hottest.json";

@singleton()
export class LobstersService {
  constructor(
    @inject(CacheService) private cacheService: CacheService,
    @inject(RankingService) private rankingService: RankingService,
    @inject(LoggerService) private logger: LoggerService
  ) {}

  /**
   * Fetches hottest stories from Lobsters
   * Uses cache to avoid rate limiting
   */
  async fetchNews(): Promise<NewsItem[]> {
    // Check cache first
    const cached = await this.cacheService.get<NewsItem[]>(CacheKey.Lobsters);
    if (cached) {
      this.logger.info("returning cached Lobsters stories", {
        count: cached.length,
      });
      return cached;
    }

    this.logger.info("fetching Lobsters hottest stories");

    try {
      const response = await fetch(LOBSTERS_API);

      if (!response.ok) {
        throw new Error(`Lobsters API error: ${response.status}`);
      }

      const items = (await response.json()) as LobstersItem[];

      // Transform to NewsItem format and calculate ranking
      const newsItems: NewsItem[] = items.map((item) => {
        const newsItem: NewsItem = {
          id: `lobsters-${item.short_id}`,
          title: item.title,
          author: item.submitter_user,
          score: item.score,
          publishedAt: item.created_at,
          source: Source.Lobsters,
          url: item.url || item.short_id_url, // Use short_id_url for text posts
          sourceUrl: item.short_id_url,
          commentCount: item.comment_count,
        };

        // Apply ranking algorithm
        newsItem.score = this.rankingService.calculateRank(newsItem);

        return newsItem;
      });

      // Sort by calculated rank
      newsItems.sort((a, b) => b.score - a.score);

      this.logger.info("fetched and ranked Lobsters stories", {
        count: newsItems.length,
      });

      // Cache results
      await this.cacheService.set(CacheKey.Lobsters, newsItems);

      return newsItems;
    } catch (error) {
      this.logger.error("failed to fetch Lobsters", {
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }
}

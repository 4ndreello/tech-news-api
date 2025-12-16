import { inject, singleton } from "tsyringe";
import type { HackerNewsItem, NewsItem } from "../types";
import { CacheKey, Source } from "../types";
import { CacheService } from "./cache.service";
import { GeminiService } from "./gemini.service";
import { LoggerService } from "./logger.service";

@singleton()
export class HackerNewsService {
  private readonly HN_BASE_URL = "https://hacker-news.firebaseio.com/v0";
  private readonly MIN_TECH_SCORE = 61; // Minimum score to consider tech-related
  private fetchLock: Promise<NewsItem[]> | null = null;

  constructor(
    @inject(CacheService) private cacheService: CacheService,
    @inject(GeminiService) private geminiService: GeminiService,
    @inject(LoggerService) private logger: LoggerService,
  ) {}

  /**
   * Strips HTML tags from text
   */
  private stripHtml(html: string): string {
    return html
      .replace(/<[^>]*>/g, "") // Remove HTML tags
      .replace(/&quot;/g, '"')
      .replace(/&amp;/g, "&")
      .replace(/&lt;/g, "<")
      .replace(/&gt;/g, ">")
      .replace(/&#x27;/g, "'")
      .replace(/&#x2F;/g, "/")
      .trim();
  }

  async fetchNews(): Promise<NewsItem[]> {
    const cached = await this.cacheService.get<NewsItem[]>(CacheKey.HackerNews);
    if (cached) return cached;

    if (this.fetchLock) {
      return this.fetchLock;
    }

    this.fetchLock = this.doFetch();

    try {
      const result = await this.fetchLock;
      return result;
    } finally {
      this.fetchLock = null;
    }
  }

  private async doFetch(): Promise<NewsItem[]> {
    const idsRes = await fetch(`${this.HN_BASE_URL}/topstories.json`);
    if (!idsRes.ok) throw new Error("Falha ao carregar IDs do Hacker News");
    const ids = (await idsRes.json()) as number[];

    const topIds = ids.slice(0, 100);

    const itemPromises = topIds.map((id) =>
      fetch(`${this.HN_BASE_URL}/item/${id}.json`).then((res) => res.json()),
    );

    const itemsRaw = (await Promise.all(itemPromises)) as HackerNewsItem[];

    this.logger.info(
      `Fetched ${itemsRaw.length} posts from HackerNews, analyzing with AI...`,
    );

    const filtered = itemsRaw.filter(
      (item) =>
        item &&
        item.title &&
        !item.title.startsWith("[dead]") &&
        !item.title.startsWith("[flagged]"),
    );

    const mapped = filtered.map((item) => ({
      id: String(item.id),
      title: item.title,
      author: item.by,
      score: item.score,
      publishedAt: new Date(item.time * 1000).toISOString(),
      source: Source.HackerNews,
      url: item.url || `https://news.ycombinator.com/item?id=${item.id}`,
      commentCount: item.descendants || 0,
      body: item.text ? this.stripHtml(item.text) : undefined,
    }));

    // Filter by tech relevance using AI (parallel analysis)
    const techFiltered = await this.filterByTechRelevance(mapped);

    this.logger.info(
      `AI filtered: ${techFiltered.length}/${mapped.length} HN posts are tech-related`,
    );

    await this.cacheService.set(CacheKey.HackerNews, techFiltered);
    return techFiltered;
  }

  /**
   * Filters news items by tech relevance using AI analysis
   * Uses cached scores when available to reduce API calls
   * Adds techScore to each NewsItem for use in ranking
   */
  private async filterByTechRelevance(items: NewsItem[]): Promise<NewsItem[]> {
    const analysisPromises = items.map(async (item) => {
      // Check if we have cached score for this post
      const cacheKey = `tech-score:hn:${item.id}`;
      const cachedScore = await this.cacheService.get<number>(cacheKey);

      let score: number;
      if (cachedScore !== null) {
        score = cachedScore;
      } else {
        // Analyze with AI (title + body if available)
        score = await this.geminiService.analyzeTechRelevance(
          item.title,
          item.body || "",
        );

        // Cache score for 24 hours (86400 seconds)
        await this.cacheService.set(cacheKey, score, 86400);
      }

      return { item, score };
    });

    // Wait for all analyses to complete
    const results = await Promise.all(analysisPromises);

    // Filter items with score >= MIN_TECH_SCORE and attach techScore to each item
    const filtered = results
      .filter(({ score }) => score >= this.MIN_TECH_SCORE)
      .map(({ item, score }) => ({
        ...item,
        techScore: score, // Add AI score to NewsItem for ranking
      }));

    return filtered;
  }
}

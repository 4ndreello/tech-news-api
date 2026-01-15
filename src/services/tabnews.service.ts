import { singleton, inject } from "tsyringe";
import type { NewsItem, TabNewsItem, Comment } from "../types";
import { Source, CacheKey } from "../types";
import { CacheService } from "./cache.service";
import { GeminiService } from "./gemini.service";
import { capScoreForCodeHostingSites } from "../utils/scoring";
import { LoggerService } from "./logger.service";

@singleton()
export class TabNewsService {
  private readonly TABNEWS_API = "https://www.tabnews.com.br/api/v1/contents";
  private readonly MIN_TECH_SCORE = 61; // Minimum score to consider tech-related
  private readonly PER_PAGE = 30; // Items per page from TabNews API
  private fetchLocks: Map<number, Promise<NewsItem[]>> = new Map(); // Lock per page

  constructor(
    @inject(CacheService) private cacheService: CacheService,
    @inject(GeminiService) private geminiService: GeminiService,
    @inject(LoggerService) private logger: LoggerService,
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
      commentCount: item.children_deep_count,
    }));

    // Filter by tech relevance using AI
    const filtered = await this.filterByTechRelevance(mapped);

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

  /**
   * Filters news items by tech relevance using AI analysis
   * Uses cached scores when available to reduce API calls
   */
  private async filterByTechRelevance(items: NewsItem[]): Promise<NewsItem[]> {
    const analysisPromises = items.map(async (item) => {
      // Check if we have cached score for this post
      const cacheKey = `tech-score:${item.id}`;
      const cachedScore = await this.cacheService.get<number>(cacheKey);

      let score: number;
      if (cachedScore !== null) {
        score = cachedScore;
      } else {
        this.logger.info("analyzing tech relevance with AI (tabnews)");
        // Analyze with AI
        const tempScore = await this.geminiService.analyzeTechRelevance(
          item.title,
          item.body || "",
        );

        // Cap score for code hosting sites
        score = capScoreForCodeHostingSites(tempScore, item.sourceUrl);

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

  async fetchComments(username: string, slug: string): Promise<Comment[]> {
    const cacheKey = `${CacheKey.TabNewsComments}:${username}:${slug}`;
    const cached = await this.cacheService.get<Comment[]>(cacheKey);
    if (cached) return cached;

    const res = await fetch(`${this.TABNEWS_API}/${username}/${slug}/children`);
    if (!res.ok) throw new Error("Falha ao carregar comentários");
    const comments = (await res.json()) as Comment[];

    await this.cacheService.set(cacheKey, comments);
    return comments;
  }
}

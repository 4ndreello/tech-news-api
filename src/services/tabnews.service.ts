import { singleton, inject } from "tsyringe";
import type { NewsItem, TabNewsItem, Comment } from "../types";
import { Source, CacheKey } from "../types";
import { CacheService } from "./cache.service";
import { GeminiService } from "./gemini.service";
import { LoggerService } from "./logger.service";

@singleton()
export class TabNewsService {
  private readonly TABNEWS_API = "https://www.tabnews.com.br/api/v1/contents";
  private readonly MIN_TECH_SCORE = 61; // Minimum score to consider tech-related
  private fetchLock: Promise<NewsItem[]> | null = null;

  constructor(
    @inject(CacheService) private cacheService: CacheService,
    @inject(GeminiService) private geminiService: GeminiService,
    @inject(LoggerService) private logger: LoggerService,
  ) {}

  async fetchNews(): Promise<NewsItem[]> {
    const cached = await this.cacheService.get<NewsItem[]>(CacheKey.TabNews);
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
    const res = await fetch(`${this.TABNEWS_API}?strategy=relevant`);
    if (!res.ok) throw new Error("Falha ao carregar TabNews");
    const data = (await res.json()) as TabNewsItem[];

    this.logger.info(
      `Fetched ${data.length} posts from TabNews, analyzing with AI...`,
    );

    // Map to NewsItem first
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

    // Filter by tech relevance using AI (parallel analysis)
    const filtered = await this.filterByTechRelevance(mapped);

    this.logger.info(
      `AI filtered: ${filtered.length}/${mapped.length} posts are tech-related`,
    );

    await this.cacheService.set(CacheKey.TabNews, filtered);
    return filtered;
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

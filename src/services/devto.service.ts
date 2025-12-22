import { inject, singleton } from "tsyringe";
import type { ArticleWithAuthor, DevToArticle, NewsItem } from "../types";
import { Source, CacheKey } from "../types";
import { LoggerService } from "./logger.service";
import { GeminiService } from "./gemini.service";
import { CacheService } from "./cache.service";

@singleton()
export class DevToService {
  private readonly API_URL = "https://dev.to/api";
  private readonly apiKey: string | undefined;
  private readonly MIN_TECH_SCORE = 61; // Minimum score to consider tech-related

  constructor(
    @inject(LoggerService) private logger: LoggerService,
    @inject(GeminiService) private geminiService: GeminiService,
    @inject(CacheService) private cacheService: CacheService
  ) {
    this.apiKey = process.env.DEV_TO_KEY;

    if (this.apiKey) {
      this.logger.info("Dev.to service initialized with API key");
    } else {
      this.logger.warn(
        "Dev.to service initialized without API key (read-only mode)"
      );
    }
  }

  async fetchRecentArticles(perPage = 30): Promise<ArticleWithAuthor[]> {
    try {
      const headers: Record<string, string> = {
        "Content-Type": "application/json",
      };

      // Add API key if available (not required for public endpoints)
      if (this.apiKey) {
        headers["api-key"] = this.apiKey;
      }

      // Fetch latest articles with tech tags
      const response = await fetch(
        `${this.API_URL}/articles?per_page=${perPage}&top=7&tags=javascript,typescript,webdev,programming,react`,
        { headers }
      );

      if (!response.ok) {
        throw new Error(
          `Dev.to API error: ${response.status} ${response.statusText}`
        );
      }

      const articles: DevToArticle[] =
        (await response.json()) as DevToArticle[];

      this.logger.info("fetched articles from Dev.to", {
        totalFetched: articles.length,
      });

      return articles.map((article) => ({
        article,
        username: article.user.username,
      }));
    } catch (error) {
      this.logger.error("error fetching Dev.to articles", {
        error: error instanceof Error ? error.message : String(error),
      });
      return [];
    }
  }

  // Filter articles by engagement (reactions)
  filterByEngagement(articles: ArticleWithAuthor[]): ArticleWithAuthor[] {
    const MIN_REACTIONS = Number(process.env.DEVTO_MIN_REACTIONS) || 5;
    const MIN_COMMENTS = Number(process.env.DEVTO_MIN_COMMENTS) || 2;

    const filtered = articles.filter((articleWithAuthor) => {
      const { positive_reactions_count, comments_count } =
        articleWithAuthor.article;
      return (
        positive_reactions_count >= MIN_REACTIONS &&
        comments_count >= MIN_COMMENTS
      );
    });

    return filtered;
  }

  filterArticleReadingTime(articles: ArticleWithAuthor[]): ArticleWithAuthor[] {
    return articles.filter((articleWithAuthor) => {
      const readingTimeTooBig =
        articleWithAuthor.article.reading_time_minutes > 15;

      return !readingTimeTooBig;
    });
  }

  /**
   * Fetch Dev.to articles as NewsItem[] to integrate with the news feed
   */
  async fetchNews(): Promise<NewsItem[]> {
    // check cache first
    const cached = await this.cacheService.get<NewsItem[]>(CacheKey.DevTo);
    if (cached) {
      this.logger.info("returning cached Dev.to articles", {
        count: cached.length,
      });
      return cached;
    }

    try {
      // Fetch articles (limit to ~30 like other sources)
      const articles = await this.fetchRecentArticles(30);

      // Apply filters
      const filtered = this.filterArticleReadingTime(articles);

      this.logger.info("fetched and filtered Dev.to articles for news", {
        totalFetched: articles.length,
        afterFilter: filtered.length,
      });

      // Convert to NewsItem format
      const newsItems: NewsItem[] = filtered.map((articleWithAuthor) => {
        const { article } = articleWithAuthor;

        // Calculate score based on reactions and comments
        // Weight reactions more heavily than comments
        const score =
          article.positive_reactions_count * 2 + article.comments_count * 5;

        return {
          id: `devto-${article.id}`,
          title: article.title,
          author: article.user.username,
          score,
          publishedAt: article.published_at,
          source: Source.DevTo,
          url: article.url,
          sourceUrl: article.canonical_url,
          body: article.description,
          commentCount: article.comments_count,
        };
      });

      // Filter by tech relevance using AI
      const techFiltered = await this.filterByTechRelevance(newsItems);

      this.logger.info(
        `Dev.to: ${techFiltered.length}/${newsItems.length} articles are tech-related`
      );

      // cache results
      await this.cacheService.set(CacheKey.DevTo, techFiltered);

      return techFiltered;
    } catch (error) {
      this.logger.error("error fetching Dev.to news", {
        error: error instanceof Error ? error.message : String(error),
      });
      return [];
    }
  }

  /**
   * Filters news items by tech relevance using AI analysis
   * Uses cached scores when available to reduce API calls
   */
  private async filterByTechRelevance(items: NewsItem[]): Promise<NewsItem[]> {
    const analysisPromises = items.map(async (item) => {
      // Check if we have cached score for this post
      const cacheKey = `tech-score:devto:${item.id}`;
      const cachedScore = await this.cacheService.get<number>(cacheKey);

      let score: number;
      if (cachedScore !== null) {
        score = cachedScore;
      } else {
        // Analyze with AI (title + body if available)
        score = await this.geminiService.analyzeTechRelevance(
          item.title,
          item.body || ""
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

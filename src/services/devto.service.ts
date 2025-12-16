import { inject, singleton } from "tsyringe";
import type { ArticleWithAuthor, DevToArticle, NewsItem } from "../types";
import { Source } from "../types";
import { LoggerService } from "./logger.service";

@singleton()
export class DevToService {
  private readonly API_URL = "https://dev.to/api";
  private readonly apiKey: string | undefined;

  constructor(@inject(LoggerService) private logger: LoggerService) {
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
    try {
      // Fetch articles
      const articles = await this.fetchRecentArticles(100);

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

      this.logger.info("converted Dev.to articles to news items", {
        count: newsItems.length,
      });

      return newsItems;
    } catch (error) {
      this.logger.error("error fetching Dev.to news", {
        error: error instanceof Error ? error.message : String(error),
      });
      return [];
    }
  }
}

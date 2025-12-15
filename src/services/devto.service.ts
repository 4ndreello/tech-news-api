import { inject, singleton } from "tsyringe";
import type { ArticleWithAuthor, DevToArticle } from "../types";
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
}

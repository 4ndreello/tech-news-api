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
      this.logger.warn("Dev.to service initialized without API key (read-only mode)");
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

      const articles: DevToArticle[] = await response.json() as DevToArticle[];

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
    const MIN_REACTIONS = Number(process.env.DEVTO_MIN_REACTIONS) || 10;
    const MIN_COMMENTS = Number(process.env.DEVTO_MIN_COMMENTS) || 2;

    const filtered = articles.filter((articleWithAuthor) => {
      const { positive_reactions_count, comments_count } =
        articleWithAuthor.article;
      return (
        positive_reactions_count >= MIN_REACTIONS &&
        comments_count >= MIN_COMMENTS
      );
    });

    this.logger.info("filterByEngagement result (Dev.to)", {
      before: articles.length,
      after: filtered.length,
      minReactions: MIN_REACTIONS,
      minComments: MIN_COMMENTS,
    });

    return filtered;
  }

  // Filter articles from last 7 days
  filterRecent(articles: ArticleWithAuthor[]): ArticleWithAuthor[] {
    const DAYS_7 = 7 * 24 * 60 * 60 * 1000;
    const now = Date.now();

    return articles.filter((articleWithAuthor) => {
      const articleTime = new Date(
        articleWithAuthor.article.published_at
      ).getTime();
      const age = now - articleTime;
      return age <= DAYS_7;
    });
  }

  // Filter spam/low quality content
  filterQuality(articles: ArticleWithAuthor[]): ArticleWithAuthor[] {
    const SPAM_KEYWORDS = [
      "free course",
      "click here",
      "buy now",
      "limited time",
      "follow me",
    ];

    return articles.filter((articleWithAuthor) => {
      const titleLower = articleWithAuthor.article.title.toLowerCase();
      const descLower = (
        articleWithAuthor.article.description || ""
      ).toLowerCase();
      const content = `${titleLower} ${descLower}`;

      const hasSpamKeyword = SPAM_KEYWORDS.some((keyword) =>
        content.includes(keyword)
      );

      // Filter out very short articles (less than 3 min read)
      const isTooShort = articleWithAuthor.article.reading_time_minutes < 3;

      return !hasSpamKeyword && !isTooShort;
    });
  }
}

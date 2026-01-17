import { inject, singleton } from "tsyringe";
import { TwitterApi } from "twitter-api-v2";
import { Source, CacheKey } from "../types";
import type { NewsItem } from "../types";
import { LoggerService } from "./logger.service";
import { DataWarehouseService } from "./data-warehouse.service";

@singleton()
export class TwitterService {
  private client: TwitterApi;
  private readonly FETCH_INTERVAL_MS = 8 * 60 * 60 * 1000; // 8 hours
  private readonly DEFAULT_TARGET_USERS = [
    "tabnews_br",
    "filipedeschamps",
    "diego3g",
    "akitaonrails",
    "sseraphini",
    "htmx_org",
    "ThePrimeagen",
    "fireship_dev",
    "techtangents",
    "shadcn",
    "levelsio",
    "nutlope",
  ];

  constructor(
    @inject(LoggerService) private logger: LoggerService,
    @inject(DataWarehouseService) private warehouse: DataWarehouseService
  ) {
    const bearerToken = process.env.TWITTER_BEARER_TOKEN;

    if (bearerToken) {
      this.client = new TwitterApi(bearerToken);
      this.logger.info("Twitter client initialized with Bearer Token");
    } else {
      this.logger.warn(
        "TWITTER_BEARER_TOKEN not found. Twitter service will fail if called."
      );
      // Initialize with empty to avoid crash, but methods will check
      this.client = new TwitterApi("");
    }
  }

  async fetchNews(): Promise<NewsItem[]> {
    if (!process.env.TWITTER_BEARER_TOKEN) {
      this.logger.warn("Skipping Twitter fetch: No token provided");
      return [];
    }

    // 1. Safety Lock Check
    const lastFetch = await this.warehouse.getLastFetchTime(Source.Twitter);
    const now = Date.now();
    const timeSinceLastFetch = lastFetch ? now - lastFetch.getTime() : Infinity;

    if (timeSinceLastFetch < this.FETCH_INTERVAL_MS) {
      this.logger.info(
        `Twitter Safety Lock Active: Last fetch was ${(
          timeSinceLastFetch /
          (1000 * 60 * 60)
        ).toFixed(2)}h ago. Skipping API call.`
      );

      // Attempt to retrieve from Cache/Warehouse fallback
      return this.getFallbackData();
    }

    // 2. Sniper Fetch (Unified Query)
    return this.executeUnifiedFetch();
  }

  private async executeUnifiedFetch(): Promise<NewsItem[]> {
    try {
      const targetUsers = process.env.TWITTER_TARGET_USERS
        ? process.env.TWITTER_TARGET_USERS.split(",").map((u) => u.trim())
        : this.DEFAULT_TARGET_USERS;

      // Construct Query: (from:user1 OR from:user2) OR (#hashtag1 OR #hashtag2) -is:retweet -is:reply
      const fromPart = targetUsers.map((u) => `from:${u}`).join(" OR ");
      
      // Optional: Add high-signal hashtags if configured
      // const targetHashtags = ["#rustlang", "#golang"];
      // const tagPart = targetHashtags.map(t => t).join(" OR ");
      // const query = `(${fromPart} OR ${tagPart}) -is:retweet -is:reply`;
      
      const query = `(${fromPart}) -is:retweet -is:reply`;

      this.logger.info("Executing Twitter Sniper Fetch", {
        queryLength: query.length,
        userCount: targetUsers.length,
      });

      const items = await this.client.v2.search(query, {
        "tweet.fields": ["created_at", "public_metrics", "author_id"],
        "user.fields": ["username", "name", "profile_image_url"],
        expansions: ["author_id"],
        max_results: 30, // Hard limit to save bandwidth/quota
      });

      const newsItems: NewsItem[] = [];
      const users = items.includes?.users || [];

      for await (const tweet of items) {
        const author = users.find((u) => u.id === tweet.author_id);
        const username = author?.username || "unknown";
        const name = author?.name || username;

        const newsItem: NewsItem = {
          id: tweet.id,
          title: tweet.text, // Tweet text as title
          body: tweet.text,
          author: `${name} (@${username})`,
          source: Source.Twitter,
          score: tweet.public_metrics?.like_count || 0,
          publishedAt: tweet.created_at || new Date().toISOString(),
          url: `https://twitter.com/${username}/status/${tweet.id}`,
          sourceUrl: `https://twitter.com/${username}/status/${tweet.id}`,
          owner_username: username,
          commentCount: tweet.public_metrics?.reply_count || 0,
        };

        newsItems.push(newsItem);
      }

      this.logger.info(`Fetched ${newsItems.length} tweets successfully`);
      return newsItems;
    } catch (error) {
      this.logger.error("Error in Twitter Sniper Fetch", {
        error: error instanceof Error ? error.message : String(error),
      });

      // On failure, try fallback
      return this.getFallbackData();
    }
  }

  private async getFallbackData(): Promise<NewsItem[]> {
    try {
      // Try L2 Cache first (via CacheService, though SmartMix usually handles this)
      // Since SmartMix logic calls this service when L1/L2 expires,
      // we might want to look directly at Warehouse or just return what we have.

      // Let's query the Warehouse for the most recent tweets (last 48h)
      const endDate = new Date();
      const startDate = new Date(endDate.getTime() - 48 * 60 * 60 * 1000); // 48h

      this.logger.info("Fetching Twitter fallback data from Warehouse");
      const fallbackItems = await this.warehouse.getRawNewsBySourceAndDate(
        Source.Twitter,
        startDate,
        endDate
      );

      // Deduplicate by ID just in case
      const uniqueItems = Array.from(
        new Map(fallbackItems.map((item) => [item.id, item])).values()
      );

      this.logger.info(`Retrieved ${uniqueItems.length} tweets from fallback`);
      return uniqueItems;
    } catch (error) {
      this.logger.error("Error fetching Twitter fallback data", { error });
      return [];
    }
  }
}

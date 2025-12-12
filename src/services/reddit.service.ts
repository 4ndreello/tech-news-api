import { singleton } from "tsyringe";
import { logger } from "../logger";
import type { RedditPost, RedditResponse } from "../types";

@singleton()
export class RedditService {
  private readonly USER_AGENT = "TechNewsAPI/1.0";
  private readonly SUBREDDITS = [
    "programming",
    "webdev",
    "javascript",
    "reactjs",
    "typescript",
  ];

  async fetchHotPosts(limit = 50): Promise<RedditPost[]> {
    const allPosts: RedditPost[] = [];

    for (const subreddit of this.SUBREDDITS) {
      try {
        const posts = await this.fetchSubreddit(subreddit, limit);
        logger.info(`Fetched ${posts.length} posts from r/${subreddit}`, {
          subreddit,
          fetched: posts.length,
        });
        allPosts.push(...posts);
      } catch (error) {
        // Use structured logger instead of console.error
        logger.error(`Error fetching r/${subreddit}`, {
          subreddit,
          error: error instanceof Error ? error.message : String(error),
        });
        // Continue with other subreddits even if one fails
      }
    }

    logger.info("Completed fetching subreddits", {
      totalFetched: allPosts.length,
      subredditsQueried: this.SUBREDDITS.length,
    });
    return allPosts;
  }

  private async fetchSubreddit(
    subreddit: string,
    limit: number,
  ): Promise<RedditPost[]> {
    const url = `https://www.reddit.com/r/${subreddit}/hot.json?limit=${limit}`;

    const response = await fetch(url, {
      headers: {
        "User-Agent": this.USER_AGENT,
      },
    });

    if (!response.ok) {
      throw new Error(
        `Reddit API error for r/${subreddit}: ${response.status} ${response.statusText}`,
      );
    }

    const data: RedditResponse = (await response.json()) as RedditResponse;
    logger.info(`r/${subreddit} returned ${data.data.children.length} posts`, {
      subreddit,
      count: data.data.children.length,
    });
    return data.data.children;
  }

  // Filter posts by engagement thresholds
  filterByEngagement(posts: RedditPost[]): RedditPost[] {
    // Lower defaults for easier testing; can be overridden via env vars
    const MIN_SCORE = Number(process.env.REDDIT_MIN_SCORE) || 100;
    const MIN_COMMENTS = Number(process.env.REDDIT_MIN_COMMENTS) || 10;

    const filtered = posts.filter((post) => {
      const score = post.data.score;
      const comments = post.data.num_comments;
      const isNSFW = post.data.over_18;

      return score >= MIN_SCORE && comments >= MIN_COMMENTS && !isNSFW;
    });

    logger.info("filterByEngagement result", {
      before: posts.length,
      after: filtered.length,
      minScore: MIN_SCORE,
      minComments: MIN_COMMENTS,
    });

    return filtered;
  }

  // Remove spam, memes, and self-promotion
  filterSpam(posts: RedditPost[]): RedditPost[] {
    const SPAM_KEYWORDS = [
      "looking for feedback",
      "check out my",
      "i made this",
      "self-promotion",
      "ama request",
      "shower thought",
    ];

    return posts.filter((post) => {
      const titleLower = post.data.title.toLowerCase();
      const hasSpamKeyword = SPAM_KEYWORDS.some((keyword) =>
        titleLower.includes(keyword),
      );

      // Filter out image/video posts (we want discussions)
      const isMedia =
        post.data.url.includes("i.redd.it") ||
        post.data.url.includes("v.redd.it") ||
        post.data.url.includes("imgur.com");

      return !hasSpamKeyword && !isMedia;
    });
  }

  // Filter posts from last 48 hours
  filterRecent(posts: RedditPost[]): RedditPost[] {
    const HOURS_48 = 48 * 60 * 60 * 1000;
    const now = Date.now();

    return posts.filter((post) => {
      const postTime = post.data.created_utc * 1000; // Convert to milliseconds
      const age = now - postTime;
      return age <= HOURS_48;
    });
  }
}

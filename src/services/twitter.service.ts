import { inject, singleton } from "tsyringe";
import { TwitterApi } from "twitter-api-v2";
import type { TweetWithAuthor, TwitterTweet, TwitterUser } from "../types";
import { LoggerService } from "./logger.service";

@singleton()
export class TwitterService {
  private client: TwitterApi;

  // Tech influencers and official accounts to follow
  // Reduced to avoid rate limits on Free Tier
  private readonly TECH_ACCOUNTS = ["vercel", "dhh"];

  // Tech hashtags to search (DISABLED to avoid rate limits)
  // private readonly TECH_HASHTAGS = [
  //   "#webdev",
  //   "#javascript",
  //   "#typescript",
  //   "#reactjs",
  //   "#programming",
  //   "#coding",
  // ];

  constructor(@inject(LoggerService) private logger: LoggerService) {
    const bearerToken = process.env.TWITTER_BEARER_TOKEN;
    const apiKey = process.env.TWITTER_API_KEY;
    const apiSecret = process.env.TWITTER_API_SECRET;

    // Prefer Bearer Token if available (better rate limits)
    if (bearerToken) {
      this.client = new TwitterApi(bearerToken);
      this.logger.info("Twitter client initialized with Bearer Token");
    } else if (apiKey && apiSecret) {
      // Fallback to App-only authentication
      this.client = new TwitterApi({
        appKey: apiKey,
        appSecret: apiSecret,
      });
      this.logger.info("Twitter client initialized with App-only auth");
    } else {
      throw new Error(
        "Twitter API credentials not found. Need either TWITTER_BEARER_TOKEN or TWITTER_API_KEY + TWITTER_API_SECRET",
      );
    }
  }

  async fetchRecentTweets(maxResults = 100): Promise<TweetWithAuthor[]> {
    const allTweets: TweetWithAuthor[] = [];

    try {
      // Use bearer token if already initialized, otherwise get app-only token
      const client = process.env.TWITTER_BEARER_TOKEN
        ? this.client
        : await this.client.appLogin();

      // Search recent tweets from tech accounts (reduced to 10 tweets each)
      for (const account of this.TECH_ACCOUNTS) {
        try {
          const tweets = await this.searchTweetsFromAccount(
            client,
            account,
            30,
          );
          this.logger.info(`fetched ${tweets.length} tweets from @${account}`, {
            account,
            fetched: tweets.length,
          });
          allTweets.push(...tweets);
        } catch (error) {
          this.logger.error(`error fetching tweets from @${account}`, {
            account,
            error: error instanceof Error ? error.message : String(error),
          });
          // Continue with other accounts
        }
      }

      // Hashtag search DISABLED to avoid rate limits
      // for (const hashtag of this.TECH_HASHTAGS) {
      //   try {
      //     const tweets = await this.searchTweetsByHashtag(client, hashtag, 15);
      //     this.logger.info(`fetched ${tweets.length} tweets for ${hashtag}`, {
      //       hashtag,
      //       fetched: tweets.length,
      //     });
      //     allTweets.push(...tweets);
      //   } catch (error) {
      //     this.logger.error(`error fetching tweets for ${hashtag}`, {
      //       hashtag,
      //       error: error instanceof Error ? error.message : String(error),
      //     });
      //     // Continue with other hashtags
      //   }
      // }

      // Remove duplicates based on tweet ID
      const uniqueTweets = Array.from(
        new Map(allTweets.map((t) => [t.tweet.id, t])).values(),
      );

      this.logger.info("completed fetching tweets", {
        totalFetched: uniqueTweets.length,
        accountsQueried: this.TECH_ACCOUNTS.length,
      });

      return uniqueTweets;
    } catch (error) {
      this.logger.error("error in fetchRecentTweets", {
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }

  private async searchTweetsFromAccount(
    client: TwitterApi,
    username: string,
    maxResults: number,
  ): Promise<TweetWithAuthor[]> {
    try {
      const response = await client.v2.search(`from:${username}`, {
        max_results: maxResults,
        "tweet.fields": [
          "created_at",
          "public_metrics",
          "entities",
          "referenced_tweets",
        ],
        "user.fields": ["username", "verified", "public_metrics"],
        expansions: ["author_id"],
      });

      const tweets: TweetWithAuthor[] = [];
      for await (const tweet of response) {
        tweets.push({
          tweet: tweet as TwitterTweet,
          username,
        });
      }

      return tweets;
    } catch (error) {
      this.logger.error(`search failed for @${username}`, {
        username,
        error: error instanceof Error ? error.message : String(error),
      });
      return [];
    }
  }

  private async searchTweetsByHashtag(
    client: TwitterApi,
    hashtag: string,
    maxResults: number,
  ): Promise<TweetWithAuthor[]> {
    try {
      const response = await client.v2.search(hashtag, {
        max_results: maxResults,
        "tweet.fields": [
          "created_at",
          "public_metrics",
          "entities",
          "referenced_tweets",
          "author_id",
        ],
        "user.fields": ["username", "verified", "public_metrics"],
        expansions: ["author_id"],
      });

      const tweets: TweetWithAuthor[] = [];
      const users = response.includes?.users || [];

      for await (const tweet of response) {
        // Find the author username from includes.users
        const author = users.find((u) => u.id === tweet.author_id);
        const username = author?.username || "unknown";

        tweets.push({
          tweet: tweet as TwitterTweet,
          username,
        });
      }

      return tweets;
    } catch (error) {
      this.logger.error(`search failed for ${hashtag}`, {
        hashtag,
        error: error instanceof Error ? error.message : String(error),
      });
      return [];
    }
  }

  // Filter tweets by engagement thresholds
  filterByEngagement(tweets: TweetWithAuthor[]): TweetWithAuthor[] {
    const MIN_LIKES = Number(process.env.TWITTER_MIN_LIKES) || 10;
    const MIN_RETWEETS = Number(process.env.TWITTER_MIN_RETWEETS) || 1;

    const filtered = tweets.filter((tweetWithAuthor) => {
      const { like_count, retweet_count } =
        tweetWithAuthor.tweet.public_metrics;
      return like_count >= MIN_LIKES && retweet_count >= MIN_RETWEETS;
    });

    this.logger.info("filterByEngagement result", {
      before: tweets.length,
      after: filtered.length,
      minLikes: MIN_LIKES,
      minRetweets: MIN_RETWEETS,
    });

    return filtered;
  }

  // Filter spam and promotional content
  filterSpam(tweets: TweetWithAuthor[]): TweetWithAuthor[] {
    const SPAM_KEYWORDS = [
      "giveaway",
      "follow for follow",
      "buy now",
      "limited time",
      "click here",
      "dm me",
    ];

    return tweets.filter((tweetWithAuthor) => {
      const textLower = tweetWithAuthor.tweet.text.toLowerCase();
      const hasSpamKeyword = SPAM_KEYWORDS.some((keyword) =>
        textLower.includes(keyword),
      );

      // Filter out retweets (we want original content)
      const isRetweet = tweetWithAuthor.tweet.referenced_tweets?.some(
        (ref) => ref.type === "retweeted",
      );

      return !hasSpamKeyword && !isRetweet;
    });
  }

  // Filter tweets from last 48 hours
  filterRecent(tweets: TweetWithAuthor[]): TweetWithAuthor[] {
    const HOURS_48 = 48 * 60 * 60 * 1000;
    const now = Date.now();

    return tweets.filter((tweetWithAuthor) => {
      const tweetTime = new Date(tweetWithAuthor.tweet.created_at).getTime();
      const age = now - tweetTime;
      return age <= HOURS_48;
    });
  }
}

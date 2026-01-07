export enum Source {
  TabNews = "TabNews",
  HackerNews = "HackerNews",
  DevTo = "DevTo",
  Lobsters = "Lobsters",
}

export enum CacheKey {
  TabNews = "tabnews",
  HackerNews = "hackernews",
  TabNewsComments = "comments",
  SmartMix = "smartmix",
  Lobsters = "lobsters",
  DevTo = "devto",
}

export interface Comment {
  id: string;
  parent_id: string | null;
  owner_username: string;
  body: string;
  created_at: string;
  children: Comment[];
  tabcoins?: number;
}

export interface NewsItem {
  id: string;
  title: string;
  author: string;
  score: number;
  publishedAt: string; // ISO String
  source: Source;
  url?: string; // External URL for HN
  sourceUrl?: string | null; // External URL for TabNews (if link post)
  slug?: string; // TabNews slug
  owner_username?: string; // TabNews owner
  body?: string; // Markdown content
  commentCount?: number;
  techScore?: number; // AI-based tech relevance score (0-100)
}

export type ViewMode = "mix" | "tabnews" | "hackernews";

// API Response types (Simplified)
export interface TabNewsItem {
  id: string;
  owner_username: string;
  slug: string;
  title: string;
  body?: string;
  published_at: string;
  tabcoins: number;
  children_deep_count: number;
  source_url?: string | null;
}

// Official Firebase API Type
export interface HackerNewsItem {
  id: number;
  title: string;
  score: number;
  by: string;
  time: number; // Unix timestamp in seconds
  url?: string;
  text?: string; // Story/comment body (HTML) - only present for Ask HN, Show HN, etc
  descendants?: number; // comment count
  type: string;
}

// Cache interface
export interface CacheEntry<T> {
  data: T;
  timestamp: number;
}

// Service Status Types
export enum ServiceStatusType {
  Operational = "operational",
  Degraded = "degraded",
  Down = "down",
}

export interface ServiceStatus {
  name: string;
  status: ServiceStatusType;
  lastChecked: string; // ISO 8601
  url: string; // Link para a página de status oficial
}

export interface ServicesStatusResponse {
  services: ServiceStatus[];
  lastUpdate: string; // ISO 8601
}

// Reddit API Response Types
export interface RedditPost {
  data: {
    id: string;
    title: string;
    author: string;
    selftext: string;
    url: string;
    permalink: string;
    score: number; // upvotes - downvotes
    ups: number; // upvotes
    num_comments: number;
    created_utc: number; // Unix timestamp
    subreddit: string;
    is_self: boolean; // true if text post
    over_18: boolean;
  };
}

export interface RedditResponse {
  data: {
    children: RedditPost[];
    after?: string;
    before?: string;
  };
}

// Twitter/X API Response Types
export interface TwitterTweet {
  id: string;
  text: string;
  author_id: string;
  created_at: string; // ISO 8601
  public_metrics: {
    retweet_count: number;
    reply_count: number;
    like_count: number;
    quote_count: number;
    bookmark_count: number;
    impression_count: number;
  };
  entities?: {
    urls?: Array<{
      url: string;
      expanded_url: string;
      display_url: string;
    }>;
    hashtags?: Array<{
      start: number;
      end: number;
      tag: string;
    }>;
  };
  referenced_tweets?: Array<{
    type: "retweeted" | "quoted" | "replied_to";
    id: string;
  }>;
}

export interface TwitterUser {
  id: string;
  name: string;
  username: string;
  verified?: boolean;
  public_metrics?: {
    followers_count: number;
    following_count: number;
    tweet_count: number;
  };
}

export interface TweetWithAuthor {
  tweet: TwitterTweet;
  username: string;
}

// Dev.to API Response Types
export interface DevToArticle {
  id: number;
  title: string;
  description: string;
  published_at: string; // ISO 8601
  tag_list: string[];
  slug: string;
  url: string;
  canonical_url: string;
  comments_count: number;
  public_reactions_count: number;
  positive_reactions_count: number;
  user: {
    name: string;
    username: string;
    twitter_username?: string;
    github_username?: string;
  };
  organization?: {
    name: string;
    username: string;
    slug: string;
  };
  reading_time_minutes: number;
}

export interface ArticleWithAuthor {
  article: DevToArticle;
  username: string;
}

// Lobsters API Response Type
export interface LobstersItem {
  short_id: string;
  short_id_url: string;
  created_at: string; // ISO 8601
  title: string;
  url: string;
  score: number;
  flags: number;
  comment_count: number;
  description: string;
  description_plain: string;
  comments_url: string;
  submitter_user: string;
  user_is_author: boolean;
  tags: string[];
}

// feed item type - only news items
export type FeedItem = { type: "news" } & NewsItem;

// status of each news source
export interface SourceStatus {
  name: Source;
  ok: boolean;
  error?: string;
}

// response from the /api/feed endpoint
export interface FeedResponse {
  items: FeedItem[];
  nextCursor: string | null;
  sources: SourceStatus[];
}

// ============================================
// PERSISTENCE & ANALYTICS TYPES
// ============================================

// Processing Step Types
export type ProcessingStep = "fetch" | "enrich" | "rank" | "mix" | "cache";

// Processing Log Entry (for auditability)
export interface ProcessingLogEntry {
  correlationId: string;
  timestamp: Date;
  step: ProcessingStep;
  source: Source;
  newsItemId: string;
  duration: number; // ms
  success: boolean;
  error?: {
    message: string;
    stack?: string;
  };
  metadata?: Record<string, unknown>;
}

// Enriched News Item (after AI analysis)
export interface EnrichedNewsItem {
  source: Source;
  itemId: string;
  rawData: NewsItem;

  // AI Analysis
  techScore: number; // 0-100
  techScoreConfidence: number; // 0-1

  // Keywords extracted
  keywords: string[];
  isTechNews: boolean;

  // Link metadata (scraped)
  linkMetadata?: {
    title: string;
    description: string;
    imageUrl?: string;
  };

  enrichedAt: Date;
}

// Ranked News Item (after score calculation)
export interface RankedNewsItem {
  source: Source;
  itemId: string;
  data: NewsItem;
  rank: number;
  calculatedScore: number; // Our normalized score
  originalScore: number; // Original source score
  techScore: number;
  keywords: string[];
  rankedAt: Date;
}

// Analytics Types
export type AnalyticsPeriod = "24h" | "7d" | "30d";

export interface TrendingTopic {
  keyword: string;
  count: number;
  avgScore: number;
  sources: Source[];
  topArticles: Array<{
    id: string;
    title: string;
    score: number;
    source: Source;
  }>;
}

export interface SourceStats {
  source: Source;
  totalArticles: number;
  avgScore: number;
  topKeywords: string[];
}

export interface AnalyticsResponse {
  period: AnalyticsPeriod;
  generatedAt: string;
  trending: TrendingTopic[];
  sourceStats: SourceStats[];
  totalProcessed: number;
}

// Warehouse Stats
export interface WarehouseStats {
  rawCount: number;
  enrichedCount: number;
  rankedCount: number;
  mixedCount: number;
  logsCount: number;
  oldestRecord?: Date;
  newestRecord?: Date;
}

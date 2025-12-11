export enum Source {
  TabNews = "TabNews",
  HackerNews = "HackerNews",
}

export enum CacheKey {
  TabNews = "tabnews",
  HackerNews = "hackernews",
  TabNewsComments = "comments",
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
  descendants?: number; // comment count
  type: string;
}

// Cache interface
export interface CacheEntry<T> {
  data: T;
  timestamp: number;
}

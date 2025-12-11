import type {
  NewsItem,
  TabNewsItem,
  HackerNewsItem,
  Comment,
  CacheEntry,
} from "./types";
import { Source, CacheKey } from "./types";

const TABNEWS_API = "https://www.tabnews.com.br/api/v1/contents";
const HN_BASE_URL = "https://hacker-news.firebaseio.com/v0";

// Cache configuration
const CACHE_DURATION = 5 * 60 * 1000; // 5 minutes in milliseconds

const cache: Record<string, CacheEntry<any>> = {};

const getFromCache = <T>(key: string): T | null => {
  const entry = cache[key];
  if (!entry) return null;

  const isExpired = Date.now() - entry.timestamp > CACHE_DURATION;
  if (isExpired) {
    delete cache[key];
    return null;
  }

  return entry.data;
};

const setCache = <T>(key: string, data: T) => {
  cache[key] = {
    data,
    timestamp: Date.now(),
  };
};

// --- RANKING ALGORITHM ---
// Enhanced formula that favors content in the 1-5 day sweet spot
// Formula: ((Points + (Comments * 0.5) + 1) * FreshnessFactor) / (T + 2)^G
// Factors:
// 1. Points (Likes/Coins) count as 1.0
// 2. Comments count as 0.5 (Engagement is important, but less than approval)
// 3. FreshnessFactor: Multiplier that boosts 1-5 day old content, penalizes very recent/old
// 4. Gravity = 1.2 (reduced from 1.4 for gentler time decay)
const calculateRank = (item: NewsItem): number => {
  const points = item.score || 0;
  const comments = item.commentCount || 0;

  const date = new Date(item.publishedAt);
  const now = new Date();

  const ageInHours = Math.max(
    0,
    (now.getTime() - date.getTime()) / (1000 * 60 * 60),
  );
  const ageInDays = ageInHours / 24;

  // Weighted Score:
  // Points (Likes/Coins) count as 1.0
  // Comments count as 0.5 (Engagement is important, but less than approval)
  const weightedScore = points + comments * 0.5;

  // Freshness multiplier that favors 1-5 day old content
  let freshnessFactor = 1.0;

  if (ageInDays < 0.5) {
    // Very recent (< 12h): slight penalty - content needs time to prove value
    freshnessFactor = 0.6;
  } else if (ageInDays < 1) {
    // 12h-24h: ok, but not ideal yet
    freshnessFactor = 0.85;
  } else if (ageInDays <= 5) {
    // Sweet spot: 1-5 days - BOOST!
    // Maximum boost around 2-3 days (~1.5x)
    const daysSinceOne = ageInDays - 1;
    freshnessFactor = 1.0 + 0.5 * Math.exp(-daysSinceOne / 2);
  } else if (ageInDays <= 10) {
    // 5-10 days: starts to decline
    freshnessFactor = 1.0 - (ageInDays - 5) * 0.1; // 10% drop per day
  } else {
    // > 10 days: faster decline
    freshnessFactor = 0.5 / Math.pow(ageInDays - 9, 0.8);
  }

  // Reduced gravity for gentler time degradation
  const gravity = 1.2;
  const timePenalty = Math.pow(ageInHours + 2, gravity);

  // Add 1 to weighted score to avoid zero/division issues
  return ((weightedScore + 1) * freshnessFactor) / timePenalty;
};

export const fetchTabNews = async (): Promise<NewsItem[]> => {
  const cached = getFromCache<NewsItem[]>(CacheKey.TabNews);
  if (cached) return cached;

  const res = await fetch(`${TABNEWS_API}?strategy=relevant`);
  if (!res.ok) throw new Error("Falha ao carregar TabNews");
  const data = (await res.json()) as TabNewsItem[];

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

  setCache(CacheKey.TabNews, mapped);
  return mapped;
};

export const fetchHackerNews = async (): Promise<NewsItem[]> => {
  const cached = getFromCache<NewsItem[]>(CacheKey.HackerNews);
  if (cached) return cached;

  // 1. Get Top Stories IDs
  const idsRes = await fetch(`${HN_BASE_URL}/topstories.json`);
  if (!idsRes.ok) throw new Error("Falha ao carregar IDs do Hacker News");
  const ids = (await idsRes.json()) as number[];

  // 2. Fetch details for top 30 items in parallel
  const topIds = ids.slice(0, 30);

  const itemPromises = topIds.map((id) =>
    fetch(`${HN_BASE_URL}/item/${id}.json`).then((res) => res.json()),
  );

  const itemsRaw = (await Promise.all(itemPromises)) as HackerNewsItem[];

  // 3. Map and Filter
  const mapped = itemsRaw
    .filter(
      (item) =>
        item &&
        item.title &&
        !item.title.startsWith("[dead]") &&
        !item.title.startsWith("[flagged]"),
    )
    .map((item) => ({
      id: String(item.id),
      title: item.title,
      author: item.by,
      score: item.score,
      publishedAt: new Date(item.time * 1000).toISOString(),
      source: Source.HackerNews,
      url: item.url || `https://news.ycombinator.com/item?id=${item.id}`,
      commentCount: item.descendants || 0,
    }));

  setCache(CacheKey.HackerNews, mapped);
  return mapped;
};

export const fetchSmartMix = async (): Promise<NewsItem[]> => {
  const [tabNewsResults, hnResults] = await Promise.allSettled([
    fetchTabNews(),
    fetchHackerNews(),
  ]);

  const tabNews =
    tabNewsResults.status === "fulfilled" ? tabNewsResults.value : [];
  const hn = hnResults.status === "fulfilled" ? hnResults.value : [];

  if (tabNewsResults.status === "rejected" && hnResults.status === "rejected") {
    throw new Error("Não foi possível carregar nenhuma fonte de notícias.");
  }

  // Apply "Gravity Sort" to both lists individually
  const sortedTab = [...tabNews].sort(
    (a, b) => calculateRank(b) - calculateRank(a),
  );
  const sortedHn = [...hn].sort((a, b) => calculateRank(b) - calculateRank(a));

  // Take top 20 from each *after* our custom freshness sorting
  const topTab = sortedTab.slice(0, 20);
  const topHn = sortedHn.slice(0, 20);

  const mixed: NewsItem[] = [];
  const maxLength = Math.max(topTab.length, topHn.length);

  // Interleave the results to ensure diversity
  for (let i = 0; i < maxLength; i++) {
    if (i < topTab.length) mixed.push(topTab[i]);
    if (i < topHn.length) mixed.push(topHn[i]);
  }

  return mixed;
};

// Fetch comments for a specific TabNews post
export const fetchTabNewsComments = async (
  username: string,
  slug: string,
): Promise<Comment[]> => {
  const cacheKey = `${CacheKey.TabNewsComments}:${username}:${slug}`;
  const cached = getFromCache<Comment[]>(cacheKey);
  if (cached) return cached;

  const res = await fetch(`${TABNEWS_API}/${username}/${slug}/children`);
  if (!res.ok) throw new Error("Falha ao carregar comentários");
  const comments = (await res.json()) as Comment[];

  setCache(cacheKey, comments);
  return comments;
};

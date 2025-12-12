import { inject, singleton } from "tsyringe";
import type { HackerNewsItem, NewsItem } from "../types";
import { CacheKey, Source } from "../types";
import { CacheService } from "./cache.service";

@singleton()
export class HackerNewsService {
  private readonly HN_BASE_URL = "https://hacker-news.firebaseio.com/v0";

  constructor(@inject(CacheService) private cacheService: CacheService) {}

  async fetchNews(): Promise<NewsItem[]> {
    const cached = this.cacheService.get<NewsItem[]>(CacheKey.HackerNews);
    if (cached) return cached;

    // 1. Get Top Stories IDs
    const idsRes = await fetch(`${this.HN_BASE_URL}/topstories.json`);
    if (!idsRes.ok) throw new Error("Falha ao carregar IDs do Hacker News");
    const ids = (await idsRes.json()) as number[];

    // 2. Fetch details for top 30 items in parallel
    const topIds = ids.slice(0, 30);

    const itemPromises = topIds.map((id) =>
      fetch(`${this.HN_BASE_URL}/item/${id}.json`).then((res) => res.json()),
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

    this.cacheService.set(CacheKey.HackerNews, mapped);
    return mapped;
  }
}

import { singleton, inject } from "tsyringe";
import type { NewsItem, TabNewsItem, Comment } from "../types";
import { Source, CacheKey } from "../types";
import { CacheService } from "./cache.service";

@singleton()
export class TabNewsService {
  private readonly TABNEWS_API = "https://www.tabnews.com.br/api/v1/contents";

  constructor(
    @inject(CacheService) private cacheService: CacheService,
  ) {}

  async fetchNews(): Promise<NewsItem[]> {
    const cached = this.cacheService.get<NewsItem[]>(CacheKey.TabNews);
    if (cached) return cached;

    const res = await fetch(`${this.TABNEWS_API}?strategy=relevant`);
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

    this.cacheService.set(CacheKey.TabNews, mapped);
    return mapped;
  }

  async fetchComments(username: string, slug: string): Promise<Comment[]> {
    const cacheKey = `${CacheKey.TabNewsComments}:${username}:${slug}`;
    const cached = this.cacheService.get<Comment[]>(cacheKey);
    if (cached) return cached;

    const res = await fetch(`${this.TABNEWS_API}/${username}/${slug}/children`);
    if (!res.ok) throw new Error("Falha ao carregar comentários");
    const comments = (await res.json()) as Comment[];

    this.cacheService.set(cacheKey, comments);
    return comments;
  }
}

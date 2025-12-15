import { singleton, inject } from "tsyringe";
import type { NewsItem } from "../types";
import { TabNewsService } from "./tabnews.service";
import { HackerNewsService } from "./hackernews.service";
import { RankingService } from "./ranking.service";
import { CacheService } from "./cache.service";
import { CacheKey } from "../types";

@singleton()
export class SmartMixService {
  private fetchLock: Promise<NewsItem[]> | null = null;

  constructor(
    @inject(TabNewsService) private tabNewsService: TabNewsService,
    @inject(HackerNewsService) private hackerNewsService: HackerNewsService,
    @inject(RankingService) private rankingService: RankingService,
    @inject(CacheService) private cacheService: CacheService,
  ) {}

  async fetchMix(): Promise<NewsItem[]> {
    const cached = this.cacheService.get<NewsItem[]>(CacheKey.SmartMix);
    if (cached) return cached;

    if (this.fetchLock) {
      return this.fetchLock;
    }

    this.fetchLock = this.doFetchAndRank();

    try {
      const result = await this.fetchLock;
      return result;
    } finally {
      this.fetchLock = null;
    }
  }

  private async doFetchAndRank(): Promise<NewsItem[]> {
    const [tabNewsResults, hnResults] = await Promise.allSettled([
      this.tabNewsService.fetchNews(),
      this.hackerNewsService.fetchNews(),
    ]);

    const tabNews =
      tabNewsResults.status === "fulfilled" ? tabNewsResults.value : [];
    const hn = hnResults.status === "fulfilled" ? hnResults.value : [];

    if (
      tabNewsResults.status === "rejected" &&
      hnResults.status === "rejected"
    ) {
      throw new Error("Não foi possível carregar nenhuma fonte de notícias.");
    }

    const sortedTab = [...tabNews].sort(
      (a, b) =>
        this.rankingService.calculateRank(b) -
        this.rankingService.calculateRank(a),
    );
    const sortedHn = [...hn].sort(
      (a, b) =>
        this.rankingService.calculateRank(b) -
        this.rankingService.calculateRank(a),
    );

    const topTab = sortedTab.slice(0, 100);
    const topHn = sortedHn.slice(0, 100);

    const mixed: NewsItem[] = [];
    const maxLength = Math.max(topTab.length, topHn.length);

    for (let i = 0; i < maxLength; i++) {
      if (i < topTab.length && topTab[i]) mixed.push(topTab[i]);
      if (i < topHn.length && topHn[i]) mixed.push(topHn[i]);
    }

    this.cacheService.set(CacheKey.SmartMix, mixed);
    return mixed;
  }

  async fetchMixPaginated(
    limit: number,
    after?: string,
  ): Promise<{ items: NewsItem[]; nextCursor: string | null }> {
    const allItems = await this.fetchMix();

    let startIdx = 0;
    if (after) {
      const idx = allItems.findIndex((item) => item.id === after);
      if (idx >= 0) {
        startIdx = idx + 1;
      }
    }

    const items = allItems.slice(startIdx, startIdx + limit);

    const nextCursor =
      items.length === limit && startIdx + limit < allItems.length
        ? items[items.length - 1].id
        : null;

    return { items, nextCursor };
  }
}

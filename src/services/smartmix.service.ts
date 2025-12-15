import { singleton, inject } from "tsyringe";
import type { NewsItem } from "../types";
import { TabNewsService } from "./tabnews.service";
import { HackerNewsService } from "./hackernews.service";
import { RankingService } from "./ranking.service";

@singleton()
export class SmartMixService {
  constructor(
    @inject(TabNewsService) private tabNewsService: TabNewsService,
    @inject(HackerNewsService) private hackerNewsService: HackerNewsService,
    @inject(RankingService) private rankingService: RankingService
  ) {}

  async fetchMix(): Promise<NewsItem[]> {
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

    // Apply "Gravity Sort" to both lists individually
    const sortedTab = [...tabNews].sort(
      (a, b) =>
        this.rankingService.calculateRank(b) -
        this.rankingService.calculateRank(a)
    );
    const sortedHn = [...hn].sort(
      (a, b) =>
        this.rankingService.calculateRank(b) -
        this.rankingService.calculateRank(a)
    );

    const topTab = sortedTab.slice(0, 100);
    const topHn = sortedHn.slice(0, 100);

    const mixed: NewsItem[] = [];
    const maxLength = Math.max(topTab.length, topHn.length);

    // Interleave the results to ensure diversity
    for (let i = 0; i < maxLength; i++) {
      if (i < topTab.length && topTab[i]) mixed.push(topTab[i]);
      if (i < topHn.length && topHn[i]) mixed.push(topHn[i]);
    }

    return mixed;
  }
}

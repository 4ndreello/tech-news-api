import { singleton, inject } from "tsyringe";
import { SmartMixService } from "./smartmix.service";
import { DevToService } from "./devto.service";
import { LobstersService } from "./lobsters.service";
import { LoggerService } from "./logger.service";
import type { NewsItem, FeedItem, FeedResponse } from "../types";

@singleton()
export class FeedService {
  constructor(
    @inject(SmartMixService) private smartMixService: SmartMixService,
    @inject(DevToService) private devToService: DevToService,
    @inject(LobstersService) private lobstersService: LobstersService,
    @inject(LoggerService) private logger: LoggerService
  ) {}

  async fetchFeed(limit: number, after?: string): Promise<FeedResponse> {
    this.logger.info("fetching unified feed", { limit, after });

    // Fetch news from all sources in parallel
    const [mixResult, devToResult, lobstersResult] = await Promise.allSettled([
      this.smartMixService.fetchMix(),
      this.devToService.fetchNews(),
      this.lobstersService.fetchNews(),
    ]);

    const handleResult = (
      result: PromiseSettledResult<NewsItem[]>,
      sourceName: string
    ): NewsItem[] => {
      if (result.status === "fulfilled") return result.value;
      this.logger.error(`failed to fetch ${sourceName} news for feed`, {
        error:
          result.reason instanceof Error
            ? result.reason.message
            : String(result.reason),
      });
      return [];
    };

    const mixNews = handleResult(mixResult, "mix");
    const devToNews = handleResult(devToResult, "dev.to");
    const lobstersNews = handleResult(lobstersResult, "lobsters");

    // Merge all news sources
    const allNews = [...mixNews, ...devToNews, ...lobstersNews];

    // Separate by source and sort each by score
    const bySource: Record<string, NewsItem[]> = {
      TabNews: [],
      HackerNews: [],
      DevTo: [],
      Lobsters: [],
    };

    allNews.forEach((news) => {
      if (bySource[news.source]) {
        bySource[news.source].push(news);
      }
    });

    // Sort each source by score (highest first)
    Object.keys(bySource).forEach((source) => {
      bySource[source].sort((a, b) => b.score - a.score);
    });

    // Interleave: take top 1 from each source, then top 2, etc.
    const interleaved: NewsItem[] = [];
    const maxLength = Math.max(
      bySource.TabNews.length,
      bySource.HackerNews.length,
      bySource.DevTo.length,
      bySource.Lobsters.length
    );

    for (let i = 0; i < maxLength; i++) {
      if (i < bySource.TabNews.length) {
        interleaved.push(bySource.TabNews[i]);
      }
      if (i < bySource.HackerNews.length) {
        interleaved.push(bySource.HackerNews[i]);
      }
      if (i < bySource.DevTo.length) {
        interleaved.push(bySource.DevTo[i]);
      }
      if (i < bySource.Lobsters.length) {
        interleaved.push(bySource.Lobsters[i]);
      }
    }

    this.logger.info("merged and interleaved news from all sources", {
      mixNews: mixNews.length,
      devToNews: devToNews.length,
      lobstersNews: lobstersNews.length,
      total: interleaved.length,
    });

    // Convert to FeedItem format
    const feedItems: FeedItem[] = interleaved.map((news) => ({
      type: "news",
      ...news,
    }));

    // Filter by cursor
    let startIdx = 0;
    if (after) {
      const cursorIdx = feedItems.findIndex((item) => item.id === after);
      if (cursorIdx >= 0) {
        startIdx = cursorIdx + 1;
      }
    }

    const finalItems = feedItems.slice(startIdx, startIdx + limit);

    this.logger.info("feed prepared", {
      itemCount: finalItems.length,
    });

    const nextCursor =
      finalItems.length === limit ? finalItems[finalItems.length - 1].id : null;

    return { items: finalItems, nextCursor };
  }
}

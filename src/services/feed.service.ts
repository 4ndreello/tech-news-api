import { singleton, inject } from "tsyringe";
import { SmartMixService } from "./smartmix.service";
import { DevToService } from "./devto.service";
import { LobstersService } from "./lobsters.service";
import { LoggerService } from "./logger.service";
import {
  Source,
  type NewsItem,
  type FeedItem,
  type FeedResponse,
  type SourceStatus,
} from "../types";

interface SourceFetchResult {
  items: NewsItem[];
  error?: string;
}

// helper to extract result and error info from Promise.allSettled
function handleSourceResult(
  result: PromiseSettledResult<NewsItem[]>,
  source: Source
): SourceFetchResult {
  if (result.status === "fulfilled") {
    return { items: result.value };
  }
  const errorMsg =
    result.reason instanceof Error
      ? result.reason.message
      : String(result.reason);
  return { items: [], error: errorMsg };
}

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

    // fetch news from all sources in parallel
    const [mixResult, devToResult, lobstersResult] = await Promise.allSettled([
      this.smartMixService.fetchMix(),
      this.devToService.fetchNews(),
      this.lobstersService.fetchNews(),
    ]);

    const mixData = handleSourceResult(mixResult, Source.TabNews);
    const devToData = handleSourceResult(devToResult, Source.DevTo);
    const lobstersData = handleSourceResult(lobstersResult, Source.Lobsters);

    // Merge all news sources
    const allNews = [
      ...mixData.items,
      ...devToData.items,
      ...lobstersData.items,
    ];

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

    // Build sources status array
    // Note: mixResult contains TabNews + HackerNews combined, so we derive their status from mixData
    const sources: SourceStatus[] = [
      {
        name: Source.TabNews,
        ok: !mixData.error,
        error: mixData.error,
        itemCount: bySource.TabNews.length,
      },
      {
        name: Source.HackerNews,
        ok: !mixData.error,
        error: mixData.error,
        itemCount: bySource.HackerNews.length,
      },
      {
        name: Source.DevTo,
        ok: !devToData.error,
        error: devToData.error,
        itemCount: bySource.DevTo.length,
      },
      {
        name: Source.Lobsters,
        ok: !lobstersData.error,
        error: lobstersData.error,
        itemCount: bySource.Lobsters.length,
      },
    ];

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
      sources: sources.map((s) => ({
        name: s.name,
        ok: s.ok,
        itemCount: s.itemCount,
      })),
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

    return { items: finalItems, nextCursor, sources };
  }
}

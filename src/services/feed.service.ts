import { singleton, inject } from "tsyringe";
import { SmartMixService } from "./smartmix.service";
import { DevToService } from "./devto.service";
import { LobstersService } from "./lobsters.service";
import { LoggerService } from "./logger.service";
import { EnrichmentService } from "./enrichment.service";
import { RankingService } from "./ranking.service";
import { PersistenceService } from "./persistence.service";
import {
  Source,
  type NewsItem,
  type FeedItem,
  type FeedResponse,
  type SourceStatus,
  type RankedNewsItem,
} from "../types";

interface SourceFetchResult {
  items: NewsItem[];
  error?: string;
}

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
    @inject(LoggerService) private logger: LoggerService,
    @inject(EnrichmentService) private enrichmentService: EnrichmentService,
    @inject(RankingService) private rankingService: RankingService,
    @inject(PersistenceService) private persistenceService: PersistenceService
  ) {}

  async fetchFeed(limit: number, after?: string): Promise<FeedResponse> {
    this.logger.info("fetching unified feed", { limit, after });

    const [mixResult, devToResult, lobstersResult] = await Promise.allSettled([
      this.smartMixService.fetchMix(),
      this.devToService.fetchNews(),
      this.lobstersService.fetchNews(),
    ]);

    const mixData = handleSourceResult(mixResult, Source.TabNews);
    const devToData = handleSourceResult(devToResult, Source.DevTo);
    const lobstersData = handleSourceResult(lobstersResult, Source.Lobsters);

    const [enrichedDevTo, enrichedLobsters] = await Promise.all([
      devToData.items.length > 0
        ? this.enrichAndRank(devToData.items, Source.DevTo)
        : [],
      lobstersData.items.length > 0
        ? this.enrichAndRank(lobstersData.items, Source.Lobsters)
        : [],
    ]);

    const allNews = [
      ...mixData.items,
      ...enrichedDevTo,
      ...enrichedLobsters,
    ];

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

    Object.keys(bySource).forEach((source) => {
      bySource[source].sort((a, b) => b.score - a.score);
    });

    // Build sources status array
    // Note: mixResult contains TabNews + HackerNews combined, so we derive their status from mixData
    const sources: SourceStatus[] = [
      { name: Source.TabNews, ok: !mixData.error, error: mixData.error },
      { name: Source.HackerNews, ok: !mixData.error, error: mixData.error },
      { name: Source.DevTo, ok: !devToData.error, error: devToData.error },
      {
        name: Source.Lobsters,
        ok: !lobstersData.error,
        error: lobstersData.error,
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
      sources: sources.map((s) => ({ name: s.name, ok: s.ok })),
      total: finalItems.length,
    });

    const nextCursor =
      finalItems.length === limit ? finalItems[finalItems.length - 1].id : null;

    return { items: finalItems, nextCursor, sources };
  }

  private async enrichAndRank(items: NewsItem[], source: Source): Promise<NewsItem[]> {
    const enriched = await this.enrichmentService.enrichBatch(items);

    const ranked: RankedNewsItem[] = enriched
      .map((e, index) => {
        const itemWithTechScore: NewsItem = {
          ...e.rawData,
          techScore: e.techScore,
        };

        const calculatedScore = this.rankingService.calculateRank(itemWithTechScore);

        return {
          source,
          itemId: e.itemId,
          data: {
            ...e.rawData,
            score: calculatedScore,
            techScore: e.techScore,
          },
          rank: 0,
          calculatedScore,
          originalScore: e.rawData.score,
          techScore: e.techScore,
          keywords: e.keywords,
          rankedAt: new Date(),
        };
      })
      .sort((a, b) => b.calculatedScore - a.calculatedScore)
      .map((item, index) => ({ ...item, rank: index + 1 }));

    this.persistenceService
      .persistAll({
        raw: [{ items, source }],
        enriched: [{ items: enriched, source }],
        ranked: [{ items: ranked, source }],
      })
      .catch((error) =>
        this.logger.error(`Error persisting ${source} to warehouse`, { error })
      );

    return ranked.map((r) => r.data);
  }
}

import { singleton, inject } from "tsyringe";
import type { NewsItem, RankedNewsItem, EnrichedNewsItem, Source } from "../types";
import { TabNewsService } from "./tabnews.service";
import { HackerNewsService } from "./hackernews.service";
import { TwitterService } from "./twitter.service";
import { RankingService } from "./ranking.service";
import { CacheService } from "./cache.service";
import { PersistenceService } from "./persistence.service";
import { EnrichmentService } from "./enrichment.service";
import { CacheKey, Source as SourceEnum } from "../types";
import { LoggerService } from "./logger.service";

@singleton()
export class SmartMixService {
  private fetchLock: Promise<NewsItem[]> | null = null;

  constructor(
    @inject(TabNewsService) private tabNewsService: TabNewsService,
    @inject(HackerNewsService) private hackerNewsService: HackerNewsService,
    @inject(TwitterService) private twitterService: TwitterService,
    @inject(RankingService) private rankingService: RankingService,
    @inject(CacheService) private cacheService: CacheService,
    @inject(PersistenceService) private persistenceService: PersistenceService,
    @inject(EnrichmentService) private enrichmentService: EnrichmentService,
    @inject(LoggerService) private logger: LoggerService
  ) {}

  async fetchMix(): Promise<NewsItem[]> {
    const cached = await this.cacheService.get<NewsItem[]>(CacheKey.SmartMix);
    if (cached) return cached;

    if (this.fetchLock) {
      return this.fetchLock;
    }

    this.fetchLock = this.doFetchEnrichAndRank();

    try {
      const result = await this.fetchLock;
      return result;
    } finally {
      this.fetchLock = null;
    }
  }

  private async doFetchEnrichAndRank(): Promise<NewsItem[]> {
    const startTime = Date.now();

    const [tabNewsResults, hnResults, twitterResults] = await Promise.allSettled([
      this.tabNewsService.fetchPage(1),
      this.hackerNewsService.fetchBatch(0),
      this.twitterService.fetchNews(),
    ]);

    const tabNews =
      tabNewsResults.status === "fulfilled" ? tabNewsResults.value : [];
    const hn = hnResults.status === "fulfilled" ? hnResults.value : [];
    const twitter =
      twitterResults.status === "fulfilled" ? twitterResults.value : [];

    if (
      tabNewsResults.status === "rejected" &&
      hnResults.status === "rejected" &&
      twitterResults.status === "rejected"
    ) {
      throw new Error("Não foi possível carregar nenhuma fonte de notícias.");
    }

    const fetchDuration = Date.now() - startTime;
    this.logger.info(`Fetched news in ${fetchDuration}ms`, {
      tabNews: tabNews.length,
      hackerNews: hn.length,
      twitter: twitter.length,
    });

    const enrichStartTime = Date.now();
    const [enrichedTab, enrichedHn, enrichedTwitter] = await Promise.all([
      this.enrichmentService.enrichBatch(tabNews),
      this.enrichmentService.enrichBatch(hn),
      this.enrichmentService.enrichBatch(twitter),
    ]);
    const enrichDuration = Date.now() - enrichStartTime;
    this.logger.info(`Enriched news in ${enrichDuration}ms`);

    const rankedTab = this.rankItems(enrichedTab, SourceEnum.TabNews);
    const rankedHn = this.rankItems(enrichedHn, SourceEnum.HackerNews);
    const rankedTwitter = this.rankItems(enrichedTwitter, SourceEnum.Twitter);

    const mixed = this.interleave(rankedTab, rankedHn, rankedTwitter);

    this.persistAll(
      tabNews,
      enrichedTab,
      rankedTab,
      hn,
      enrichedHn,
      rankedHn,
      twitter,
      enrichedTwitter,
      rankedTwitter,
      mixed
    );

    this.logger.info(
      `SmartMix: mixed ${mixed.length} items (${rankedTab.length} TabNews + ${rankedHn.length} HN + ${rankedTwitter.length} Twitter) in ${
        Date.now() - startTime
      }ms`
    );

    await this.cacheService.set(CacheKey.SmartMix, mixed);

    return mixed;
  }

  private rankItems(
    enrichedItems: EnrichedNewsItem[],
    source: Source
  ): RankedNewsItem[] {
    return enrichedItems
      .map((enriched, index) => {
        const itemWithTechScore: NewsItem = {
          ...enriched.rawData,
          techScore: enriched.techScore,
        };

        const calculatedScore =
          this.rankingService.calculateRank(itemWithTechScore);

        const ranked: RankedNewsItem = {
          source,
          itemId: enriched.itemId,
          data: {
            ...enriched.rawData,
            score: calculatedScore,
            techScore: enriched.techScore,
          },
          rank: 0,
          calculatedScore,
          originalScore: enriched.rawData.score,
          techScore: enriched.techScore,
          keywords: enriched.keywords,
          rankedAt: new Date(),
        };

        return ranked;
      })
      .sort((a, b) => b.calculatedScore - a.calculatedScore)
      .map((item, index) => ({ ...item, rank: index + 1 }));
  }

  private interleave(
    tabNews: RankedNewsItem[],
    hn: RankedNewsItem[],
    twitter: RankedNewsItem[]
  ): NewsItem[] {
    const mixed: NewsItem[] = [];
    const maxLength = Math.max(tabNews.length, hn.length, twitter.length);

    for (let i = 0; i < maxLength; i++) {
      if (i < tabNews.length) mixed.push(tabNews[i].data);
      if (i < hn.length) mixed.push(hn[i].data);
      if (i < twitter.length) mixed.push(twitter[i].data);
    }

    return mixed;
  }

  private persistAll(
    rawTab: NewsItem[],
    enrichedTab: EnrichedNewsItem[],
    rankedTab: RankedNewsItem[],
    rawHn: NewsItem[],
    enrichedHn: EnrichedNewsItem[],
    rankedHn: RankedNewsItem[],
    rawTwitter: NewsItem[],
    enrichedTwitter: EnrichedNewsItem[],
    rankedTwitter: RankedNewsItem[],
    mixed: NewsItem[]
  ): void {
    this.persistenceService
      .persistAll({
        raw: [
          { items: rawTab, source: SourceEnum.TabNews },
          { items: rawHn, source: SourceEnum.HackerNews },
          { items: rawTwitter, source: SourceEnum.Twitter },
        ],
        enriched: [
          { items: enrichedTab, source: SourceEnum.TabNews },
          { items: enrichedHn, source: SourceEnum.HackerNews },
          { items: enrichedTwitter, source: SourceEnum.Twitter },
        ],
        ranked: [
          { items: rankedTab, source: SourceEnum.TabNews },
          { items: rankedHn, source: SourceEnum.HackerNews },
          { items: rankedTwitter, source: SourceEnum.Twitter },
        ],
        mixed: { items: mixed, cacheKey: CacheKey.SmartMix },
      })
      .catch((error: Error) =>
        this.logger.error("Error persisting to Data Warehouse", { error })
      );
  }

  async fetchMixPaginated(
    limit: number,
    after?: string
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

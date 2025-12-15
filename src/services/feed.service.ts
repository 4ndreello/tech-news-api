import { singleton, inject } from "tsyringe";
import { SmartMixService } from "./smartmix.service";
import { HighlightsService } from "./highlights.service";
import { LoggerService } from "./logger.service";
import type { NewsItem, Highlight, FeedItem, FeedResponse } from "../types";

@singleton()
export class FeedService {
  constructor(
    @inject(SmartMixService) private smartMixService: SmartMixService,
    @inject(HighlightsService) private highlightsService: HighlightsService,
    @inject(LoggerService) private logger: LoggerService,
  ) {}

  async fetchFeed(limit: number, after?: string): Promise<FeedResponse> {
    this.logger.info("fetching unified feed", { limit, after });

    const [newsResult, highlightsResult] = await Promise.allSettled([
      this.smartMixService.fetchMix(),
      this.highlightsService.fetchHighlights(),
    ]);

    const allNews = newsResult.status === "fulfilled" ? newsResult.value : [];
    const allHighlights =
      highlightsResult.status === "fulfilled" ? highlightsResult.value : [];
    if (newsResult.status === "rejected") {
      this.logger.error("failed to fetch news for feed", {
        error:
          newsResult.reason instanceof Error
            ? newsResult.reason.message
            : String(newsResult.reason),
      });
    }
    if (highlightsResult.status === "rejected") {
      this.logger.error("failed to fetch highlights for feed", {
        error:
          highlightsResult.reason instanceof Error
            ? highlightsResult.reason.message
            : String(highlightsResult.reason),
      });
    }

    const interleavedItems = this.interleaveItems(allNews, allHighlights);
    const paginatedResult = this.paginateItems(interleavedItems, limit, after);

    const highlightsInPage = paginatedResult.items
      .filter((item) => item.type === "highlight")
      .map((item) => {
        const { type, ...highlight } = item;
        return highlight as Highlight;
      });

    if (highlightsInPage.length > 0) {
      this.logger.info("enriching highlights with AI (lazy loading)", {
        count: highlightsInPage.length,
      });
      const enrichedHighlights =
        await this.highlightsService.enrichWithAI(highlightsInPage);

      const enrichedMap = new Map(enrichedHighlights.map((h) => [h.id, h]));
      const finalItems = paginatedResult.items.map((item) =>
        item.type === "highlight" && enrichedMap.has(item.id)
          ? { type: "highlight" as const, ...enrichedMap.get(item.id)! }
          : item,
      );

      this.logger.info("feed prepared with AI-enriched highlights", {
        itemCount: finalItems.length,
        aiEnrichedCount: highlightsInPage.length,
      });

      return { items: finalItems, nextCursor: paginatedResult.nextCursor };
    }

    this.logger.info("feed prepared (no highlights in this page)", {
      itemCount: paginatedResult.items.length,
    });

    return paginatedResult;
  }

  private interleaveItems(
    news: NewsItem[],
    highlights: Highlight[],
  ): FeedItem[] {
    const result: FeedItem[] = [];
    let newsIdx = 0;
    let highlightIdx = 0;

    for (let i = 0; i < 2 && newsIdx < news.length; i++) {
      result.push({ type: "news", ...news[newsIdx++] });
    }
    if (highlightIdx < highlights.length) {
      result.push({ type: "highlight", ...highlights[highlightIdx++] });
    }

    const NEWS_PER_HIGHLIGHT = 5;
    while (newsIdx < news.length || highlightIdx < highlights.length) {
      for (let i = 0; i < NEWS_PER_HIGHLIGHT && newsIdx < news.length; i++) {
        result.push({ type: "news", ...news[newsIdx++] });
      }

      if (highlightIdx < highlights.length) {
        result.push({ type: "highlight", ...highlights[highlightIdx++] });
      }
    }

    return result;
  }
  private paginateItems(
    items: FeedItem[],
    limit: number,
    after?: string,
  ): FeedResponse {
    let startIdx = 0;

    if (after) {
      const idx = items.findIndex((item) => item.id === after);
      if (idx >= 0) {
        startIdx = idx + 1;
      }
    }

    const paginatedItems = items.slice(startIdx, startIdx + limit);
    const nextCursor =
      paginatedItems.length === limit && startIdx + limit < items.length
        ? paginatedItems[paginatedItems.length - 1].id
        : null;

    return { items: paginatedItems, nextCursor };
  }
}

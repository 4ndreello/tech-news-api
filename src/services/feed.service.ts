import { singleton, inject } from "tsyringe";
import { SmartMixService } from "./smartmix.service";
import { HighlightsService } from "./highlights.service";
import { LoggerService } from "./logger.service";
import type {
  NewsItem,
  Highlight,
  FeedItem,
  FeedResponse,
} from "../types";

@singleton()
export class FeedService {
  constructor(
    @inject(SmartMixService) private smartMixService: SmartMixService,
    @inject(HighlightsService) private highlightsService: HighlightsService,
    @inject(LoggerService) private logger: LoggerService
  ) {}

  async fetchFeed(limit: number, after?: string): Promise<FeedResponse> {
    this.logger.info("fetching unified feed", { limit, after });

    // 1. Fetch em paralelo
    const [newsResult, highlightsResult] = await Promise.allSettled([
      this.smartMixService.fetchMix(),
      this.highlightsService.fetchHighlights(),
    ]);

    // 2. Extrair dados ou arrays vazios em caso de falha
    const allNews =
      newsResult.status === "fulfilled" ? newsResult.value : [];
    const allHighlights =
      highlightsResult.status === "fulfilled" ? highlightsResult.value : [];

    // 3. Logar erros se houver
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

    // 4. Intercalar: 5 news, 1 highlight, 5 news, 1 highlight...
    const interleavedItems = this.interleaveItems(allNews, allHighlights);

    // 5. Aplicar paginação na lista já intercalada
    const paginatedResult = this.paginateItems(interleavedItems, limit, after);

    this.logger.info("feed prepared", {
      itemCount: paginatedResult.items.length,
    });

    return paginatedResult;
  }

  // Intercala com regra: Primeiro 2 news → 1 highlight, depois 5 news → 1 highlight...
  private interleaveItems(
    news: NewsItem[],
    highlights: Highlight[]
  ): FeedItem[] {
    const result: FeedItem[] = [];
    let newsIdx = 0;
    let highlightIdx = 0;

    // PRIMEIRO BLOCO: 2 news + 1 highlight
    for (let i = 0; i < 2 && newsIdx < news.length; i++) {
      result.push({ type: "news", ...news[newsIdx++] });
    }
    if (highlightIdx < highlights.length) {
      result.push({ type: "highlight", ...highlights[highlightIdx++] });
    }

    // RESTO: Padrão 5 news + 1 highlight
    const NEWS_PER_HIGHLIGHT = 5;
    while (newsIdx < news.length || highlightIdx < highlights.length) {
      // Adiciona até 5 notícias
      for (let i = 0; i < NEWS_PER_HIGHLIGHT && newsIdx < news.length; i++) {
        result.push({ type: "news", ...news[newsIdx++] });
      }

      // Adiciona 1 highlight (se disponível)
      if (highlightIdx < highlights.length) {
        result.push({ type: "highlight", ...highlights[highlightIdx++] });
      }
    }

    return result;
  }

  // Paginação por cursor na lista intercalada
  private paginateItems(
    items: FeedItem[],
    limit: number,
    after?: string
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

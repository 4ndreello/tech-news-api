import { inject, singleton } from "tsyringe";
import { LoggerService } from "./logger.service";
import { StorageService } from "./storage.service";
import type {
  AnalyticsPeriod,
  AnalyticsResponse,
  TrendingTopic,
  SourceStats,
  Source,
  WarehouseStats,
} from "../types";

@singleton()
export class AnalyticsService {
  constructor(
    @inject(LoggerService) private logger: LoggerService,
    @inject(StorageService) private storage: StorageService
  ) {}

  async getTrendingTopics(period: AnalyticsPeriod = "7d"): Promise<AnalyticsResponse> {
    const startTime = Date.now();
    this.logger.info(`Fetching trending topics for period: ${period}`);

    try {
      const [trending, commented, stats] = await Promise.all([
        this.storage.getTrendingKeywords(period, 15),
        this.storage.getMostCommentedTopics(period, 10),
        this.storage.getWarehouseStats(),
      ]);

      const mergedTrending = this.mergeTrendingResults(trending, commented);

      const sourceStats = await this.getSourceStats(period);

      const response: AnalyticsResponse = {
        period,
        generatedAt: new Date().toISOString(),
        trending: mergedTrending,
        sourceStats,
        totalProcessed: stats.rankedCount,
      };

      this.logger.info(`Trending topics fetched in ${Date.now() - startTime}ms`, {
        trendingCount: mergedTrending.length,
        period,
      });

      return response;
    } catch (error) {
      this.logger.error("Error fetching trending topics", { error, period });
      throw error;
    }
  }

  async getSourceStats(period: AnalyticsPeriod): Promise<SourceStats[]> {
    const periodMs = this.getPeriodMs(period);
    const since = new Date(Date.now() - periodMs);

    const sources: Source[] = ["TabNews", "HackerNews", "DevTo", "Lobsters"] as Source[];
    const stats: SourceStats[] = [];

    for (const source of sources) {
      const topNews = await this.storage.getTopRankedBySource(source, 100);

      if (topNews.length === 0) continue;

      const avgScore =
        topNews.reduce((sum: number, item) => sum + item.score, 0) /
        topNews.length;
      const keywordCounts = new Map<string, number>();
      for (const item of topNews) {
        const titleWords = this.extractKeywordsFromTitle(item.title);
        for (const word of titleWords) {
          keywordCounts.set(word, (keywordCounts.get(word) || 0) + 1);
        }
      }

      const topKeywords = [...keywordCounts.entries()]
        .sort((a, b) => b[1] - a[1])
        .slice(0, 10)
        .map(([keyword]) => keyword);

      stats.push({
        source,
        totalArticles: topNews.length,
        avgScore: Math.round(avgScore),
        topKeywords,
      });
    }

    return stats;
  }

  async getWarehouseStats(): Promise<WarehouseStats> {
    return this.storage.getWarehouseStats();
  }

  async getProcessingStats(since: Date): Promise<{
    fetch: { total: number; successful: number; failed: number; avgDuration: number };
    enrich: { total: number; successful: number; failed: number; avgDuration: number };
    rank: { total: number; successful: number; failed: number; avgDuration: number };
    mix: { total: number; successful: number; failed: number; avgDuration: number };
  }> {
    const [fetch, enrich, rank, mix] = await Promise.all([
      this.storage.getStepStats("fetch", since),
      this.storage.getStepStats("enrich", since),
      this.storage.getStepStats("rank", since),
      this.storage.getStepStats("mix", since),
    ]);

    return { fetch, enrich, rank, mix };
  }

  private mergeTrendingResults(
    trending: TrendingTopic[],
    commented: TrendingTopic[]
  ): TrendingTopic[] {
    const merged = new Map<string, TrendingTopic>();

    for (const topic of trending) {
      merged.set(topic.keyword, topic);
    }

    for (const topic of commented) {
      const existing = merged.get(topic.keyword);
      if (existing) {
        existing.count += topic.count;
        existing.avgScore = Math.round((existing.avgScore + topic.avgScore) / 2);
        existing.sources = [...new Set([...existing.sources, ...topic.sources])];
        existing.topArticles = [...existing.topArticles, ...topic.topArticles]
          .sort((a, b) => b.score - a.score)
          .slice(0, 5);
      } else {
        merged.set(topic.keyword, topic);
      }
    }

    return [...merged.values()]
      .sort((a, b) => b.count - a.count || b.avgScore - a.avgScore)
      .slice(0, 20);
  }

  private extractKeywordsFromTitle(title: string): string[] {
    const stopWords = new Set([
      "the", "a", "an", "and", "or", "but", "in", "on", "at", "to", "for",
      "of", "with", "by", "from", "is", "are", "was", "were", "be", "been",
      "being", "have", "has", "had", "do", "does", "did", "will", "would",
      "could", "should", "may", "might", "must", "shall", "can", "need",
      "dare", "ought", "used", "this", "that", "these", "those", "i", "you",
      "he", "she", "it", "we", "they", "what", "which", "who", "whom",
      "whose", "where", "when", "why", "how", "all", "each", "every", "both",
      "few", "more", "most", "other", "some", "such", "no", "nor", "not",
      "only", "own", "same", "so", "than", "too", "very", "just", "as",
      "de", "da", "do", "dos", "das", "e", "em", "para", "com", "um", "uma",
      "o", "os", "as", "que", "como", "por", "mais", "seu", "sua", "seus",
      "suas", "meu", "minha", "nosso", "nossa", "ele", "ela", "eles", "elas",
    ]);

    return title
      .toLowerCase()
      .replace(/[^\w\s]/g, " ")
      .split(/\s+/)
      .filter((word) => word.length > 2 && !stopWords.has(word))
      .slice(0, 5);
  }

  private getPeriodMs(period: AnalyticsPeriod): number {
    switch (period) {
      case "24h":
        return 24 * 60 * 60 * 1000;
      case "7d":
        return 7 * 24 * 60 * 60 * 1000;
      case "30d":
        return 30 * 24 * 60 * 60 * 1000;
      default:
        return 24 * 60 * 60 * 1000;
    }
  }
}

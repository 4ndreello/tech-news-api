import { inject, singleton } from "tsyringe";
import type { NewsItem } from "../types";
import { CacheService } from "./cache.service";
import { GeminiService } from "./gemini.service";
import { LoggerService } from "./logger.service";
import { capScoreForCodeHostingSites } from "../utils/scoring";

const DEFAULT_MIN_SCORE = 61;
const SCORE_CACHE_TTL = 86400;

@singleton()
export class TechScoringService {
  constructor(
    @inject(CacheService) private cacheService: CacheService,
    @inject(GeminiService) private geminiService: GeminiService,
    @inject(LoggerService) private logger: LoggerService,
  ) {}

  async attachCachedScores(
    items: NewsItem[],
    sourcePrefix: string,
  ): Promise<NewsItem[]> {
    const results = await Promise.all(
      items.map(async (item) => {
        const cacheKey = `tech-score:${sourcePrefix}${item.id}`;
        const cached = await this.cacheService.get<number>(cacheKey);
        if (cached !== null) {
          return { ...item, techScore: cached };
        }
        return item;
      }),
    );
    return results;
  }

  filterByScore(items: NewsItem[], minScore = DEFAULT_MIN_SCORE): NewsItem[] {
    return items.filter((item) => {
      if (item.techScore === undefined) return true;
      return item.techScore >= minScore;
    });
  }

  scoreInBackground(items: NewsItem[], sourcePrefix: string): void {
    const unscored = items.filter((item) => item.techScore === undefined);
    if (unscored.length === 0) return;

    this.logger.info(
      `background scoring ${unscored.length} items (prefix: ${sourcePrefix})`,
    );

    Promise.all(
      unscored.map(async (item) => {
        try {
          const tempScore = await this.geminiService.analyzeTechRelevance(
            item.title,
            item.body || "",
          );
          const url = item.sourceUrl || item.url;
          const score = capScoreForCodeHostingSites(tempScore, url);
          const cacheKey = `tech-score:${sourcePrefix}${item.id}`;
          await this.cacheService.set(cacheKey, score, SCORE_CACHE_TTL);
        } catch (error) {
          this.logger.warn(`background scoring failed for ${item.id}`, {
            error,
          });
        }
      }),
    ).then((results) => {
      this.logger.info(
        `background scoring complete: ${results.length} items (prefix: ${sourcePrefix})`,
      );
    }).catch((error) => {
      this.logger.error("background scoring batch failed", { error });
    });
  }
}

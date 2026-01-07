import { inject, singleton } from "tsyringe";
import { LoggerService } from "./logger.service";
import { GeminiService } from "./gemini.service";
import { ProcessingLogsService } from "./processing-logs.service";
import type { NewsItem, EnrichedNewsItem, Source } from "../types";

interface KeywordExtractionResult {
  keywords: string[];
  isTechNews: boolean;
}

@singleton()
export class EnrichmentService {
  private readonly TECH_KEYWORDS = new Set([
    "javascript", "typescript", "python", "rust", "go", "java", "kotlin", "swift",
    "react", "vue", "angular", "svelte", "nextjs", "nuxt", "remix",
    "node", "deno", "bun", "npm", "yarn", "pnpm",
    "docker", "kubernetes", "k8s", "aws", "gcp", "azure", "cloud",
    "api", "rest", "graphql", "grpc", "websocket",
    "database", "sql", "nosql", "mongodb", "postgres", "mysql", "redis",
    "machine learning", "ml", "ai", "artificial intelligence", "llm", "gpt", "openai",
    "devops", "ci/cd", "github", "gitlab", "git",
    "security", "cybersecurity", "encryption", "auth", "oauth",
    "mobile", "ios", "android", "flutter", "react native",
    "web", "frontend", "backend", "fullstack", "full-stack",
    "linux", "unix", "macos", "windows", "os",
    "startup", "saas", "open source", "opensource",
    "performance", "optimization", "scaling", "architecture",
    "testing", "unit test", "integration test", "e2e",
    "agile", "scrum", "kanban", "lean",
    "crypto", "blockchain", "web3", "nft",
  ]);

  constructor(
    @inject(LoggerService) private logger: LoggerService,
    @inject(GeminiService) private geminiService: GeminiService,
    @inject(ProcessingLogsService) private processingLogs: ProcessingLogsService
  ) {}

  async enrichNewsItem(item: NewsItem): Promise<EnrichedNewsItem> {
    const startTime = Date.now();
    let success = true;
    let errorInfo: { message: string; stack?: string } | undefined;

    try {
      const [techScore, keywordResult] = await Promise.all([
        this.analyzeTechScore(item),
        this.extractKeywords(item),
      ]);

      const enriched: EnrichedNewsItem = {
        source: item.source,
        itemId: item.id,
        rawData: item,
        techScore,
        techScoreConfidence: this.calculateConfidence(item),
        keywords: keywordResult.keywords,
        isTechNews: keywordResult.isTechNews || techScore >= 60,
        enrichedAt: new Date(),
      };

      return enriched;
    } catch (error) {
      success = false;
      errorInfo = {
        message: error instanceof Error ? error.message : String(error),
        stack: error instanceof Error ? error.stack : undefined,
      };

      return {
        source: item.source,
        itemId: item.id,
        rawData: item,
        techScore: 0,
        techScoreConfidence: 0,
        keywords: [],
        isTechNews: false,
        enrichedAt: new Date(),
      };
    } finally {
      const duration = Date.now() - startTime;
      await this.processingLogs.log(
        "enrich",
        item.source,
        item.id,
        duration,
        success,
        errorInfo
      );
    }
  }

  async enrichBatch(items: NewsItem[]): Promise<EnrichedNewsItem[]> {
    const startTime = Date.now();
    this.logger.info(`Enriching batch of ${items.length} items`);

    const enriched = await Promise.all(
      items.map((item) => this.enrichNewsItem(item))
    );

    const duration = Date.now() - startTime;
    const techNewsCount = enriched.filter((e) => e.isTechNews).length;

    this.logger.info(`Batch enrichment complete`, {
      total: items.length,
      techNews: techNewsCount,
      durationMs: duration,
    });

    return enriched;
  }

  private async analyzeTechScore(item: NewsItem): Promise<number> {
    if (item.techScore !== undefined && item.techScore > 0) {
      return item.techScore;
    }

    const hasEnoughContent = (item.body?.length || 0) > 50 || (item.title?.length || 0) > 10;

    if (!hasEnoughContent) {
      return this.estimateTechScoreFromKeywords(item);
    }

    try {
      const score = await this.geminiService.analyzeTechRelevance(
        item.title,
        item.body || ""
      );
      return score;
    } catch (error) {
      this.logger.warn(`AI analysis failed for ${item.id}, using keyword fallback`);
      return this.estimateTechScoreFromKeywords(item);
    }
  }

  private estimateTechScoreFromKeywords(item: NewsItem): number {
    const text = `${item.title} ${item.body || ""}`.toLowerCase();
    let matchCount = 0;

    for (const keyword of this.TECH_KEYWORDS) {
      if (text.includes(keyword)) {
        matchCount++;
      }
    }

    const score = Math.min(100, matchCount * 15);
    return score;
  }

  private extractKeywords(item: NewsItem): KeywordExtractionResult {
    const text = `${item.title} ${item.body || ""}`.toLowerCase();
    const foundKeywords: string[] = [];

    for (const keyword of this.TECH_KEYWORDS) {
      if (text.includes(keyword)) {
        foundKeywords.push(keyword);
      }
    }

    const uniqueKeywords = [...new Set(foundKeywords)].slice(0, 10);

    return {
      keywords: uniqueKeywords,
      isTechNews: uniqueKeywords.length >= 2,
    };
  }

  private calculateConfidence(item: NewsItem): number {
    let confidence = 0.5;

    if (item.body && item.body.length > 200) {
      confidence += 0.2;
    }

    if (item.title && item.title.length > 20) {
      confidence += 0.1;
    }

    if (item.commentCount && item.commentCount > 5) {
      confidence += 0.1;
    }

    if (item.score > 10) {
      confidence += 0.1;
    }

    return Math.min(1, confidence);
  }
}

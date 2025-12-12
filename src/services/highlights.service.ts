import { inject, singleton } from "tsyringe";
import { logger } from "../logger";
import type { Highlight } from "../types";
import { CacheKey } from "../types";
import { CacheService } from "./cache.service";
import { HighlightRankingService } from "./highlight-ranking.service";
import { RedditService } from "./reddit.service";
import { GeminiService } from "./gemini.service";
import { LinkScraperService } from "./link-scraper.service";
import type { RedditPost } from "../types";

@singleton()
export class HighlightsService {
  private readonly MAX_HIGHLIGHTS = 10;
  private readonly IA_SUMMARY_TTL = 24 * 60 * 60 * 1000; // 24h

  constructor(
    @inject(CacheService) private cacheService: CacheService,
    @inject(RedditService) private redditService: RedditService,
    @inject(HighlightRankingService)
    private rankingService: HighlightRankingService,
    @inject(GeminiService) private geminiService: GeminiService,
    @inject(LinkScraperService) private linkScraperService: LinkScraperService,
  ) {}

  async fetchHighlights(): Promise<Highlight[]> {
    // Check cache first
    const cached = this.cacheService.get<Highlight[]>(CacheKey.Highlights);
    if (cached) {
      return cached;
    }

    // Fetch and process highlights
    // highlights: Highlight[]
    // redditPosts: RedditPost[]
    const { highlights, redditPostsMap } =
      await this.processHighlightsWithRedditPosts();

    // IA SUMMARIZATION (Gemini) + cache por highlight enriquecido com scraping do link relacionado
    const highlightsWithIASummary = await Promise.all(
      highlights.map(async (h) => {
        const summaryCacheKey = `highlight_iasummary_${h.id}`;
        let aiSummary = this.cacheService.get<string>(summaryCacheKey);
        if (aiSummary) {
          logger.info("Resumo IA Gemini recuperado do cache", {
            id: h.id,
            title: h.title,
            cacheKey: summaryCacheKey,
            aiSummary,
          });
        } else {
          logger.info("Resumo IA Gemini NÃO encontrado no cache, gerando...", {
            id: h.id,
            title: h.title,
            cacheKey: summaryCacheKey,
          });
          try {
            // Enriquecer contexto com scraping do link relacionado
            let textToSummarize =
              h.summary && !h.summary.includes(h.title)
                ? `${h.title}\n${h.summary}`
                : h.title;

            // Buscar RedditPost original para extrair link relacionado
            const redditPost: RedditPost | undefined =
              redditPostsMap[h.id.replace(/^rd-/, "")];
            let relatedLink = "";
            if (redditPost) {
              // Se for link post (url diferente do reddit), usa esse link
              const url = redditPost.data.url;
              if (url && !url.includes("reddit.com")) {
                relatedLink = url;
              } else {
                // Se não, tenta pegar o primeiro link do selftext
                const selftext = redditPost.data.selftext || "";
                const match = selftext.match(/https?:\/\/[^\s)]+/);
                if (match) relatedLink = match[0];
              }
            }

            if (relatedLink) {
              logger.info(
                "Fazendo scraping do link relacionado para enriquecer contexto IA",
                {
                  id: h.id,
                  relatedLink,
                },
              );
              const scraped =
                await this.linkScraperService.extractMainText(relatedLink);
              if (scraped && scraped.length > 40) {
                textToSummarize += `\n\nContexto do link relacionado:\n${scraped}`;
              }
            }

            aiSummary = await this.geminiService.summarize(textToSummarize);
            this.cacheService.set(summaryCacheKey, aiSummary);
            logger.info("Resumo IA Gemini gerado e salvo no cache", {
              id: h.id,
              title: h.title,
              cacheKey: summaryCacheKey,
              aiSummary,
            });
          } catch (err) {
            logger.error("Erro ao gerar resumo IA Gemini", {
              id: h.id,
              title: h.title,
              error: err instanceof Error ? err.message : String(err),
            });
            aiSummary = "";
          }
        }
        // Sempre prioriza o resumo IA, mas se falhar mantém o summary original
        return {
          ...h,
          summary: aiSummary && aiSummary.length > 0 ? aiSummary : h.summary,
        };
      }),
    );

    // Cache para 30 minutos (como antes)
    this.cacheService.set(CacheKey.Highlights, highlightsWithIASummary);
    logger.info("Highlights array salvo no cache", {
      count: highlightsWithIASummary.length,
    });

    return highlightsWithIASummary;
  }

  /**
   * Retorna highlights e um map de RedditPosts originais para enriquecer contexto IA.
   */
  private async processHighlightsWithRedditPosts(): Promise<{
    highlights: Highlight[];
    redditPostsMap: Record<string, RedditPost>;
  }> {
    // 1. FETCH - Get posts from Reddit
    const redditPosts = await this.redditService.fetchHotPosts(50);
    logger.info("Fetched posts from Reddit", {
      totalFetched: redditPosts.length,
    });

    // 2. FILTER - Apply filters
    let filtered = this.redditService.filterRecent(redditPosts);
    logger.info("After recent filter", { count: filtered.length });

    filtered = this.redditService.filterByEngagement(filtered);
    logger.info("After engagement filter", { count: filtered.length });

    filtered = this.redditService.filterSpam(filtered);
    logger.info("After spam filter", { count: filtered.length });

    // 3. AI PROCESSING - Normalize and calculate relevance
    const highlights = filtered.map((post) =>
      this.rankingService.normalizeRedditPost(post),
    );
    logger.info("After normalization (highlights created)", {
      count: highlights.length,
    });

    // 4. RANK & SELECT - Sort by combined score and take top 10
    const ranked = this.rankingService.rankHighlights(highlights);
    const topHighlights = ranked.slice(0, this.MAX_HIGHLIGHTS);
    logger.info("After ranking and slicing top highlights", {
      topCount: topHighlights.length,
    });

    // Map de RedditPosts por id (sem o prefixo 'rd-')
    const redditPostsMap: Record<string, RedditPost> = {};
    redditPosts.forEach((post) => {
      redditPostsMap[post.data.id] = post;
    });

    // Ensure we always return something (fallback)
    if (topHighlights.length === 0) {
      // If filtering is too strict, return top posts with lower threshold
      logger.warn("No highlights after filtering; using fallback posts", {
        fetched: redditPosts.length,
      });
      const fallbackPosts = redditPosts.slice(0, this.MAX_HIGHLIGHTS);
      const fallback = fallbackPosts.map((post) =>
        this.rankingService.normalizeRedditPost(post),
      );
      logger.info("Fallback highlights created", { count: fallback.length });
      return { highlights: fallback, redditPostsMap };
    }

    return { highlights: topHighlights, redditPostsMap };
  }
}

import { inject, singleton } from "tsyringe";
import type { Highlight } from "../types";
import { CacheKey } from "../types";
import { CacheService } from "./cache.service";
import { HighlightRankingService } from "./highlight-ranking.service";
import { RedditService } from "./reddit.service";
import { TwitterService } from "./twitter.service";
import { DevToService } from "./devto.service";
import { GeminiService } from "./gemini.service";
import { LinkScraperService } from "./link-scraper.service";
import { LoggerService } from "./logger.service";
import type { ArticleWithAuthor, RedditPost, TweetWithAuthor } from "../types";

@singleton()
export class HighlightsService {
  private readonly IA_SUMMARY_TTL = 24 * 60 * 60 * 1000; // 24h

  constructor(
    @inject(CacheService) private cacheService: CacheService,
    // @inject(RedditService) private redditService: RedditService,
    // @inject(TwitterService) private twitterService: TwitterService,
    @inject(DevToService) private devToService: DevToService,
    @inject(HighlightRankingService)
    private rankingService: HighlightRankingService,
    @inject(GeminiService) private geminiService: GeminiService,
    @inject(LinkScraperService) private linkScraperService: LinkScraperService,
    @inject(LoggerService) private logger: LoggerService,
  ) {}

  async fetchHighlights(): Promise<Highlight[]> {
    // Check cache first
    const cached = this.cacheService.get<Highlight[]>(CacheKey.Highlights);
    if (cached) {
      return cached;
    }

    // Fetch and process highlights from Twitter and Dev.to in parallel
    const [
      // { highlights: twitterHighlights, tweetsMap },
      { highlights: devtoHighlights, articlesMap },
    ] = await Promise.all([
      // this.processHighlightsWithTwitter(),
      this.processHighlightsWithDevTo(),
    ]);

    // Merge highlights from both sources
    this.logger.info("merged highlights from all sources", {
      devtoHighlights: devtoHighlights.length,
    });

    // Rank and select top highlights
    const rankend = this.rankingService.rankHighlights(devtoHighlights);
    const rankedPortion = rankend.slice(0, 45);
    this.logger.info("after final ranking and slicing", {
      topCount: rankedPortion.length,
    });

    // IA SUMMARIZATION (Gemini) + cache por highlight enriquecido com scraping do link relacionado
    const highlightsWithIASummary = await Promise.all(
      rankedPortion.map(async (h) => {
        const summaryCacheKey = `highlight_iasummary_${h.id}`;
        let aiSummary = this.cacheService.get<string>(summaryCacheKey);
        if (aiSummary) {
          this.logger.info("gemini AI summary retrieved from cache", {
            id: h.id,
            title: h.title,
            cacheKey: summaryCacheKey,
            aiSummary,
          });
        } else {
          this.logger.info(
            "gemini AI summary not found in cache, generating...",
            {
              id: h.id,
              title: h.title,
              cacheKey: summaryCacheKey,
            },
          );
          try {
            // Enriquecer contexto com scraping do link relacionado
            let textToSummarize =
              h.summary && !h.summary.includes(h.title)
                ? `${h.title}\n${h.summary}`
                : h.title;

            let relatedLink = "";

            // Extrair link baseado na fonte
            if (h.id.startsWith("tw-")) {
              // // Twitter: buscar link do tweet
              // const tweetWithAuthor: TweetWithAuthor | undefined =
              //   tweetsMap[h.id.replace(/^tw-/, "")];
              // if (tweetWithAuthor?.tweet.entities?.urls) {
              //   const firstUrl = tweetWithAuthor.tweet.entities.urls[0];
              //   if (firstUrl?.expanded_url) {
              //     relatedLink = firstUrl.expanded_url;
              //   }
              // }
            } else if (h.id.startsWith("dt-")) {
              // Dev.to: usar URL do artigo
              const articleWithAuthor: ArticleWithAuthor | undefined =
                articlesMap[h.id.replace(/^dt-/, "")];
              if (articleWithAuthor?.article.url) {
                relatedLink = articleWithAuthor.article.url;
              }
            }

            if (relatedLink) {
              this.logger.info("scraping related link to enrich AI context", {
                id: h.id,
                relatedLink,
              });
              const scraped =
                await this.linkScraperService.extractMainText(relatedLink);
              if (scraped && scraped.length > 40) {
                textToSummarize += `\n\nContexto do link relacionado:\n${scraped}`;
              }
            }

            aiSummary = await this.geminiService.summarize(textToSummarize);
            this.cacheService.set(summaryCacheKey, aiSummary);
            this.logger.info("gemini AI summary generated and saved to cache", {
              id: h.id,
              title: h.title,
              cacheKey: summaryCacheKey,
              aiSummary,
            });
          } catch (err) {
            this.logger.error("error generating gemini AI summary", {
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

    this.cacheService.set(CacheKey.Highlights, highlightsWithIASummary);
    this.logger.info("highlights array saved to cache", {
      count: highlightsWithIASummary.length,
    });

    return highlightsWithIASummary;
  }

  /**
   * Retorna highlights do Twitter e um map de Tweets originais para enriquecer contexto IA.
   */
  // private async processHighlightsWithTwitter(): Promise<{
  //   highlights: Highlight[];
  //   tweetsMap: Record<string, TweetWithAuthor>;
  // }> {
  //   // 1. FETCH - Get tweets from Twitter (reduced to avoid rate limits)
  //   const tweets = await this.twitterService.fetchRecentTweets(20);
  //   this.logger.info("fetched tweets from twitter", {
  //     totalFetched: tweets.length,
  //   });

  //   // 2. FILTER - Apply filters
  //   let filtered = this.twitterService.filterRecent(tweets);
  //   this.logger.info("after recent filter", { count: filtered.length });

  //   filtered = this.twitterService.filterByEngagement(filtered);
  //   this.logger.info("after engagement filter", { count: filtered.length });

  //   filtered = this.twitterService.filterSpam(filtered);
  //   this.logger.info("after spam filter", { count: filtered.length });

  //   // 3. AI PROCESSING - Normalize and calculate relevance
  //   const highlights = filtered.map((tweetWithAuthor) =>
  //     this.rankingService.normalizeTwitterTweet(
  //       tweetWithAuthor.tweet,
  //       tweetWithAuthor.username,
  //     ),
  //   );
  //   this.logger.info("after normalization (highlights created)", {
  //     count: highlights.length,
  //   });

  //   // Map de Tweets por id (sem o prefixo 'tw-')
  //   const tweetsMap: Record<string, TweetWithAuthor> = {};
  //   tweets.forEach((tweetWithAuthor) => {
  //     tweetsMap[tweetWithAuthor.tweet.id] = tweetWithAuthor;
  //   });

  //   // Ensure we always return something (fallback)
  //   if (highlights.length === 0) {
  //     // If filtering is too strict, return top tweets with lower threshold
  //     this.logger.warn("no highlights after filtering; using fallback tweets", {
  //       fetched: tweets.length,
  //     });
  //     const fallbackTweets = tweets.slice(0, this.MAX_HIGHLIGHTS);
  //     const fallback = fallbackTweets.map((tweetWithAuthor) =>
  //       this.rankingService.normalizeTwitterTweet(
  //         tweetWithAuthor.tweet,
  //         tweetWithAuthor.username,
  //       ),
  //     );
  //     this.logger.info("fallback highlights created", {
  //       count: fallback.length,
  //     });
  //     return { highlights: fallback, tweetsMap };
  //   }

  //   return { highlights, tweetsMap };
  // }

  /**
   * Retorna highlights do Dev.to e um map de Articles originais para enriquecer contexto IA.
   */
  private async processHighlightsWithDevTo(): Promise<{
    highlights: Highlight[];
    articlesMap: Record<string, ArticleWithAuthor>;
  }> {
    const articles = await this.devToService.fetchRecentArticles(100);
    this.logger.info("fetched articles from dev.to", {
      totalFetched: articles.length,
    });

    const filtered = this.devToService.filterArticleReadingTime(articles);

    const highlights = filtered.map((articleWithAuthor) =>
      this.rankingService.normalizeDevToArticle(
        articleWithAuthor.article,
        articleWithAuthor.username,
      ),
    );

    const articlesMap: Record<string, ArticleWithAuthor> = {};
    articles.forEach((articleWithAuthor) => {
      articlesMap[String(articleWithAuthor.article.id)] = articleWithAuthor;
    });

    this.logger.info("after dev.to filter", { count: highlights.length });

    return { highlights, articlesMap };
  }

  /**
   * DEPRECATED: Retorna highlights e um map de RedditPosts originais para enriquecer contexto IA.
   * Temporarily disabled due to 403 errors on GCP.
   */
  private async processHighlightsWithRedditPosts(): Promise<{
    highlights: Highlight[];
    redditPostsMap: Record<string, RedditPost>;
  }> {
    // TODO: Temporarily disabled Reddit due to 403 errors on GCP
    const redditPosts: RedditPost[] = [];
    let filtered: RedditPost[] = [];

    const highlights = filtered.map((post) =>
      this.rankingService.normalizeRedditPost(post),
    );

    const ranked = this.rankingService.rankHighlights(highlights);

    const redditPostsMap: Record<string, RedditPost> = {};
    redditPosts.forEach((post) => {
      redditPostsMap[post.data.id] = post;
    });

    return { highlights: ranked, redditPostsMap };
  }
}

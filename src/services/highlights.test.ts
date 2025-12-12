import { describe, it, expect, beforeEach, vi } from "vitest";
import "reflect-metadata";
import { container } from "tsyringe";
import { HighlightsService } from "./highlights.service";
import { RedditService } from "./reddit.service";
import { HighlightRankingService } from "./highlight-ranking.service";
import { CacheService } from "./cache.service";
import type { RedditPost, Highlight } from "../types";

describe("HighlightsService", () => {
  let highlightsService: HighlightsService;
  let redditService: RedditService;
  let rankingService: HighlightRankingService;
  let cacheService: CacheService;

  beforeEach(() => {
    container.clearInstances();
    highlightsService = container.resolve(HighlightsService);
    redditService = container.resolve(RedditService);
    rankingService = container.resolve(HighlightRankingService);
    cacheService = container.resolve(CacheService);
  });

  describe("fetchHighlights", () => {
    it("should return cached highlights if available", async () => {
      const mockHighlights: Highlight[] = [
        {
          id: "rd-test123",
          title: "Test Highlight",
          summary: "This is a test summary",
          source: "reddit",
          author: "testuser",
          url: "https://reddit.com/r/test/comments/test123",
          engagement: {
            upvotes: 1000,
            comments: 100,
          },
          publishedAt: new Date().toISOString(),
          aiConfidence: 85,
        },
      ];

      vi.spyOn(cacheService, "get").mockReturnValue(mockHighlights);

      const result = await highlightsService.fetchHighlights();

      expect(result).toEqual(mockHighlights);
      expect(cacheService.get).toHaveBeenCalledWith("highlights");
    });

    it("should fetch and process highlights if not cached", async () => {
      vi.spyOn(cacheService, "get").mockReturnValue(null);
      vi.spyOn(cacheService, "set").mockImplementation(() => {});

      const mockRedditPosts: RedditPost[] = [
        {
          data: {
            id: "abc123",
            title: "Amazing TypeScript Tutorial",
            author: "devguru",
            selftext: "Learn TypeScript in 2025. This is an amazing tutorial.",
            url: "https://example.com/typescript",
            permalink: "/r/typescript/comments/abc123/amazing",
            score: 1500,
            ups: 1500,
            num_comments: 200,
            created_utc: Date.now() / 1000 - 3600, // 1 hour ago
            subreddit: "typescript",
            is_self: true,
            over_18: false,
          },
        },
      ];

      vi.spyOn(redditService, "fetchHotPosts").mockResolvedValue(
        mockRedditPosts,
      );
      vi.spyOn(redditService, "filterRecent").mockReturnValue(mockRedditPosts);
      vi.spyOn(redditService, "filterByEngagement").mockReturnValue(
        mockRedditPosts,
      );
      vi.spyOn(redditService, "filterSpam").mockReturnValue(mockRedditPosts);

      const result = await highlightsService.fetchHighlights();

      expect(result).toHaveLength(1);
      expect(result[0].title).toBe("Amazing TypeScript Tutorial");
      expect(result[0].source).toBe("reddit");
      expect(cacheService.set).toHaveBeenCalledWith("highlights", result);
    });

    it("should return up to 10 highlights", async () => {
      vi.spyOn(cacheService, "get").mockReturnValue(null);

      const mockRedditPosts: RedditPost[] = Array.from(
        { length: 20 },
        (_, i) => ({
          data: {
            id: `post${i}`,
            title: `Test Post ${i}`,
            author: `user${i}`,
            selftext: "Test content",
            url: "https://example.com",
            permalink: `/r/test/comments/post${i}`,
            score: 1000 - i * 10,
            ups: 1000 - i * 10,
            num_comments: 100,
            created_utc: Date.now() / 1000,
            subreddit: "programming",
            is_self: true,
            over_18: false,
          },
        }),
      );

      vi.spyOn(redditService, "fetchHotPosts").mockResolvedValue(
        mockRedditPosts,
      );
      vi.spyOn(redditService, "filterRecent").mockReturnValue(mockRedditPosts);
      vi.spyOn(redditService, "filterByEngagement").mockReturnValue(
        mockRedditPosts,
      );
      vi.spyOn(redditService, "filterSpam").mockReturnValue(mockRedditPosts);

      const result = await highlightsService.fetchHighlights();

      expect(result.length).toBeLessThanOrEqual(10);
    });
  });
});

describe("RedditService", () => {
  let redditService: RedditService;

  beforeEach(() => {
    container.clearInstances();
    redditService = container.resolve(RedditService);
  });

  describe("filterByEngagement", () => {
    it("should filter posts with low engagement", () => {
      const posts: RedditPost[] = [
        {
          data: {
            id: "high",
            title: "High Engagement",
            author: "user1",
            selftext: "",
            url: "https://example.com",
            permalink: "/r/test/high",
            score: 1000,
            ups: 1000,
            num_comments: 100,
            created_utc: Date.now() / 1000,
            subreddit: "programming",
            is_self: true,
            over_18: false,
          },
        },
        {
          data: {
            id: "low",
            title: "Low Engagement",
            author: "user2",
            selftext: "",
            url: "https://example.com",
            permalink: "/r/test/low",
            score: 10,
            ups: 10,
            num_comments: 2,
            created_utc: Date.now() / 1000,
            subreddit: "programming",
            is_self: true,
            over_18: false,
          },
        },
      ];

      const result = redditService.filterByEngagement(posts);

      expect(result).toHaveLength(1);
      expect(result[0].data.id).toBe("high");
    });

    it("should filter NSFW posts", () => {
      const posts: RedditPost[] = [
        {
          data: {
            id: "nsfw",
            title: "NSFW Post",
            author: "user1",
            selftext: "",
            url: "https://example.com",
            permalink: "/r/test/nsfw",
            score: 1000,
            ups: 1000,
            num_comments: 100,
            created_utc: Date.now() / 1000,
            subreddit: "programming",
            is_self: true,
            over_18: true,
          },
        },
      ];

      const result = redditService.filterByEngagement(posts);

      expect(result).toHaveLength(0);
    });
  });

  describe("filterSpam", () => {
    it("should filter spam keywords", () => {
      const posts: RedditPost[] = [
        {
          data: {
            id: "spam",
            title: "Check out my new project!",
            author: "user1",
            selftext: "",
            url: "https://example.com",
            permalink: "/r/test/spam",
            score: 1000,
            ups: 1000,
            num_comments: 100,
            created_utc: Date.now() / 1000,
            subreddit: "programming",
            is_self: true,
            over_18: false,
          },
        },
        {
          data: {
            id: "good",
            title: "TypeScript 5.0 Released",
            author: "user2",
            selftext: "",
            url: "https://example.com",
            permalink: "/r/test/good",
            score: 1000,
            ups: 1000,
            num_comments: 100,
            created_utc: Date.now() / 1000,
            subreddit: "programming",
            is_self: true,
            over_18: false,
          },
        },
      ];

      const result = redditService.filterSpam(posts);

      expect(result).toHaveLength(1);
      expect(result[0].data.id).toBe("good");
    });

    it("should filter media posts", () => {
      const posts: RedditPost[] = [
        {
          data: {
            id: "image",
            title: "Funny Meme",
            author: "user1",
            selftext: "",
            url: "https://i.redd.it/image.jpg",
            permalink: "/r/test/image",
            score: 1000,
            ups: 1000,
            num_comments: 100,
            created_utc: Date.now() / 1000,
            subreddit: "programming",
            is_self: false,
            over_18: false,
          },
        },
      ];

      const result = redditService.filterSpam(posts);

      expect(result).toHaveLength(0);
    });
  });

  describe("filterRecent", () => {
    it("should only keep posts from last 48 hours", () => {
      const now = Date.now() / 1000;
      const posts: RedditPost[] = [
        {
          data: {
            id: "recent",
            title: "Recent Post",
            author: "user1",
            selftext: "",
            url: "https://example.com",
            permalink: "/r/test/recent",
            score: 1000,
            ups: 1000,
            num_comments: 100,
            created_utc: now - 3600, // 1 hour ago
            subreddit: "programming",
            is_self: true,
            over_18: false,
          },
        },
        {
          data: {
            id: "old",
            title: "Old Post",
            author: "user2",
            selftext: "",
            url: "https://example.com",
            permalink: "/r/test/old",
            score: 1000,
            ups: 1000,
            num_comments: 100,
            created_utc: now - 60 * 60 * 24 * 3, // 3 days ago
            subreddit: "programming",
            is_self: true,
            over_18: false,
          },
        },
      ];

      const result = redditService.filterRecent(posts);

      expect(result).toHaveLength(1);
      expect(result[0].data.id).toBe("recent");
    });
  });
});

describe("HighlightRankingService", () => {
  let rankingService: HighlightRankingService;

  beforeEach(() => {
    container.clearInstances();
    rankingService = container.resolve(HighlightRankingService);
  });

  describe("calculateRelevance", () => {
    it("should give higher scores to posts with tech keywords", () => {
      const postWithKeywords: RedditPost = {
        data: {
          id: "tech",
          title: "React 19 with TypeScript and Next.js Performance",
          author: "user1",
          selftext: "Learn about React hooks and TypeScript best practices",
          url: "https://example.com",
          permalink: "/r/test/tech",
          score: 1000,
          ups: 1000,
          num_comments: 100,
          created_utc: Date.now() / 1000 - 3600,
          subreddit: "programming",
          is_self: true,
          over_18: false,
        },
      };

      const postWithoutKeywords: RedditPost = {
        data: {
          id: "other",
          title: "Random Discussion",
          author: "user2",
          selftext: "Just chatting about stuff",
          url: "https://example.com",
          permalink: "/r/test/other",
          score: 1000,
          ups: 1000,
          num_comments: 100,
          created_utc: Date.now() / 1000 - 3600,
          subreddit: "programming",
          is_self: true,
          over_18: false,
        },
      };

      const scoreWithKeywords =
        rankingService.calculateRelevance(postWithKeywords);
      const scoreWithoutKeywords =
        rankingService.calculateRelevance(postWithoutKeywords);

      expect(scoreWithKeywords).toBeGreaterThan(scoreWithoutKeywords);
    });

    it("should give recency bonus to recent posts", () => {
      const recentPost: RedditPost = {
        data: {
          id: "recent",
          title: "Test",
          author: "user1",
          selftext: "",
          url: "https://example.com",
          permalink: "/r/test/recent",
          score: 1000,
          ups: 1000,
          num_comments: 100,
          created_utc: Date.now() / 1000 - 3600, // 1 hour ago
          subreddit: "programming",
          is_self: true,
          over_18: false,
        },
      };

      const oldPost: RedditPost = {
        data: {
          id: "old",
          title: "Test",
          author: "user2",
          selftext: "",
          url: "https://example.com",
          permalink: "/r/test/old",
          score: 1000,
          ups: 1000,
          num_comments: 100,
          created_utc: Date.now() / 1000 - 86400, // 24 hours ago
          subreddit: "programming",
          is_self: true,
          over_18: false,
        },
      };

      const recentScore = rankingService.calculateRelevance(recentPost);
      const oldScore = rankingService.calculateRelevance(oldPost);

      expect(recentScore).toBeGreaterThan(oldScore);
    });
  });

  describe("generateSummary", () => {
    it("should extract first 2 sentences from post body", () => {
      const post: RedditPost = {
        data: {
          id: "test",
          title: "Test Post",
          author: "user1",
          selftext:
            "First sentence here. Second sentence here. Third sentence here.",
          url: "https://example.com",
          permalink: "/r/test/test",
          score: 1000,
          ups: 1000,
          num_comments: 100,
          created_utc: Date.now() / 1000,
          subreddit: "programming",
          is_self: true,
          over_18: false,
        },
      };

      const summary = rankingService.generateSummary(post);

      expect(summary).toBe("First sentence here.  Second sentence here");
    });

    it("should use title if no body", () => {
      const post: RedditPost = {
        data: {
          id: "test",
          title: "Test Post Title",
          author: "user1",
          selftext: "",
          url: "https://example.com",
          permalink: "/r/test/test",
          score: 1000,
          ups: 1000,
          num_comments: 100,
          created_utc: Date.now() / 1000,
          subreddit: "programming",
          is_self: false,
          over_18: false,
        },
      };

      const summary = rankingService.generateSummary(post);

      expect(summary).toBe("Test Post Title");
    });

    it("should limit summary to 200 characters", () => {
      const longText = "a".repeat(300);
      const post: RedditPost = {
        data: {
          id: "test",
          title: "Test",
          author: "user1",
          selftext: longText,
          url: "https://example.com",
          permalink: "/r/test/test",
          score: 1000,
          ups: 1000,
          num_comments: 100,
          created_utc: Date.now() / 1000,
          subreddit: "programming",
          is_self: true,
          over_18: false,
        },
      };

      const summary = rankingService.generateSummary(post);

      expect(summary.length).toBeLessThanOrEqual(200);
      expect(summary).toContain("...");
    });
  });

  describe("normalizeRedditPost", () => {
    it("should convert Reddit post to Highlight format", () => {
      const post: RedditPost = {
        data: {
          id: "abc123",
          title: "Amazing TypeScript Tutorial",
          author: "devguru",
          selftext: "Learn TypeScript easily. Great for beginners.",
          url: "https://example.com",
          permalink: "/r/typescript/comments/abc123/amazing",
          score: 1500,
          ups: 1500,
          num_comments: 200,
          created_utc: 1234567890,
          subreddit: "typescript",
          is_self: true,
          over_18: false,
        },
      };

      const highlight = rankingService.normalizeRedditPost(post);

      expect(highlight.id).toBe("rd-abc123");
      expect(highlight.title).toBe("Amazing TypeScript Tutorial");
      expect(highlight.author).toBe("devguru");
      expect(highlight.source).toBe("reddit");
      expect(highlight.url).toBe(
        "https://reddit.com/r/typescript/comments/abc123/amazing",
      );
      expect(highlight.engagement.upvotes).toBe(1500);
      expect(highlight.engagement.comments).toBe(200);
      expect(highlight.aiConfidence).toBeGreaterThan(0);
      expect(highlight.aiConfidence).toBeLessThanOrEqual(100);
    });
  });

  describe("rankHighlights", () => {
    it("should rank highlights by combined score", () => {
      const highlights: Highlight[] = [
        {
          id: "1",
          title: "Low Score",
          summary: "Summary",
          source: "reddit",
          author: "user1",
          url: "https://reddit.com/1",
          engagement: { upvotes: 100, comments: 10 },
          publishedAt: new Date().toISOString(),
          aiConfidence: 50,
        },
        {
          id: "2",
          title: "High Score",
          summary: "Summary",
          source: "reddit",
          author: "user2",
          url: "https://reddit.com/2",
          engagement: { upvotes: 2000, comments: 300 },
          publishedAt: new Date().toISOString(),
          aiConfidence: 95,
        },
      ];

      const ranked = rankingService.rankHighlights(highlights);

      expect(ranked[0].id).toBe("2"); // High score should be first
      expect(ranked[1].id).toBe("1");
    });
  });
});

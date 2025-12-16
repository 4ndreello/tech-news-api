import "reflect-metadata";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { container } from "tsyringe";
import {
  RankingService,
  TabNewsService,
  HackerNewsService,
  SmartMixService,
  CacheService,
} from "./services";
import { Source } from "./types";
import type { NewsItem } from "./types";

describe("RankingService - Logarithmic Ranking", () => {
  let rankingService: RankingService;

  beforeEach(() => {
    container.clearInstances();
    rankingService = container.resolve(RankingService);
  });

  it("should calculate logarithmic rank correctly", () => {
    const now = new Date();
    const sixHoursAgo = new Date(now.getTime() - 6 * 60 * 60 * 1000);

    const item: NewsItem = {
      id: "1",
      title: "Test",
      author: "user",
      score: 100,
      publishedAt: sixHoursAgo.toISOString(),
      source: Source.TabNews,
      commentCount: 0,
    };

    const rank = rankingService.calculateRank(item);

    // log10(100) = 2, ageDecay = (6+2)^1.8 ≈ 42.22, rank = 2/42.22 * 1000 ≈ 47
    expect(rank).toBeGreaterThan(40);
    expect(rank).toBeLessThan(55);
  });

  it("should normalize HN and TabNews scores fairly", () => {
    const now = new Date();
    const sixHoursAgo = new Date(now.getTime() - 6 * 60 * 60 * 1000);

    const hnItem: NewsItem = {
      id: "hn1",
      title: "HN Article",
      author: "hnuser",
      score: 600,
      publishedAt: sixHoursAgo.toISOString(),
      source: Source.HackerNews,
      commentCount: 100,
      techScore: 70,
    };

    const tabItem: NewsItem = {
      id: "tab1",
      title: "TabNews Article",
      author: "tabuser",
      score: 14,
      publishedAt: sixHoursAgo.toISOString(),
      source: Source.TabNews,
      commentCount: 4,
      techScore: 85,
    };

    const hnRank = rankingService.calculateRank(hnItem);
    const tabRank = rankingService.calculateRank(tabItem);

    // TabNews with high techScore should compete with HN
    // Should be at least 40% of HN rank (much better than 2% before)
    expect(tabRank).toBeGreaterThan(hnRank * 0.4);
    expect(tabRank).toBeLessThan(hnRank);
  });

  it("should handle zero and low scores gracefully", () => {
    const now = new Date();
    const oneHourAgo = new Date(now.getTime() - 1 * 60 * 60 * 1000);

    const zeroScore: NewsItem = {
      id: "1",
      title: "Zero Score",
      author: "user",
      score: 0,
      publishedAt: oneHourAgo.toISOString(),
      source: Source.TabNews,
      commentCount: 0,
    };

    const rank = rankingService.calculateRank(zeroScore);

    // log10(max(1, 0)) = log10(1) = 0, so rank should be 0
    expect(rank).toBe(0);
  });

  it("should return human-readable scores (10-200 range)", () => {
    const now = new Date();
    const twelveHoursAgo = new Date(now.getTime() - 12 * 60 * 60 * 1000);

    const typicalPost: NewsItem = {
      id: "1",
      title: "Typical Post",
      author: "user",
      score: 50,
      publishedAt: twelveHoursAgo.toISOString(),
      source: Source.TabNews,
      commentCount: 10,
    };

    const rank = rankingService.calculateRank(typicalPost);

    // Should be in human-readable range (not 0.05, but 50-ish)
    expect(rank).toBeGreaterThan(10);
    expect(rank).toBeLessThan(200);
  });

  it("should apply tech score boost correctly", () => {
    const now = new Date();
    const sixHoursAgo = new Date(now.getTime() - 6 * 60 * 60 * 1000);

    const noTechScore: NewsItem = {
      id: "1",
      title: "No Tech",
      author: "user",
      score: 100,
      publishedAt: sixHoursAgo.toISOString(),
      source: Source.TabNews,
      commentCount: 0,
      techScore: 0,
    };

    const highTechScore: NewsItem = {
      id: "2",
      title: "High Tech",
      author: "user",
      score: 100,
      publishedAt: sixHoursAgo.toISOString(),
      source: Source.TabNews,
      commentCount: 0,
      techScore: 100, // 1.5x boost
    };

    const noTechRank = rankingService.calculateRank(noTechScore);
    const highTechRank = rankingService.calculateRank(highTechScore);

    // High tech score should be ~1.5x higher
    expect(highTechRank).toBeGreaterThan(noTechRank * 1.4);
    expect(highTechRank).toBeLessThan(noTechRank * 1.6);
  });

  it("should apply time decay (older posts rank lower)", () => {
    const now = new Date();
    const oneHourAgo = new Date(now.getTime() - 1 * 60 * 60 * 1000);
    const oneDayAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000);

    const recentPost: NewsItem = {
      id: "1",
      title: "Recent",
      author: "user",
      score: 100,
      publishedAt: oneHourAgo.toISOString(),
      source: Source.TabNews,
      commentCount: 0,
    };

    const oldPost: NewsItem = {
      id: "2",
      title: "Old",
      author: "user",
      score: 100,
      publishedAt: oneDayAgo.toISOString(),
      source: Source.TabNews,
      commentCount: 0,
    };

    const recentRank = rankingService.calculateRank(recentPost);
    const oldRank = rankingService.calculateRank(oldPost);

    expect(recentRank).toBeGreaterThan(oldRank);
  });
});

describe("TabNewsService", () => {
  let tabNewsService: TabNewsService;
  let cacheService: CacheService;

  beforeEach(() => {
    container.clearInstances();
    vi.clearAllMocks();
    cacheService = container.resolve(CacheService);
    cacheService.clear();
    tabNewsService = container.resolve(TabNewsService);
    global.fetch = vi.fn() as any;
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("should fetch and map TabNews data correctly", async () => {
    const mockData = [
      {
        id: "abc123",
        owner_username: "testuser",
        slug: "test-article",
        title: "Test Article",
        body: "Content here",
        published_at: "2024-01-01T10:00:00Z",
        tabcoins: 42,
        children_deep_count: 5,
        source_url: "https://example.com",
      },
    ];

    (global.fetch as any).mockResolvedValueOnce({
      ok: true,
      json: async () => mockData,
    });

    const result = await tabNewsService.fetchNews();

    expect(result).toHaveLength(1);
    expect(result[0]).toEqual({
      id: "abc123",
      title: "Test Article",
      author: "testuser",
      score: 42,
      publishedAt: "2024-01-01T10:00:00Z",
      source: Source.TabNews,
      slug: "test-article",
      owner_username: "testuser",
      body: "Content here",
      sourceUrl: "https://example.com",
      commentCount: 5,
    });
  });

  it("should throw error on failed fetch", async () => {
    (global.fetch as any).mockResolvedValueOnce({
      ok: false,
    });

    await expect(tabNewsService.fetchNews()).rejects.toThrow(
      "Falha ao carregar TabNews",
    );
  });

  it("should fetch comments for a TabNews post", async () => {
    const mockComments = [
      {
        id: "comment1",
        parent_id: null,
        owner_username: "commenter1",
        body: "Great article!",
        created_at: "2024-01-01T12:00:00Z",
        children: [],
        tabcoins: 5,
      },
    ];

    (global.fetch as any).mockResolvedValueOnce({
      ok: true,
      json: async () => mockComments,
    });

    const result = await tabNewsService.fetchComments("testuser", "test-slug");

    expect(result).toHaveLength(1);
    expect(result[0]).toEqual(mockComments[0]);
  });

  it("should throw error on failed comments fetch", async () => {
    (global.fetch as any).mockResolvedValueOnce({
      ok: false,
    });

    await expect(
      tabNewsService.fetchComments("testuser", "test-slug"),
    ).rejects.toThrow("Falha ao carregar comentários");
  });
});

describe("HackerNewsService", () => {
  let hackerNewsService: HackerNewsService;
  let cacheService: CacheService;

  beforeEach(() => {
    container.clearInstances();
    vi.clearAllMocks();
    cacheService = container.resolve(CacheService);
    cacheService.clear();
    hackerNewsService = container.resolve(HackerNewsService);
    global.fetch = vi.fn() as any;
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("should fetch and map HackerNews data correctly", async () => {
    const mockIds = [1, 2, 3];
    const mockItems = [
      {
        id: 1,
        title: "Test HN Article",
        score: 100,
        by: "hnuser",
        time: 1704096000, // 2024-01-01 00:00:00 UTC
        url: "https://example.com",
        descendants: 25,
        type: "story",
      },
    ];

    (global.fetch as any)
      .mockResolvedValueOnce({
        ok: true,
        json: async () => mockIds,
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => mockItems[0],
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => null,
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => null,
      });

    const result = await hackerNewsService.fetchNews();

    expect(result.length).toBeGreaterThan(0);
    expect(result[0]).toMatchObject({
      id: "1",
      title: "Test HN Article",
      author: "hnuser",
      score: 100,
      source: Source.HackerNews,
      url: "https://example.com",
      commentCount: 25,
    });
  });

  it("should filter out dead and flagged posts", async () => {
    const mockIds = [1, 2];
    const mockItems = [
      {
        id: 1,
        title: "[dead] Test",
        score: 100,
        by: "user1",
        time: 1704096000,
        type: "story",
      },
      {
        id: 2,
        title: "[flagged] Test",
        score: 50,
        by: "user2",
        time: 1704096000,
        type: "story",
      },
    ];

    (global.fetch as any)
      .mockResolvedValueOnce({
        ok: true,
        json: async () => mockIds,
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => mockItems[0],
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => mockItems[1],
      });

    const result = await hackerNewsService.fetchNews();

    expect(result).toHaveLength(0);
  });

  it("should throw error when fetching IDs fails", async () => {
    (global.fetch as any).mockResolvedValueOnce({
      ok: false,
    });

    await expect(hackerNewsService.fetchNews()).rejects.toThrow(
      "Falha ao carregar IDs do Hacker News",
    );
  });
});

describe("SmartMixService", () => {
  let smartMixService: SmartMixService;
  let cacheService: CacheService;

  beforeEach(() => {
    container.clearInstances();
    vi.clearAllMocks();
    cacheService = container.resolve(CacheService);
    cacheService.clear();
    smartMixService = container.resolve(SmartMixService);
    global.fetch = vi.fn() as any;
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("should interleave results from both sources", async () => {
    const mockTabNews = [
      {
        id: "tab1",
        owner_username: "user1",
        slug: "article1",
        title: "TabNews 1",
        published_at: "2024-01-01T10:00:00Z",
        tabcoins: 100,
        children_deep_count: 10,
      },
      {
        id: "tab2",
        owner_username: "user2",
        slug: "article2",
        title: "TabNews 2",
        published_at: "2024-01-01T11:00:00Z",
        tabcoins: 80,
        children_deep_count: 5,
      },
    ];

    const mockHNIds = [1, 2];
    const mockHNItems = [
      {
        id: 1,
        title: "HN 1",
        score: 150,
        by: "hnuser1",
        time: 1704096000,
        url: "https://example.com/1",
        descendants: 20,
        type: "story",
      },
      {
        id: 2,
        title: "HN 2",
        score: 120,
        by: "hnuser2",
        time: 1704099600,
        url: "https://example.com/2",
        descendants: 15,
        type: "story",
      },
    ];

    (global.fetch as any)
      .mockResolvedValueOnce({
        ok: true,
        json: async () => mockTabNews,
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => mockHNIds,
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => mockHNItems[0],
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => mockHNItems[1],
      });

    const result = await smartMixService.fetchMix();

    expect(result.length).toBeGreaterThan(0);

    const sources = result.map((item) => item.source);
    const hasTabNews = sources.includes(Source.TabNews);
    const hasHN = sources.includes(Source.HackerNews);

    expect(hasTabNews).toBe(true);
    expect(hasHN).toBe(true);
  });

  it("should handle when one source fails", async () => {
    const mockTabNews = [
      {
        id: "tab1",
        owner_username: "user1",
        slug: "article1",
        title: "TabNews 1",
        published_at: "2024-01-01T10:00:00Z",
        tabcoins: 100,
        children_deep_count: 10,
      },
    ];

    (global.fetch as any)
      .mockResolvedValueOnce({
        ok: true,
        json: async () => mockTabNews,
      })
      .mockResolvedValueOnce({
        ok: false,
      });

    const result = await smartMixService.fetchMix();

    expect(result.length).toBeGreaterThan(0);
    expect(result.every((item) => item.source === Source.TabNews)).toBe(true);
  });

  it("should throw error when both sources fail", async () => {
    (global.fetch as any)
      .mockResolvedValueOnce({
        ok: false,
      })
      .mockResolvedValueOnce({
        ok: false,
      });

    await expect(smartMixService.fetchMix()).rejects.toThrow(
      "Não foi possível carregar nenhuma fonte de notícias.",
    );
  });
});

describe("CacheService", () => {
  let cacheService: CacheService;

  beforeEach(() => {
    container.clearInstances();
    cacheService = container.resolve(CacheService);
    cacheService.clear();
  });

  it("should store and retrieve data from cache", async () => {
    const testData = { foo: "bar" };
    await cacheService.set("test-key", testData);

    const retrieved = await cacheService.get("test-key");
    expect(retrieved).toEqual(testData);
  });

  it("should return null for non-existent keys", async () => {
    const result = await cacheService.get("non-existent");
    expect(result).toBeNull();
  });

  it("should clear all cache entries", async () => {
    await cacheService.set("key1", "value1");
    await cacheService.set("key2", "value2");

    await cacheService.clear();

    expect(await cacheService.get("key1")).toBeNull();
    expect(await cacheService.get("key2")).toBeNull();
  });
});

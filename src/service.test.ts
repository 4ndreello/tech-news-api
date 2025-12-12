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

describe("RankingService", () => {
  let rankingService: RankingService;

  beforeEach(() => {
    container.clearInstances();
    rankingService = container.resolve(RankingService);
  });

  it("should calculate rank with only score", () => {
    const item: NewsItem = {
      id: "1",
      title: "Test",
      author: "user",
      score: 100,
      publishedAt: "2024-01-01T00:00:00Z",
      source: Source.TabNews,
      commentCount: 0,
    };

    expect(rankingService.calculateRank(item)).toBe(100);
  });

  it("should calculate rank with score and comments", () => {
    const item: NewsItem = {
      id: "1",
      title: "Test",
      author: "user",
      score: 100,
      publishedAt: "2024-01-01T00:00:00Z",
      source: Source.TabNews,
      commentCount: 30, // 30 * 0.3 = 9
    };

    expect(rankingService.calculateRank(item)).toBe(109);
  });

  it("should handle zero score and comments", () => {
    const item: NewsItem = {
      id: "1",
      title: "Test",
      author: "user",
      score: 0,
      publishedAt: "2024-01-01T00:00:00Z",
      source: Source.TabNews,
      commentCount: 0,
    };

    expect(rankingService.calculateRank(item)).toBe(0);
  });

  it("should handle missing score and commentCount", () => {
    const item: NewsItem = {
      id: "1",
      title: "Test",
      author: "user",
      score: 0,
      publishedAt: "2024-01-01T00:00:00Z",
      source: Source.TabNews,
    };

    expect(rankingService.calculateRank(item)).toBe(0);
  });

  it("should prioritize high score over many comments", () => {
    const highScore: NewsItem = {
      id: "1",
      title: "High Score",
      author: "user",
      score: 500,
      publishedAt: "2024-01-01T00:00:00Z",
      source: Source.TabNews,
      commentCount: 10, // 500 + 3 = 503
    };

    const manyComments: NewsItem = {
      id: "2",
      title: "Many Comments",
      author: "user",
      score: 100,
      publishedAt: "2024-01-01T00:00:00Z",
      source: Source.TabNews,
      commentCount: 200, // 100 + 60 = 160
    };

    expect(rankingService.calculateRank(highScore)).toBeGreaterThan(
      rankingService.calculateRank(manyComments),
    );
  });

  it("should give proper weight to comments (0.3 ratio)", () => {
    const item: NewsItem = {
      id: "1",
      title: "Test",
      author: "user",
      score: 50,
      publishedAt: "2024-01-01T00:00:00Z",
      source: Source.TabNews,
      commentCount: 100,
    };

    // 50 + (100 * 0.3) = 50 + 30 = 80
    expect(rankingService.calculateRank(item)).toBe(80);
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

  it("should store and retrieve data from cache", () => {
    const testData = { foo: "bar" };
    cacheService.set("test-key", testData);

    const retrieved = cacheService.get("test-key");
    expect(retrieved).toEqual(testData);
  });

  it("should return null for non-existent keys", () => {
    const result = cacheService.get("non-existent");
    expect(result).toBeNull();
  });

  it("should clear all cache entries", () => {
    cacheService.set("key1", "value1");
    cacheService.set("key2", "value2");

    cacheService.clear();

    expect(cacheService.get("key1")).toBeNull();
    expect(cacheService.get("key2")).toBeNull();
  });
});

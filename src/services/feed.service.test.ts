import { describe, it, expect, beforeEach, vi } from "vitest";
import "reflect-metadata";
import { container } from "tsyringe";
import { FeedService } from "./feed.service";
import { SmartMixService } from "./smartmix.service";
import { HighlightsService } from "./highlights.service";
import type { NewsItem, Highlight, Source } from "../types";

describe("FeedService", () => {
  let feedService: FeedService;
  let smartMixService: SmartMixService;
  let highlightsService: HighlightsService;

  beforeEach(() => {
    container.clearInstances();
    feedService = container.resolve(FeedService);
    smartMixService = container.resolve(SmartMixService);
    highlightsService = container.resolve(HighlightsService);
  });

  const createMockNews = (count: number): NewsItem[] => {
    return Array.from({ length: count }, (_, i) => ({
      id: `news-${i + 1}`,
      title: `News ${i + 1}`,
      author: `author${i + 1}`,
      score: 100 - i,
      publishedAt: new Date().toISOString(),
      source: (i % 2 === 0 ? "tabnews" : "hackernews") as Source,
      url: `https://example.com/news-${i + 1}`,
      commentCount: 10,
    }));
  };

  const createMockHighlights = (count: number): Highlight[] => {
    return Array.from({ length: count }, (_, i) => ({
      id: `highlight-${i + 1}`,
      title: `Highlight ${i + 1}`,
      summary: `Summary ${i + 1}`,
      source: "devto",
      author: `highlightauthor${i + 1}`,
      url: `https://dev.to/highlight-${i + 1}`,
      engagement: {
        likes: 100,
        comments: 10,
        shares: 5,
      },
      publishedAt: new Date().toISOString(),
      aiConfidence: 85,
    }));
  };

  describe("fetchFeed", () => {
    it("should interleave news and highlights in 5:1 ratio", async () => {
      const mockNews = createMockNews(10);
      const mockHighlights = createMockHighlights(3);

      vi.spyOn(smartMixService, "fetchMix").mockResolvedValue(mockNews);
      vi.spyOn(highlightsService, "fetchHighlights").mockResolvedValue(
        mockHighlights
      );

      const result = await feedService.fetchFeed(12);

      // Expected pattern: N N N N N H N N N N N H
      expect(result.items).toHaveLength(12);
      expect(result.items[0].type).toBe("news");
      expect(result.items[1].type).toBe("news");
      expect(result.items[2].type).toBe("news");
      expect(result.items[3].type).toBe("news");
      expect(result.items[4].type).toBe("news");
      expect(result.items[5].type).toBe("highlight");
      expect(result.items[6].type).toBe("news");
      expect(result.items[7].type).toBe("news");
      expect(result.items[8].type).toBe("news");
      expect(result.items[9].type).toBe("news");
      expect(result.items[10].type).toBe("news");
      expect(result.items[11].type).toBe("highlight");
    });

    it("should add type field to news items", async () => {
      const mockNews = createMockNews(5);
      const mockHighlights = createMockHighlights(0);

      vi.spyOn(smartMixService, "fetchMix").mockResolvedValue(mockNews);
      vi.spyOn(highlightsService, "fetchHighlights").mockResolvedValue(
        mockHighlights
      );

      const result = await feedService.fetchFeed(5);

      result.items.forEach((item) => {
        expect(item.type).toBe("news");
        expect(item).toHaveProperty("title");
        expect(item).toHaveProperty("author");
      });
    });

    it("should add type field to highlight items", async () => {
      const mockNews = createMockNews(0);
      const mockHighlights = createMockHighlights(3);

      vi.spyOn(smartMixService, "fetchMix").mockResolvedValue(mockNews);
      vi.spyOn(highlightsService, "fetchHighlights").mockResolvedValue(
        mockHighlights
      );

      const result = await feedService.fetchFeed(3);

      result.items.forEach((item) => {
        expect(item.type).toBe("highlight");
        expect(item).toHaveProperty("summary");
        expect(item).toHaveProperty("aiConfidence");
      });
    });

    it("should continue with news when highlights run out", async () => {
      const mockNews = createMockNews(20);
      const mockHighlights = createMockHighlights(2);

      vi.spyOn(smartMixService, "fetchMix").mockResolvedValue(mockNews);
      vi.spyOn(highlightsService, "fetchHighlights").mockResolvedValue(
        mockHighlights
      );

      const result = await feedService.fetchFeed(20);

      // Should have pattern: 5N 1H 5N 1H 8N (highlights ran out after 2)
      const highlightCount = result.items.filter(
        (item) => item.type === "highlight"
      ).length;
      const newsCount = result.items.filter((item) => item.type === "news")
        .length;

      expect(highlightCount).toBe(2);
      expect(newsCount).toBe(18);
    });

    it("should continue with highlights when news run out", async () => {
      const mockNews = createMockNews(3);
      const mockHighlights = createMockHighlights(5);

      vi.spyOn(smartMixService, "fetchMix").mockResolvedValue(mockNews);
      vi.spyOn(highlightsService, "fetchHighlights").mockResolvedValue(
        mockHighlights
      );

      const result = await feedService.fetchFeed(10);

      // Should have pattern: 3N 1H 4H (3 news, then 1 highlight after first batch, then remaining highlights)
      const newsCount = result.items.filter((item) => item.type === "news")
        .length;
      const highlightCount = result.items.filter(
        (item) => item.type === "highlight"
      ).length;

      expect(newsCount).toBe(3);
      expect(highlightCount).toBe(5); // All 5 highlights included
    });

    it("should paginate correctly with cursor", async () => {
      const mockNews = createMockNews(20);
      const mockHighlights = createMockHighlights(5);

      vi.spyOn(smartMixService, "fetchMix").mockResolvedValue(mockNews);
      vi.spyOn(highlightsService, "fetchHighlights").mockResolvedValue(
        mockHighlights
      );

      // First page
      const page1 = await feedService.fetchFeed(10);
      expect(page1.items).toHaveLength(10);
      expect(page1.nextCursor).toBeTruthy();

      // Second page using cursor
      const page2 = await feedService.fetchFeed(10, page1.nextCursor!);
      expect(page2.items).toHaveLength(10);
      expect(page2.items[0].id).not.toBe(page1.items[0].id);
    });

    it("should return null cursor when no more items", async () => {
      const mockNews = createMockNews(5);
      const mockHighlights = createMockHighlights(1);

      vi.spyOn(smartMixService, "fetchMix").mockResolvedValue(mockNews);
      vi.spyOn(highlightsService, "fetchHighlights").mockResolvedValue(
        mockHighlights
      );

      const result = await feedService.fetchFeed(10);

      // Total of 6 items (5 news + 1 highlight), requested 10
      expect(result.items.length).toBeLessThanOrEqual(6);
      expect(result.nextCursor).toBeNull();
    });

    it("should return empty items when both services fail", async () => {
      vi.spyOn(smartMixService, "fetchMix").mockRejectedValue(
        new Error("News failed")
      );
      vi.spyOn(highlightsService, "fetchHighlights").mockRejectedValue(
        new Error("Highlights failed")
      );

      const result = await feedService.fetchFeed(10);

      expect(result.items).toHaveLength(0);
      expect(result.nextCursor).toBeNull();
    });

    it("should handle partial failure (news fails, highlights succeed)", async () => {
      const mockHighlights = createMockHighlights(3);

      vi.spyOn(smartMixService, "fetchMix").mockRejectedValue(
        new Error("News failed")
      );
      vi.spyOn(highlightsService, "fetchHighlights").mockResolvedValue(
        mockHighlights
      );

      const result = await feedService.fetchFeed(5);

      expect(result.items).toHaveLength(3);
      expect(result.items.every((item) => item.type === "highlight")).toBe(
        true
      );
    });

    it("should handle partial failure (highlights fail, news succeed)", async () => {
      const mockNews = createMockNews(10);

      vi.spyOn(smartMixService, "fetchMix").mockResolvedValue(mockNews);
      vi.spyOn(highlightsService, "fetchHighlights").mockRejectedValue(
        new Error("Highlights failed")
      );

      const result = await feedService.fetchFeed(5);

      expect(result.items).toHaveLength(5);
      expect(result.items.every((item) => item.type === "news")).toBe(true);
    });

    it("should respect limit parameter", async () => {
      const mockNews = createMockNews(50);
      const mockHighlights = createMockHighlights(10);

      vi.spyOn(smartMixService, "fetchMix").mockResolvedValue(mockNews);
      vi.spyOn(highlightsService, "fetchHighlights").mockResolvedValue(
        mockHighlights
      );

      const result1 = await feedService.fetchFeed(5);
      expect(result1.items).toHaveLength(5);

      const result2 = await feedService.fetchFeed(20);
      expect(result2.items).toHaveLength(20);

      const result3 = await feedService.fetchFeed(1);
      expect(result3.items).toHaveLength(1);
    });

    it("should handle invalid cursor gracefully", async () => {
      const mockNews = createMockNews(10);
      const mockHighlights = createMockHighlights(2);

      vi.spyOn(smartMixService, "fetchMix").mockResolvedValue(mockNews);
      vi.spyOn(highlightsService, "fetchHighlights").mockResolvedValue(
        mockHighlights
      );

      // Use non-existent cursor
      const result = await feedService.fetchFeed(5, "non-existent-id");

      // Should start from beginning since cursor not found
      expect(result.items).toHaveLength(5);
    });
  });
});

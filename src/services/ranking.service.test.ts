import "reflect-metadata";
import { describe, it, expect } from "vitest";
import { RankingService } from "./ranking.service";
import { container } from "tsyringe";

describe("RankingService", () => {
  const rankingService = container.resolve(RankingService);

  const baseItem = {
    id: "1",
    title: "Test",
    url: "https://test.com",
    source: "TabNews",
    publishedAt: new Date().toISOString(), // now
    score: 10,
    commentCount: 10,
    techScore: 0,
  };

  it("should penalize posts with 0 comments", () => {
    const itemWithComments = { ...baseItem, commentCount: 10, score: 10 };
    const itemNoComments = { ...baseItem, commentCount: 0, score: 10 };

    const scoreWithComments = rankingService.calculateRank(itemWithComments as any);
    const scoreNoComments = rankingService.calculateRank(itemNoComments as any);

    console.log({ scoreWithComments, scoreNoComments });
    expect(scoreNoComments).toBeLessThan(scoreWithComments);
    // Should be roughly 20% of the score if it were just about the penalty, 
    // but engagement score is also different.
  });

  it("should penalize posts with < 3 comments", () => {
    const itemManyComments = { ...baseItem, commentCount: 10 };
    const itemFewComments = { ...baseItem, commentCount: 2 };

    const scoreMany = rankingService.calculateRank(itemManyComments as any);
    const scoreFew = rankingService.calculateRank(itemFewComments as any);

    expect(scoreFew).toBeLessThan(scoreMany);
  });

  it("should favor older posts with engagement over new posts with zero engagement", () => {
    const now = new Date();
    const twentyFourHoursAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000).toISOString();
    
    const oldEngagedPost = {
      ...baseItem,
      publishedAt: twentyFourHoursAgo,
      score: 50,
      commentCount: 20
    };

    const newEmptyPost = {
      ...baseItem,
      publishedAt: now.toISOString(),
      score: 1, // Minimal score
      commentCount: 0
    };

    const oldScore = rankingService.calculateRank(oldEngagedPost as any);
    const newScore = rankingService.calculateRank(newEmptyPost as any);

    console.log({ oldScore, newScore });
    expect(oldScore).toBeGreaterThan(newScore);
  });
});

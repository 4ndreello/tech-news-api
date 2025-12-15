import { singleton } from "tsyringe";
import type { NewsItem } from "../types";

@singleton()
export class RankingService {
  // Simple engagement-based ranking
  // Formula: Score + (Comments * Weight)
  //
  // Score (points/tabcoins) represents approval/quality
  // Comments represent engagement and discussion value
  // Weight determines how much comments matter vs pure score
  calculateRank(item: NewsItem): number {
    const score = item.score || 0;
    const comments = item.commentCount || 0;

    // Comments weight: how much a comment is worth compared to a point
    // 0.3 means ~3 comments = 1 point in value
    const COMMENT_WEIGHT = 0.3;

    const baseScore = score + comments * COMMENT_WEIGHT;

    // Time-based penalty: penalize both very recent and very old posts
    // Sweet spot: 6 hours to 5 days
    const publishedDate = new Date(item.publishedAt);
    const now = new Date();
    const ageInHours =
      (now.getTime() - publishedDate.getTime()) / (1000 * 60 * 60);

    // Define time windows
    const MIN_IDEAL_HOURS = 6; // 12 hours
    const MAX_IDEAL_HOURS = 5 * 24; // 5 days

    let timePenalty = 1; // No penalty by default

    if (ageInHours < MIN_IDEAL_HOURS) {
      // Penalize very recent posts (< 12h)
      // The penalty decreases as the post gets closer to 12h
      // At 0h: penalty = 0.3 (70% reduction)
      // At 12h: penalty = 1.0 (no reduction)
      timePenalty = 0.3 + (0.7 * ageInHours) / MIN_IDEAL_HOURS;
    } else if (ageInHours > MAX_IDEAL_HOURS) {
      // Penalize old posts (> 5 days) with exponential decay
      // Similar to Hacker News algorithm
      const GRAVITY = 1.8;
      const hoursOverIdeal = ageInHours - MAX_IDEAL_HOURS;
      timePenalty = 1 / Math.pow(hoursOverIdeal + 2, GRAVITY);
    }
    // else: between 12h and 5 days -> no penalty (timePenalty = 1)

    return baseScore * timePenalty;
  }
}

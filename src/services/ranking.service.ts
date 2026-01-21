import { singleton } from "tsyringe";
import type { NewsItem } from "../types";

@singleton()
export class RankingService {
  // Logarithmic Hot Ranking (Reddit-style) with AI tech relevance
  // Formula: [log10(engagement) / (ageHours + 2)^gravity] * techBoost * 1000
  //
  // This normalizes scores across different sources (HackerNews vs TabNews)
  // by using logarithmic scale instead of absolute values
  //
  // Engagement = score + (comments * weight)
  // TechScore (0-100) is AI-based tech relevance boost
  calculateRank(item: NewsItem): number {
    const score = item.score || 0;
    const comments = item.commentCount || 0;
    const techScore = item.techScore || 0;

    // 0.3 means ~3 comments = 1 point in value
    const COMMENT_WEIGHT = 0.8;
    const LIKE_WEIGHT = 1.2;

    // Calculate total engagement (combines score + comments)
    const engagement = score * LIKE_WEIGHT + comments * COMMENT_WEIGHT;

    // Logarithmic normalization: compresses large numbers, values small numbers
    // log10(1) = 0, log10(10) = 1, log10(100) = 2, log10(1000) = 3
    // This equalizes HN (600 points) with TabNews (14 points)
    const normalizedScore = Math.log10(Math.max(1, engagement));

    // Time decay: posts get exponentially less relevant as they age
    const publishedDate = new Date(item.publishedAt);
    const now = new Date();
    const ageInHours =
      (now.getTime() - publishedDate.getTime()) / (1000 * 60 * 60);

    // Gravity controls how fast old posts decay (1.8 is Reddit's standard)
    // Higher gravity = faster decay
    const GRAVITY = 1.2;
    const ageDecay = Math.pow(ageInHours + 6, GRAVITY); // +6 prevents division by zero and expands "fresh" window

    // Tech score boost: multiplier based on AI relevance (0-100)
    // 100 = 1.5x boost (50% increase)
    // 80 = 1.4x boost
    // 61 = 1.305x boost (minimum passing score)
    // 0 = 1.0x (no boost)
    const TECH_SCORE_WEIGHT = 0.015; // 0.5% boost per point
    const techBoost = 1 + techScore * TECH_SCORE_WEIGHT;

    // Penalty for low comments (dilutes empty posts)
    let commentPenalty = 1.0;
    if (comments === 0) {
      commentPenalty = 0.2; // 80% penalty for 0 comments
    } else if (comments < 3) {
      commentPenalty = 0.5; // 50% penalty for < 3 comments
    }

    // Final score: multiply by 1000 for human-readable numbers
    // Example: 0.055 → 55, 0.12 → 120
    const SCALE_FACTOR = 1000;

    return Math.round(
      (normalizedScore / ageDecay) * techBoost * commentPenalty * SCALE_FACTOR
    );
  }
}

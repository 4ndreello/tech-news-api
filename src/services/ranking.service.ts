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

    return score + comments * COMMENT_WEIGHT;
  }
}

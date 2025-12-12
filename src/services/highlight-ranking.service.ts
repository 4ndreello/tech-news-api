import { singleton } from "tsyringe";
import type { Highlight, RedditPost } from "../types";

function decodeHtmlEntities(str: string): string {
  return str
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&apos;/g, "'")
    .replace(/&nbsp;/g, " ");
}

@singleton()
export class HighlightRankingService {
  private readonly TECH_KEYWORDS = [
    "react",
    "typescript",
    "javascript",
    "node.js",
    "nodejs",
    "performance",
    "tutorial",
    "framework",
    "deploy",
    "optimization",
    "api",
    "nextjs",
    "next.js",
    "vue",
    "angular",
    "svelte",
    "webdev",
    "backend",
    "frontend",
    "fullstack",
    "database",
    "postgres",
    "mongodb",
    "docker",
    "kubernetes",
    "aws",
    "security",
    "authentication",
    "testing",
    "ci/cd",
    "git",
    "vscode",
    "ai",
    "machine learning",
    "algorithm",
  ];

  // Calculate relevance score (0-100) using heuristics
  calculateRelevance(post: RedditPost): number {
    let score = 0;

    const title = post.data.title.toLowerCase();
    const body = post.data.selftext?.toLowerCase() || "";
    const content = `${title} ${body}`;

    // Keyword matching (max 40 points)
    const matchedKeywords = this.TECH_KEYWORDS.filter((keyword) =>
      content.includes(keyword.toLowerCase()),
    );
    score += Math.min(matchedKeywords.length * 5, 40);

    // Engagement score (max 30 points)
    const upvotes = post.data.ups;
    score += Math.min(upvotes / 100, 30);

    // Comment engagement (max 20 points)
    const comments = post.data.num_comments;
    score += Math.min(comments / 10, 20);

    // Recency bonus (max 10 points)
    const hoursAgo =
      (Date.now() - post.data.created_utc * 1000) / (1000 * 60 * 60);
    if (hoursAgo < 6) score += 10;
    else if (hoursAgo < 12) score += 7;
    else if (hoursAgo < 24) score += 4;

    return Math.min(Math.round(score), 100);
  }

  // Generate summary from post content
  generateSummary(post: RedditPost): string {
    const body = post.data.selftext;

    if (!body || body.length === 0) {
      // For link posts, use title as summary
      return post.data.title.substring(0, 200);
    }

    // Extract first 2 sentences
    const sentences = body.split(/[.!?]+/).filter((s) => s.trim().length > 0);
    const summary = sentences.slice(0, 2).join(". ");

    // Limit to 200 characters
    if (summary.length > 200) {
      return summary.substring(0, 197) + "...";
    }

    return summary || post.data.title;
  }

  // Normalize Reddit post to Highlight
  normalizeRedditPost(post: RedditPost): Highlight {
    const relevance = this.calculateRelevance(post);

    return {
      id: `rd-${post.data.id}`,
      title: decodeHtmlEntities(post.data.title),
      summary: this.generateSummary(post),
      source: "reddit",
      author: post.data.author,
      url: `https://reddit.com${post.data.permalink}`,
      engagement: {
        upvotes: post.data.ups,
        comments: post.data.num_comments,
      },
      publishedAt: new Date(post.data.created_utc * 1000).toISOString(),
      aiConfidence: relevance,
    };
  }

  // Calculate combined engagement score for ranking
  calculateEngagementScore(highlight: Highlight): number {
    const upvotes = highlight.engagement.upvotes || 0;
    const comments = highlight.engagement.comments || 0;

    // Engagement score with comment weight
    return upvotes + comments * 2; // Comments are worth 2x upvotes
  }

  // Rank highlights by combined score
  rankHighlights(highlights: Highlight[]): Highlight[] {
    return highlights.sort((a, b) => {
      const scoreA = a.aiConfidence * this.calculateEngagementScore(a);
      const scoreB = b.aiConfidence * this.calculateEngagementScore(b);
      return scoreB - scoreA;
    });
  }
}

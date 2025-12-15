import { singleton } from "tsyringe";
import type {
  ArticleWithAuthor,
  DevToArticle,
  Highlight,
  RedditPost,
  TwitterTweet,
} from "../types";

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
      content.includes(keyword.toLowerCase())
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
    const likes = highlight.engagement.likes || 0;
    const comments = highlight.engagement.comments || 0;
    const shares = highlight.engagement.shares || 0;

    // For Reddit: upvotes + comments * 2
    // For Twitter: likes + comments * 2 + shares * 1.5
    // For Dev.to (source "twitter" usado): likes (reactions) + comments * 3
    if (highlight.source === "reddit") {
      return upvotes + comments * 2;
    } else if (highlight.source === "twitter") {
      // Twitter logic: likes + comments * 2 + shares * 1.5
      return likes + comments * 2 + shares * 1.5;
    } else if (highlight.source === "devto") {
      // Dev.to logic: likes (reactions) + comments * 3
      return likes + comments * 3;
    }

    return upvotes + likes + comments * 2 + (shares || 0) * 1.5;
  }

  // Rank highlights by combined score
  rankHighlights(highlights: Highlight[]): Highlight[] {
    return highlights.sort((a, b) => {
      const scoreA = a.aiConfidence * this.calculateEngagementScore(a);
      const scoreB = b.aiConfidence * this.calculateEngagementScore(b);
      return scoreB - scoreA;
    });
  }

  // === TWITTER METHODS ===

  // Calculate relevance score for Twitter (0-100)
  calculateRelevanceForTwitter(tweet: TwitterTweet): number {
    let score = 0;

    const content = tweet.text.toLowerCase();

    // Keyword matching (max 40 points)
    const matchedKeywords = this.TECH_KEYWORDS.filter((keyword) =>
      content.includes(keyword.toLowerCase())
    );
    score += Math.min(matchedKeywords.length * 5, 40);

    // Engagement score (max 30 points)
    const likes = tweet.public_metrics.like_count;
    score += Math.min(likes / 100, 30);

    // Comment/reply engagement (max 20 points)
    const replies = tweet.public_metrics.reply_count;
    score += Math.min(replies / 5, 20);

    // Recency bonus (max 10 points)
    const hoursAgo =
      (Date.now() - new Date(tweet.created_at).getTime()) / (1000 * 60 * 60);
    if (hoursAgo < 6) score += 10;
    else if (hoursAgo < 12) score += 7;
    else if (hoursAgo < 24) score += 4;

    return Math.min(Math.round(score), 100);
  }

  // Generate summary from tweet
  generateSummaryForTwitter(tweet: TwitterTweet): string {
    // Remove URLs from tweet text for cleaner summary
    let summary = tweet.text;

    if (tweet.entities?.urls) {
      tweet.entities.urls.forEach((url) => {
        summary = summary.replace(url.url, "");
      });
    }

    // Limit to 200 characters
    summary = summary.trim();
    if (summary.length > 200) {
      return summary.substring(0, 197) + "...";
    }

    return summary;
  }

  // Normalize Twitter tweet to Highlight
  normalizeTwitterTweet(tweet: TwitterTweet, username: string): Highlight {
    const relevance = this.calculateRelevanceForTwitter(tweet);

    return {
      id: `tw-${tweet.id}`,
      title: this.generateSummaryForTwitter(tweet),
      summary: this.generateSummaryForTwitter(tweet),
      source: "devto",
      author: username,
      url: `https://twitter.com/${username}/status/${tweet.id}`,
      engagement: {
        likes: tweet.public_metrics.like_count,
        comments: tweet.public_metrics.reply_count,
        shares: tweet.public_metrics.retweet_count,
      },
      publishedAt: tweet.created_at,
      aiConfidence: relevance,
    };
  }

  // === DEV.TO METHODS ===

  // Calculate relevance score for Dev.to articles (0-100)
  calculateRelevanceForDevTo(article: DevToArticle): number {
    let score = 0;

    const title = article.title.toLowerCase();
    const desc = (article.description || "").toLowerCase();
    const tags = article.tag_list.join(" ").toLowerCase();
    const content = `${title} ${desc} ${tags}`;

    // Keyword matching (max 40 points)
    const matchedKeywords = this.TECH_KEYWORDS.filter((keyword) =>
      content.includes(keyword.toLowerCase())
    );
    score += Math.min(matchedKeywords.length * 5, 40);

    // Engagement score (max 30 points)
    const reactions = article.positive_reactions_count;
    score += Math.min(reactions / 20, 30);

    // Comment engagement (max 20 points)
    const comments = article.comments_count;
    score += Math.min(comments / 3, 20);

    // Recency bonus (max 10 points)
    const hoursAgo =
      (Date.now() - new Date(article.published_at).getTime()) /
      (1000 * 60 * 60);
    if (hoursAgo < 24) score += 10;
    else if (hoursAgo < 48) score += 7;
    else if (hoursAgo < 72) score += 4;

    return Math.min(Math.round(score), 100);
  }

  // Normalize Dev.to article to Highlight
  normalizeDevToArticle(article: DevToArticle, username: string): Highlight {
    const relevance = this.calculateRelevanceForDevTo(article);

    // Use description as summary, fallback to title
    let summary = article.description || article.title;
    if (summary.length > 200) {
      summary = summary.substring(0, 197) + "...";
    }

    return {
      id: `dt-${article.id}`,
      title: article.title,
      summary: summary,
      source: "devto",
      author: username,
      url: article.url,
      engagement: {
        likes: article.positive_reactions_count,
        comments: article.comments_count,
      },
      publishedAt: article.published_at,
      aiConfidence: relevance,
    };
  }
}

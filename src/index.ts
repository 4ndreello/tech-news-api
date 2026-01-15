import { Hono } from "hono";
import { cors } from "hono/cors";
import "reflect-metadata";
import { container } from "tsyringe";
import { logger } from "./logger";
import { loggingMiddleware } from "./middleware/logging";
import { FeedService } from "./services/feed.service";
import { HackerNewsService } from "./services/hackernews.service";
import { AnalyticsService } from "./services/analytics.service";
import {
  getServicesStatus,
  startBackgroundUpdates,
} from "./services/status-checker";
import { TabNewsService } from "./services/tabnews.service";
import type { AnalyticsPeriod } from "./types";

const app = new Hono();

// logging Middleware - must be first
app.use("/*", loggingMiddleware);

// cors configuration - allow frontend access
app.use(
  "/*",
  cors({
    origin: [
      "http://localhost:3000",
      "http://0.0.0.0:3000",
      "https://tech-news-front-361874528796.southamerica-east1.run.app",
      "https://news.andreello.dev.br",
    ],
    credentials: true,
  }),
);

app.get("/", (c) => {
  return c.json({
    message: "TechNews API - Powered by Hono + Bun",
    version: "2.0.0",
    endpoints: {
      tabnews: "/api/news/tabnews",
      hackernews: "/api/news/hackernews",
      feed: "/api/feed",
      comments: "/api/comments/:username/:slug",
      servicesStatus: "/api/services/status",
      analytics: {
        trending: "/api/analytics/trending?period=7d",
        stats: "/api/analytics/stats",
      },
    },
  });
});

// get tabnews articles
app.get("/api/news/tabnews", async (c) => {
  try {
    const tabNewsService = container.resolve(TabNewsService);
    const news = await tabNewsService.fetchNews();
    return c.json(news);
  } catch (error) {
    const logger = c.get("logger");
    logger.error("error fetching TabNews", {
      error: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack : undefined,
    });
    return c.json(
      {
        error:
          error instanceof Error ? error.message : "Erro ao carregar TabNews",
      },
      500,
    );
  }
});

// get hacker news articles
app.get("/api/news/hackernews", async (c) => {
  try {
    const hackerNewsService = container.resolve(HackerNewsService);
    const news = await hackerNewsService.fetchNews();
    return c.json(news);
  } catch (error) {
    const logger = c.get("logger");
    logger.error("error fetching Hacker News", {
      error: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack : undefined,
    });
    return c.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Erro ao carregar Hacker News",
      },
      500,
    );
  }
});

// Get unified feed (news from TabNews, HackerNews, and Dev.to)
app.get("/api/feed", async (c) => {
  try {
    const feedService = container.resolve(FeedService);

    // Validar limit (1-10, default 10)
    const limit = Math.max(1, Math.min(Number(c.req.query("limit")) || 10, 10));

    // Pegar cursor opcional (único, para lista intercalada)
    const after = c.req.query("after");

    // Buscar feed intercalado
    const feed = await feedService.fetchFeed(limit, after);

    // Headers
    c.header("Cache-Control", "public, max-age=300");
    c.header("X-AI-Processed", "true");

    return c.json(feed);
  } catch (error) {
    const logger = c.get("logger");
    logger.error("error fetching unified feed", {
      error: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack : undefined,
    });
    return c.json(
      {
        error: error instanceof Error ? error.message : "Failed to load feed",
      },
      500,
    );
  }
});

// Get comments for a specific TabNews article
app.get("/api/comments/:username/:slug", async (c) => {
  try {
    const username = c.req.param("username");
    const slug = c.req.param("slug");

    if (!username || !slug) {
      return c.json({ error: "Username e slug são obrigatórios" }, 400);
    }

    const tabNewsService = container.resolve(TabNewsService);
    const comments = await tabNewsService.fetchComments(username, slug);
    return c.json(comments);
  } catch (error) {
    const logger = c.get("logger");
    logger.error("error fetching comments", {
      error: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack : undefined,
    });
    return c.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Erro ao carregar comentários",
      },
      500,
    );
  }
});

app.get("/api/services/status", async (c) => {
  try {
    const status = await getServicesStatus();
    return c.json(status);
  } catch (error) {
    const logger = c.get("logger");
    logger.error("error fetching services status", {
      error: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack : undefined,
    });
    return c.json(
      {
        error: "Falha ao carregar status dos serviços",
      },
      500,
    );
  }
});

app.get("/api/analytics/trending", async (c) => {
  try {
    const analyticsService = container.resolve(AnalyticsService);

    const periodParam = c.req.query("period") || "7d";
    const validPeriods = ["24h", "7d", "30d"];
    const period: AnalyticsPeriod = validPeriods.includes(periodParam)
      ? (periodParam as AnalyticsPeriod)
      : "7d";

    const trending = await analyticsService.getTrendingTopics(period);

    c.header("Cache-Control", "public, max-age=900");

    return c.json(trending);
  } catch (error) {
    const logger = c.get("logger");
    logger.error("error fetching trending topics", {
      error: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack : undefined,
    });
    return c.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Failed to load trending topics",
      },
      500,
    );
  }
});

app.get("/api/analytics/stats", async (c) => {
  try {
    const analyticsService = container.resolve(AnalyticsService);

    const [warehouseStats, processingStats] = await Promise.all([
      analyticsService.getWarehouseStats(),
      analyticsService.getProcessingStats(
        new Date(Date.now() - 24 * 60 * 60 * 1000),
      ),
    ]);

    c.header("Cache-Control", "public, max-age=300");

    return c.json({
      warehouse: warehouseStats,
      processing: processingStats,
      generatedAt: new Date().toISOString(),
    });
  } catch (error) {
    const logger = c.get("logger");
    logger.error("error fetching analytics stats", {
      error: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack : undefined,
    });
    return c.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Failed to load analytics stats",
      },
      500,
    );
  }
});

app.notFound((c) => {
  return c.json(
    {
      error: "Endpoint não encontrado",
      availableEndpoints: [
        "GET /",
        "GET /api/news/tabnews",
        "GET /api/news/hackernews",
        "GET /api/feed",
        "GET /api/comments/:username/:slug",
        "GET /api/services/status",
        "GET /api/analytics/trending?period=7d",
        "GET /api/analytics/stats",
      ],
    },
    404,
  );
});

// Error handler
app.onError((err, c) => {
  const contextLogger = c.get("logger");
  if (contextLogger) {
    contextLogger.error("server error", {
      error: err.message,
      stack: err.stack,
    });
  } else {
    logger.error("server error (no context)", {
      error: err.message,
      stack: err.stack,
    });
  }
  return c.json({ error: err.message || "Erro interno do servidor" }, 500);
});

const port = process.env.PORT || 8080;

// Start background task for service status monitoring
startBackgroundUpdates();

logger.info(`techNews API running on http://localhost:${port}`);

export default {
  port,
  fetch: app.fetch,
};

import { Hono } from "hono";
import { cors } from "hono/cors";
import "reflect-metadata";
import { container } from "tsyringe";
import { logger } from "./logger";
import { loggingMiddleware } from "./middleware/logging";
import { HackerNewsService } from "./services/hackernews.service";
import { HighlightsService } from "./services/highlights.service";
import { SmartMixService } from "./services/smartmix.service";
import {
  getServicesStatus,
  startBackgroundUpdates,
} from "./services/status-checker";
import { TabNewsService } from "./services/tabnews.service";

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
    ],
    credentials: true,
  }),
);

// health check endpoint
app.get("/", (c) => {
  return c.json({
    message: "TechNews API - Powered by Hono + Bun",
    version: "1.0.0",
    endpoints: {
      tabnews: "/api/news/tabnews",
      hackernews: "/api/news/hackernews",
      mix: "/api/news/mix",
      highlights: "/api/highlights",
      comments: "/api/comments/:username/:slug",
      servicesStatus: "/api/services/status",
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
    logger.error("Error fetching TabNews", {
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
    logger.error("Error fetching Hacker News", {
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

// get smart mix (interleaved, ranked articles from both sources) with cursor pagination
app.get("/api/news/mix", async (c) => {
  try {
    const smartMixService = container.resolve(SmartMixService);
    const allNews = await smartMixService.fetchMix();

    // Pagination params
    const limit = Math.max(1, Math.min(Number(c.req.query("limit")) || 10, 50));
    const after = c.req.query("after");

    let startIdx = 0;
    if (after) {
      const idx = allNews.findIndex((n) => n.id === after);
      if (idx >= 0) {
        startIdx = idx + 1;
      }
    }
    const items = allNews.slice(startIdx, startIdx + limit);
    const nextCursor =
      items.length === limit && startIdx + limit < allNews.length
        ? items[items.length - 1].id
        : null;

    return c.json({ items, nextCursor });
  } catch (error) {
    const logger = c.get("logger");
    logger.error("Error fetching Smart Mix", {
      error: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack : undefined,
    });
    return c.json(
      {
        error:
          error instanceof Error ? error.message : "Failed to load news mix",
      },
      500,
    );
  }
});

// get AI-curated highlights from Reddit with cursor pagination
app.get("/api/highlights", async (c) => {
  try {
    const highlightsService = container.resolve(HighlightsService);
    const allHighlights = await highlightsService.fetchHighlights();

    // Pagination params
    const limit = Math.max(1, Math.min(Number(c.req.query("limit")) || 10, 50));
    const after = c.req.query("after");

    let startIdx = 0;
    if (after) {
      const idx = allHighlights.findIndex((h) => h.id === after);
      if (idx >= 0) {
        startIdx = idx + 1;
      }
    }

    const items = allHighlights.slice(startIdx, startIdx + limit);
    const nextCursor =
      items.length === limit && startIdx + limit < allHighlights.length
        ? items[items.length - 1].id
        : null;

    // Set cache headers (30min)
    c.header("Cache-Control", "public, max-age=1800");
    c.header("X-AI-Processed", "true");

    return c.json({ items, nextCursor });
  } catch (error) {
    const logger = c.get("logger");
    logger.error("Error fetching Highlights", {
      error: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack : undefined,
    });
    return c.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Erro ao carregar highlights",
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
    logger.error("Error fetching comments", {
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

// Get cloud services status
app.get("/api/services/status", async (c) => {
  try {
    const status = await getServicesStatus();
    return c.json(status);
  } catch (error) {
    const logger = c.get("logger");
    logger.error("Error fetching services status", {
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

// 404 handler
app.notFound((c) => {
  return c.json(
    {
      error: "Endpoint não encontrado",
      availableEndpoints: [
        "GET /",
        "GET /api/news/tabnews",
        "GET /api/news/hackernews",
        "GET /api/news/mix",
        "GET /api/highlights",
        "GET /api/comments/:username/:slug",
        "GET /api/services/status",
      ],
    },
    404,
  );
});

// Error handler
app.onError((err, c) => {
  const contextLogger = c.get("logger");
  if (contextLogger) {
    contextLogger.error("Server error", {
      error: err.message,
      stack: err.stack,
    });
  } else {
    logger.error("Server error (no context)", {
      error: err.message,
      stack: err.stack,
    });
  }
  return c.json({ error: err.message || "Erro interno do servidor" }, 500);
});

const port = process.env.PORT || 8080;

// Start background task for service status monitoring
startBackgroundUpdates();

logger.info(`TechNews API rodando em http://localhost:${port}`);

export default {
  port,
  fetch: app.fetch,
};

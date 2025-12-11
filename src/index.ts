import { Hono } from "hono";
import { cors } from "hono/cors";
import {
  fetchTabNews,
  fetchHackerNews,
  fetchSmartMix,
  fetchTabNewsComments,
} from "./service";
import { loggingMiddleware } from "./middleware/logging";
import { logger } from "./logger";

const app = new Hono();

// Logging Middleware - Must be first
app.use("/*", loggingMiddleware);

// CORS Configuration - Allow frontend access
app.use(
  "/*",
  cors({
    origin: ["http://localhost:3000", "http://0.0.0.0:3000"],
    credentials: true,
  }),
);

// Health check endpoint
app.get("/", (c) => {
  return c.json({
    message: "TechNews API - Powered by Hono + Bun",
    version: "1.0.0",
    endpoints: {
      tabnews: "/api/news/tabnews",
      hackernews: "/api/news/hackernews",
      mix: "/api/news/mix",
      comments: "/api/comments/:username/:slug",
    },
  });
});

// Get TabNews articles
app.get("/api/news/tabnews", async (c) => {
  try {
    const news = await fetchTabNews();
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

// Get Hacker News articles
app.get("/api/news/hackernews", async (c) => {
  try {
    const news = await fetchHackerNews();
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

// Get Smart Mix (interleaved, ranked articles from both sources)
app.get("/api/news/mix", async (c) => {
  try {
    const news = await fetchSmartMix();
    return c.json(news);
  } catch (error) {
    const logger = c.get("logger");
    logger.error("Error fetching Smart Mix", {
      error: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack : undefined,
    });
    return c.json(
      {
        error:
          error instanceof Error ? error.message : "Erro ao carregar notícias",
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

    const comments = await fetchTabNewsComments(username, slug);
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
        "GET /api/comments/:username/:slug",
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

logger.info(`🚀 TechNews API rodando em http://localhost:${port}`);

export default {
  port,
  fetch: app.fetch,
};

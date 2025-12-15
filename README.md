# TechNews API

Backend service that aggregates tech news from multiple sources (TabNews, Hacker News, Dev.to) with AI-curated highlights. Built with Hono and Bun for high performance.

## Overview

This API provides a unified feed that combines news articles from different tech communities, applies intelligent ranking algorithms, and uses Google Gemini AI to generate curated highlights. The service is designed to be stateless, horizontally scalable, and optimized for low latency.

## Tech Stack

- **Bun** - Fast JavaScript runtime
- **Hono** - Lightweight web framework
- **TypeScript** - Static typing
- **TSyringe** - Dependency injection with decorators
- **Pino** - Structured logging
- **Google Gemini AI** - Content analysis and summarization
- **Vitest** - Testing framework

## Quick Start

### Prerequisites

- [Bun](https://bun.sh/) 1.0+
- Google Gemini API key (for AI features)

### Installation

```bash
# Install dependencies
bun install

# Copy environment variables
cp .env.example .env

# Configure your .env file with:
# - GEMINI_API_KEY (required for highlights)
# - PORT (default: 8080)
```

### Running the Server

```bash
# Development mode (hot reload, port 3001)
bun run dev

# Production mode (port 8080)
bun start
```

Server runs on:
- Development: http://localhost:3001
- Production: http://localhost:8080

## API Endpoints

### Main Feed (Recommended)

```http
GET /api/feed?limit=10&after=<cursor>
```

Unified feed with cursor-based pagination. Interleaves news and AI-curated highlights in a 5:1 ratio.

**Query Parameters:**
- `limit` - Items per page (1-10, default: 10)
- `after` - Cursor for next page (ID of last item from previous response)

**Response:**
```json
{
  "items": [
    {
      "id": "unique-id",
      "title": "Article title",
      "author": "username",
      "score": 42,
      "publishedAt": "2025-12-15T10:00:00.000Z",
      "source": "TabNews",
      "url": "https://...",
      "commentCount": 15
    }
  ],
  "nextCursor": "id-for-next-page"
}
```

### Legacy Endpoints

```http
GET /api/news/tabnews          # All TabNews articles
GET /api/news/hackernews       # All Hacker News articles
GET /api/comments/:username/:slug  # TabNews post comments
GET /api/services/status       # External services health check
```

### Root Endpoint

```http
GET /
```

Returns API information and available endpoints.

## Architecture

### Service Layer

**Data Fetching Services**
- `TabNewsService` - Fetches articles from TabNews API
- `HackerNewsService` - Fetches stories from Hacker News API
- `DevToService` - Fetches articles from Dev.to API

**Ranking Services**
- `RankingService` - Time-decayed engagement ranking for news
- `HighlightRankingService` - AI relevance-based ranking for highlights

**Aggregation Services**
- `SmartMixService` - Combines TabNews + Hacker News with intelligent interleaving
- `HighlightsService` - Generates AI-curated highlights from Dev.to

**Infrastructure Services**
- `CacheService` - In-memory caching with TTL
- `GeminiService` - Google Gemini AI integration
- `LoggerService` - Request-scoped logging with correlation IDs

### Dependency Injection

Uses TSyringe for dependency injection:

```typescript
@singleton()
export class MyService {
  constructor(
    @inject(CacheService) private cache: CacheService,
    @inject(LoggerService) private logger: LoggerService
  ) {}
}
```

All services are singletons and resolved via `container.resolve(ServiceClass)` in route handlers.

### Ranking Algorithm

News items are ranked using time-decayed engagement:

```
score = (points + comments × 0.3) × timePenalty
```

**Time Penalty:**
- Posts < 6 hours old: Reduced score (too recent)
- Posts 6 hours to 5 days old: Full score (sweet spot)
- Posts > 5 days old: Exponential decay with gravity factor of 1.8

This balances fresh content with high-quality older posts.

### Caching Strategy

In-memory cache with automatic expiration:

- **News articles**: 5 minutes TTL
- **AI highlights**: 10 minutes TTL
- Cache clears on server restart (ephemeral)
- Pattern: Check cache → Fetch on miss → Store → Return

### Logging

Dual-mode logging with Pino:

**Development:**
- Colorized output with pino-pretty
- Human-readable timestamps

**Production:**
- Structured JSON logs
- GCP Cloud Logging format
- Correlation IDs for distributed tracing
- Severity levels mapped to GCP standards

### Request Context

Uses AsyncLocalStorage for request tracing:
- Each request gets a unique correlation ID
- IDs propagate through all async operations
- Enables distributed tracing across services

## Testing

```bash
bun test              # Watch mode
bun run test:ui       # UI mode
bun run test:run      # Run once
bun run test:coverage # Coverage report
```

Tests use Vitest with TypeScript. Remember to:
- Import "reflect-metadata" at top of test files
- Clear DI container between tests: `container.clearInstances()`
- Mock external APIs with `vi.fn()` and `vi.spyOn()`

## Environment Variables

Create a `.env` file:

```bash
PORT=8080                      # Server port
GEMINI_API_KEY=your_key_here  # Google Gemini API (required for highlights)
TWITTER_BEARER_TOKEN=token    # Optional: Twitter API
TWITTER_API_KEY=key           # Optional: Twitter API
TWITTER_API_SECRET=secret     # Optional: Twitter API
```

## CORS Configuration

Allowed origins:
- `http://localhost:3000` (local development)
- `http://0.0.0.0:3000`
- `https://tech-news-front-361874528796.southamerica-east1.run.app` (Cloud Run)
- `https://news.andreello.dev.br` (production)

Configure in `src/index.ts` if you need additional origins.

## Error Handling

All endpoints return standardized error responses:

```json
{
  "success": false,
  "error": "Descriptive error message"
}
```

HTTP status codes:
- `400` - Bad Request
- `404` - Not Found
- `500` - Internal Server Error

Errors are logged with correlation IDs and stack traces for debugging.

## Project Structure

```
tech-news-api/
├── src/
│   ├── index.ts                    # Server entry point, routes
│   ├── logger.ts                   # Pino logger configuration
│   ├── types.ts                    # TypeScript types
│   ├── context/
│   │   └── request-context.ts      # AsyncLocalStorage for correlation IDs
│   ├── middleware/
│   │   └── logging.ts              # Request logging middleware
│   └── services/
│       ├── cache.service.ts        # In-memory caching
│       ├── tabnews.service.ts      # TabNews API client
│       ├── hackernews.service.ts   # Hacker News API client
│       ├── devto.service.ts        # Dev.to API client
│       ├── ranking.service.ts      # News ranking algorithm
│       ├── smartmix.service.ts     # News aggregation
│       ├── highlights.service.ts   # AI highlights generation
│       └── gemini.service.ts       # Google Gemini AI client
├── package.json
├── tsconfig.json
├── .env.example
└── README.md
```

## Deployment

### Docker

```dockerfile
FROM oven/bun:1
WORKDIR /app
COPY package.json bun.lockb ./
RUN bun install --frozen-lockfile
COPY . .
EXPOSE 8080
CMD ["bun", "start"]
```

Build and run:

```bash
docker build -t tech-news-api .
docker run -p 8080:8080 tech-news-api
```

### Google Cloud Run

The application is optimized for Cloud Run:
- Runs on port 8080 (default)
- Structured logging for GCP Cloud Logging
- Stateless design (horizontally scalable)
- Health checks via `/api/services/status`

## Common Development Tasks

### Adding a New News Source

1. Create service in `src/services/<source>.service.ts` with `@singleton()` decorator
2. Implement `fetchNews(): Promise<NewsItem[]>` method
3. Add source to `Source` enum in `src/types.ts`
4. Update `SmartMixService` to include new source
5. Add route in `src/index.ts`
6. Update cache key in `CacheKey` enum

### Modifying Ranking Parameters

Edit `src/services/ranking.service.ts`:
- `COMMENT_WEIGHT` - Comment importance vs score (default: 0.3)
- `MIN_IDEAL_HOURS` - Minimum age for full score (default: 6)
- `MAX_IDEAL_HOURS` - Maximum age before decay (default: 120)
- `GRAVITY` - Decay rate for old posts (default: 1.8)

### Adding a New Endpoint

1. Add route in `src/index.ts` using `app.get()` or `app.post()`
2. Resolve services via `container.resolve(ServiceClass)`
3. Access logger via `c.get("logger")`
4. Wrap logic in try-catch
5. Return JSON via `c.json(data, statusCode)`
6. Update root endpoint and 404 handler

## License

MIT

---

Built with Hono and Bun

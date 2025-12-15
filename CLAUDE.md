# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

TechNews API is a backend service built with **Hono** and **Bun** that aggregates tech news from multiple sources (TabNews, Hacker News, Dev.to) and provides AI-curated highlights. The API applies intelligent ranking algorithms and smart mixing to deliver high-quality, diverse content.

## Commands

### Development
```bash
bun run dev          # Start development server with hot reload (port 3001 default, 8080 in prod)
bun start            # Start production server
```

### Testing
```bash
bun test             # Run tests in watch mode
bun run test:ui      # Run tests with UI
bun run test:run     # Run tests once
bun run test:coverage # Run tests with coverage report
```

### Dependencies
```bash
bun install          # Install dependencies
```

## Architecture

### Dependency Injection with TSyringe

This project uses **tsyringe** for dependency injection with decorators:
- All services are decorated with `@singleton()` for singleton lifecycle
- Constructor injection uses `@inject(ServiceClass)`
- Services are resolved via `container.resolve(ServiceClass)` in route handlers
- Must import `"reflect-metadata"` at entry point (already in `src/index.ts`)
- `tsconfig.json` has `experimentalDecorators` and `emitDecoratorMetadata` enabled

Example service:
```typescript
@singleton()
export class MyService {
  constructor(
    @inject(CacheService) private cache: CacheService,
    @inject(LoggerService) private logger: LoggerService
  ) {}
}
```

### Request Context & Correlation IDs

The API uses **AsyncLocalStorage** to track correlation IDs across async operations:
- `src/context/request-context.ts` manages the async context
- `src/middleware/logging.ts` generates correlation IDs per request
- Each request gets a unique correlation ID for tracing through logs
- Use `getCorrelationId()` to retrieve the current request's correlation ID

### Logging System

Dual-mode logging via Pino (`src/logger.ts`):
- **Development**: Uses `pino-pretty` with colorized output and readable timestamps
- **Production**: Structured JSON logs formatted for Google Cloud Platform (GCP) Cloud Logging
  - Maps log levels to GCP severity levels (INFO, WARNING, ERROR, etc.)
  - Includes correlation IDs for distributed tracing
  - No timestamp field (GCP adds its own)

Access logger in routes via `c.get("logger")` (set by logging middleware).

Services can inject `LoggerService` for instance-scoped logging with correlation context.

### Service Layer Architecture

Services follow a clear separation of concerns:

1. **Data Fetching Services** (`tabnews.service.ts`, `hackernews.service.ts`, `devto.service.ts`, `reddit.service.ts`, `twitter.service.ts`)
   - Responsible for fetching raw data from external APIs
   - Transform external API responses to internal `NewsItem` or `Highlight` types
   - Handle API-specific error handling and retries

2. **Ranking Services** (`ranking.service.ts`, `highlight-ranking.service.ts`)
   - `RankingService`: Implements time-decayed engagement ranking for news items
     - Formula: `(score + comments * 0.3) * timePenalty`
     - Penalizes posts < 6 hours old (too recent) and > 5 days old (too old)
     - Sweet spot: 6 hours to 5 days for optimal ranking
   - `HighlightRankingService`: Ranks AI-curated highlights by relevance

3. **Aggregation Services** (`smartmix.service.ts`, `highlights.service.ts`)
   - `SmartMixService`: Combines TabNews + Hacker News with intelligent interleaving
     - Takes top 100 from each source after ranking
     - Interleaves results (TabNews, HN, TabNews, HN, ...) for diversity
   - `HighlightsService`: Aggregates AI-curated highlights from Dev.to (Twitter/Reddit disabled)
     - Uses Gemini AI for summarization and relevance scoring
     - Caches highlights for 10 minutes (vs 5 minutes for news)

4. **Infrastructure Services**
   - `CacheService`: In-memory caching with TTL (5min news, 10min highlights)
   - `GeminiService`: Google Gemini AI integration for content analysis
   - `LinkScraperService`: Extracts metadata from URLs
   - `LoggerService`: Request-scoped logging with correlation IDs

### API Endpoints & Pagination

Main endpoint with **cursor-based pagination**:
- `GET /api/feed?limit=10&after=<id>` - Unified feed (news + highlights interleaved)
- Response format: `{ items: [...], nextCursor: "id" | null }`
- `limit` parameter: 1-10 (default: 10)
- `after` parameter: ID of last item from previous page
- Feed interleaves news and highlights in 5:1 ratio (5 news items, then 1 highlight)

Legacy endpoints (no pagination):
- `GET /api/news/tabnews` - All TabNews articles
- `GET /api/news/hackernews` - All Hacker News articles
- `GET /api/comments/:username/:slug` - TabNews comments for a post
- `GET /api/services/status` - External services health status

### Caching Strategy

The `CacheService` (`src/services/cache.service.ts`) provides in-memory caching with automatic expiration:

**How it works:**
- Stores data with timestamps in a simple `Record<string, CacheEntry<T>>` object
- `get<T>(key: string)`: Returns cached data or `null` if expired/missing
- `set<T>(key: string, data: T)`: Stores data with current timestamp
- `clear()`: Clears all cached entries
- Automatic expiration check on `get()` - expired entries are deleted

**TTL Configuration:**
- **News**: 5 minutes (TabNews, Hacker News) - `CACHE_DURATION`
- **Highlights**: 10 minutes (AI-processed content) - `HIGHLIGHTS_CACHE_DURATION`
- Cache keys defined in `src/types.ts` (`CacheKey` enum: `TabNews`, `HackerNews`, `TabNewsComments`, `Highlights`)

**Important notes:**
- Cache is **in-memory only** - cleared on server restart
- No persistence layer - designed for ephemeral caching
- Each service manages its own cache key and handles cache misses
- Pattern: Check cache → If null, fetch from API → Store in cache → Return data

### Error Handling

- All route handlers wrap logic in try-catch
- Errors are logged with correlation IDs and stack traces
- HTTP responses use appropriate status codes (400, 404, 500)
- Partial failures in aggregation services use `Promise.allSettled()` to gracefully degrade

### Types

All TypeScript types are centralized in `src/types.ts`:
- `NewsItem`: Unified news article interface across sources
- `Highlight`: AI-curated highlight from Twitter/Reddit/Dev.to
- `Source`: Enum for news sources (TabNews, HackerNews)
- `CacheKey`: Enum for cache key names
- External API types: `TabNewsItem`, `HackerNewsItem`, `RedditPost`, `TwitterTweet`, `DevToArticle`

### CORS Configuration

Configured in `src/index.ts` to allow:
- `http://localhost:3000` (local development)
- `http://0.0.0.0:3000`
- `https://tech-news-front-361874528796.southamerica-east1.run.app` (GCP Cloud Run)
- `https://news.andreello.dev.br` (production domain)

## Environment Variables

Copy `.env.example` to `.env` and configure:
- `PORT`: Server port (default: 8080)
- `TWITTER_BEARER_TOKEN`: Twitter API bearer token (for highlights)
- `TWITTER_API_KEY`, `TWITTER_API_SECRET`: Twitter API credentials
- `GEMINI_API_KEY`: Google Gemini API key for AI processing

## Testing Conventions

- Tests use Vitest with TypeScript
- Must import `"reflect-metadata"` at top of test files
- Clear DI container between tests: `container.clearInstances()`
- Mock external APIs using `vi.fn()` and `vi.spyOn()`
- Example: `src/service.test.ts`, `src/services/highlights.test.ts`

## Common Tasks

### Adding a New News Source

1. Create service in `src/services/<source>.service.ts` with `@singleton()` decorator
2. Implement `fetchNews(): Promise<NewsItem[]>` method
3. Add source to `Source` enum in `src/types.ts`
4. Update `SmartMixService` to include new source in `fetchMix()`
5. Add route in `src/index.ts` (optional: individual endpoint for just this source)
6. Update cache key in `CacheKey` enum if needed

### Adding a New API Endpoint

1. Add route handler in `src/index.ts` using Hono's `app.get()` / `app.post()`
2. Resolve required services via `container.resolve(ServiceClass)`
3. Access request logger via `c.get("logger")`
4. Wrap logic in try-catch with proper error logging
5. Return JSON response via `c.json(data, statusCode)`
6. Update root endpoint (`GET /`) to list new endpoint
7. Update 404 handler's `availableEndpoints` array

### Modifying Ranking Algorithm

- Edit `src/services/ranking.service.ts` for news ranking
- Edit `src/services/highlight-ranking.service.ts` for highlight ranking
- Key tunable parameters in `RankingService`:
  - `COMMENT_WEIGHT`: How much comments matter vs score (default: 0.3)
  - `MIN_IDEAL_HOURS`: Minimum age before full score (default: 6 hours)
  - `MAX_IDEAL_HOURS`: Maximum age before decay (default: 5 days)
  - `GRAVITY`: Decay rate for old posts (default: 1.8)

### Working with AI Features

The `GeminiService` (`src/services/gemini.service.ts`) handles AI processing:
- Requires `GEMINI_API_KEY` environment variable
- Used by `HighlightsService` to generate summaries and relevance scores
- AI confidence scores range 0-100
- Implement rate limiting and error handling when calling AI APIs

## Deployment Notes

- Application runs on port 8080 in production (GCP Cloud Run default)
- Uses structured logging for GCP Cloud Logging integration
- No database - all state is in-memory cache (ephemeral)
- Designed to be stateless and horizontally scalable
- Background task: `startBackgroundUpdates()` monitors external service health

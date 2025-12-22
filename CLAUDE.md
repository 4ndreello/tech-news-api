# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

TechNews API is a backend service built with **Hono** and **Bun** that aggregates tech news from multiple sources (TabNews, Hacker News, Dev.to) and provides AI-curated highlights. The API applies intelligent ranking algorithms and smart mixing to deliver high-quality, diverse content.

Uses a **dual MongoDB strategy**:
- **Data Warehouse** (raw_news, ranked_news, mixed_feed): Permanent storage for historical analysis and trends
- **L2 Cache** (cache_entries): Temporary cache with TTL for fast fallback

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
   - `CacheService`: Hybrid L1 (in-memory) + L2 (MongoDB) caching with intelligent TTLs
   - `MongoDBCacheService`: L2 temporary cache with TTL expiration (5-15 min for news, 2h-7d for scores)
   - `DataWarehouseService`: Persistent MongoDB storage for raw/ranked/mixed data (no TTL, permanent)
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

### MongoDB: Dual-Purpose Architecture

**Two separate MongoDB instances (or databases within same cluster):**

#### 1. Data Warehouse (`tech_news_warehouse`) - PERMANENT STORAGE
**Purpose:** Historical archive for analytics, trends, and historical queries

**Collections:**
- `raw_news`: Original API responses (never deleted)
  - _id: `{source}:{itemId}` (e.g., "hackernews:12345")
  - Indexed: `{source, fetchedAt}`, `{fetchedAt}`, `{data.publishedAt}`
  
- `ranked_news`: News items with calculated scores and ranking
  - _id: `{source}:ranked:{itemId}`
  - Contains: `rank`, `score`, `rankedAt` (for time-series analysis)
  - Indexed: `{source, rank}`, `{score}`, `{source, rankedAt}`
  
- `mixed_feed`: Final mixed/interleaved feed snapshots
  - _id: `mixed:{timestamp}`
  - Complete feed at point in time for reproducibility

**Use Cases:**
- Analytics dashboard: "Top 100 articles from last 30 days"
- Trending analysis: "What was trending last week vs today?"
- Historical comparisons: "How rankings changed over time?"
- Audit trail: "What feed was shown to users at time X?"

#### 2. L2 Cache (`tech_news_cache`) - TEMPORARY CACHE WITH TTL
**Purpose:** Fast fallback for server restarts, reduces API calls

**Collections:**
- `cache_entries`: Temporary cache with auto-expiration
  - TTL Index: Auto-deletes expired entries
  - News data: 15 min TTL (L2, can fall back to L1 or API)
  - Tech scores: 7 days TTL (expensive to recalculate)
  - Comments: 30 min TTL

**Use Cases:**
- Server restart: Load fresh cache from L2 instead of re-fetching APIs
- Reduced API calls: Cache queries that just expired from L1

### Hybrid Caching Strategy (L1 + L2)

The `CacheService` implements a **two-tier caching system**:

**Architecture:**
```
┌─────────────────────────────────────────────────────┐
│ Request for Cache Key                               │
├─────────────────────────────────────────────────────┤
│ ↓                                                   │
│ L1: In-Memory Cache (JavaScript object)             │
│     - Very fast (<1ms), local to process            │
│     - Expires based on TTL (3 min - 2 hours)        │
│ ↓ (miss)                                            │
│ L2: MongoDB L2 Cache (persistent, fallback)         │
│     - Slower (5-50ms), but survives restart         │
│     - Longer TTL (15 min - 7 days)                  │
│ ↓ (miss)                                            │
│ Fetch from API and populate all tiers               │
└─────────────────────────────────────────────────────┘
```

**TTL Configuration by Data Type:**

| Data Type | L1 TTL | L2 TTL | Rationale |
|-----------|--------|--------|-----------|
| News Data (TabNews, HackerNews, DevTo, Lobsters) | 3 min | 15 min | Fresh content, but fallback for restart |
| Tech Scores (AI analysis) | 2 hours | 7 days | Expensive to recalculate, cache longer |
| Comments | 5 min | 30 min | Less frequently updated |

**How it works:**
1. `get()` tries L1 → L2 in order, returning first hit
2. `set()` writes to both tiers simultaneously
3. If L1 expires but L2 has data → L2 populates L1 (rehydration)
4. L2 uses MongoDB TTL indexes for automatic expiration (no manual cleanup needed)

**When to use custom TTL:**
```typescript
// Default TTL based on key pattern
await cacheService.set(key, data);

// Custom TTL (example: 1 hour)
await cacheService.set(key, data, 3600);
```

**Implementation Details:**
- `CacheService` coordinates both tiers (`src/services/cache.service.ts`)
- `MongoDBCacheService` handles L2 persistence (`src/services/mongodb-cache.service.ts`)
- `DataWarehouseService` handles permanent data (`src/services/data-warehouse.service.ts`)
- Graceful degradation: if MongoDB is down, falls back to L1 only
- If all tiers fail, service fetches from API

### Environment Variables

Copy `.env.example` to `.env` and configure:

**Cache Configuration:**
- `MONGODB_URI`: MongoDB connection string (free tier via MongoDB Atlas)
  - Example: `mongodb+srv://user:pass@cluster0.xxxxx.mongodb.net/?retryWrites=true&w=majority`
  - Required for L2 caching and data warehouse

**API Keys:**
- `GEMINI_API_KEY`: Google Gemini API key for AI processing
- `TWITTER_BEARER_TOKEN`: Twitter API bearer token (for highlights)
- `TWITTER_API_KEY`, `TWITTER_API_SECRET`: Twitter API credentials

**Server:**
- `PORT`: Server port (default: 8080)

### Testing Conventions

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
7. Optionally: Add to `DataWarehouseService` for permanent storage

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

### Adjusting Cache TTLs

Edit `getCacheDurationSeconds()` in `MongoDBCacheService` to modify L2 TTLs, and `getCacheDurationSeconds()` in `CacheService` to modify L1 TTLs:

```typescript
// In CacheService (L1 TTLs - in-memory):
private getCacheDurationSeconds(key: string): number {
  if (key.includes("tech-score")) return 2 * 60 * 60;  // 2 hours
  if (key.includes("comments")) return 5 * 60;         // 5 minutes
  return 3 * 60;  // 3 minutes (default for news)
}

// In MongoDBCacheService (L2 TTLs - persistent cache):
private getCacheDurationSeconds(key: string): number {
  if (key.includes("tech-score")) return 7 * 24 * 60 * 60;  // 7 days
  if (key.includes("comments")) return 30 * 60;             // 30 minutes
  return 15 * 60;  // 15 minutes (default for news)
}
```

### Querying Historical Data from Warehouse

```typescript
// In a service or endpoint
const warehouse = container.resolve(DataWarehouseService);

// Get top ranked news from last 7 days
const startDate = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
const endDate = new Date();
const topNews = await warehouse.getRankedNewsByDate(startDate, endDate, 100);

// Get trends for specific source
const tabNewsTop = await warehouse.getTopRankedBySource("TabNews", 50);

// Get warehouse stats
const stats = await warehouse.getWarehouseStats();
```

### Working with AI Features

The `GeminiService` (`src/services/gemini.service.ts`) handles AI processing:
- Requires `GEMINI_API_KEY` environment variable
- Used by `HighlightsService` to generate summaries and relevance scores
- AI confidence scores range 0-100
- Implement rate limiting and error handling when calling AI APIs

## Deployment Notes

- Application runs on port 8080 in production (GCP Cloud Run default)
- Uses structured logging for GCP Cloud Logging integration
- **Hybrid cache** via MongoDB L2 (fallback) + in-memory L1 (fast) for optimal performance
- **Data warehouse** via MongoDB for permanent historical storage and analytics
- Requires `MONGODB_URI` environment variable for cache + warehouse
- Designed to be stateless and horizontally scalable
- Background task: `startBackgroundUpdates()` monitors external service health

---

Built with Hono and Bun

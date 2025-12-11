# Use Bun official image as base
FROM oven/bun:1.3.0-slim AS base

# Set working directory
WORKDIR /app

# Copy package files
COPY package.json bun.lockb* ./

# Install dependencies
FROM base AS dependencies
RUN bun install --frozen-lockfile --production

# Build stage (if needed for future TypeScript compilation)
FROM base AS build
COPY --from=dependencies /app/node_modules ./node_modules
COPY . .

# Production stage
FROM oven/bun:1.3.0-slim AS production

# Set working directory
WORKDIR /app

# Set NODE_ENV to production
ENV NODE_ENV=production

# Copy production dependencies
COPY --from=dependencies /app/node_modules ./node_modules

# Copy source code
COPY --from=build /app/src ./src
COPY --from=build /app/package.json ./

# Create non-root user for security
RUN addgroup --system --gid 1001 bunuser && \
    adduser --system --uid 1001 bunuser && \
    chown -R bunuser:bunuser /app

# Switch to non-root user
USER bunuser

# Expose port (GCP Cloud Run uses PORT env var)
EXPOSE 8080

# Health check
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD bun -e "fetch('http://localhost:8080/').then(r => r.ok ? process.exit(0) : process.exit(1))"

# Start the application
CMD ["bun", "run", "src/index.ts"]

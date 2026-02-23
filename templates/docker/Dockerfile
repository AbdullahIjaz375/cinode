# ===========================================================================
# Multi-stage production Dockerfile for Node.js
# ===========================================================================

# Stage 1: Install production dependencies
FROM node:__NODE_VERSION__-alpine AS deps
WORKDIR /app
COPY package*.json ./
RUN npm ci --production && npm cache clean --force

# Stage 2: Build (for TypeScript or projects with a build step)
FROM node:__NODE_VERSION__-alpine AS build
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run build 2>/dev/null || echo "No build step"

# Stage 3: Production image
FROM node:__NODE_VERSION__-alpine AS production
WORKDIR /app

ENV NODE_ENV=production

# Create non-root user
RUN addgroup -g 1001 -S appgroup && \
    adduser -S appuser -u 1001 -G appgroup

# Copy production dependencies and built files
COPY --from=deps /app/node_modules ./node_modules
COPY --from=build /app .

# Remove dev files that shouldn't be in production
RUN rm -rf .git .github .env.* tests test __tests__ coverage \
    .eslintrc* .prettierrc* .jscpd.json tsconfig.json

USER appuser

EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=10s --start-period=30s --retries=3 \
  CMD wget --no-verbose --tries=1 --spider http://localhost:3000/health || exit 1

CMD ["node", "__ENTRY_POINT__"]

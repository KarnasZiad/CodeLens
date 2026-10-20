# syntax=docker/dockerfile:1.7
# Build context: repository root (docker build -f apps/api/Dockerfile .)
# One image, three commands: the API (default), the worker and the migrations.

FROM node:22-alpine AS base
ENV PNPM_HOME=/pnpm \
    PATH=/pnpm:$PATH \
    HUSKY=0
RUN corepack enable
WORKDIR /repo

# ---- Build: lockfile install, engine then API compilation, production-only bundle.
FROM base AS build
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml .npmrc tsconfig.base.json ./
COPY packages/review-engine/package.json packages/review-engine/
COPY apps/api/package.json apps/api/
RUN --mount=type=cache,id=pnpm,target=/pnpm/store \
    pnpm install --frozen-lockfile --filter @codelens/api...
COPY packages/review-engine packages/review-engine
COPY apps/api apps/api
RUN pnpm --filter @codelens/api... build
RUN --mount=type=cache,id=pnpm,target=/pnpm/store \
    pnpm --filter @codelens/api deploy --prod /out

# ---- Runtime: compiled JavaScript, production dependencies and SQL migrations only.
FROM node:22-alpine AS runtime
RUN apk add --no-cache tini
ENV NODE_ENV=production
WORKDIR /app
COPY --from=build --chown=node:node /out ./
USER node
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD wget -qO- http://127.0.0.1:3000/health/live || exit 1
ENTRYPOINT ["/sbin/tini", "--"]
# Worker: node dist/worker.js · migrations: node dist/cli/migrate.js
CMD ["node", "dist/main.js"]

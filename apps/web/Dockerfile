# syntax=docker/dockerfile:1.7
# Build context: repository root (docker build -f apps/web/Dockerfile .)

FROM node:22-alpine AS build
ENV PNPM_HOME=/pnpm \
    PATH=/pnpm:$PATH \
    HUSKY=0 \
    NEXT_TELEMETRY_DISABLED=1
RUN corepack enable
WORKDIR /repo
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml .npmrc tsconfig.base.json ./
COPY apps/web/package.json apps/web/
RUN --mount=type=cache,id=pnpm,target=/pnpm/store \
    pnpm install --frozen-lockfile --filter @codelens/web...
COPY apps/web apps/web
# Rewrites are resolved at build time: the address of the API inside the deployment.
ARG API_URL=http://api:3000
ENV API_URL=$API_URL
RUN pnpm --filter @codelens/web build

# ---- Runtime: the standalone server traced by Next.js, nothing else.
FROM node:22-alpine AS runtime
RUN apk add --no-cache tini
ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    HOSTNAME=0.0.0.0 \
    PORT=3001
WORKDIR /app
COPY --from=build --chown=node:node /repo/apps/web/.next/standalone ./
COPY --from=build --chown=node:node /repo/apps/web/.next/static ./apps/web/.next/static
COPY --from=build --chown=node:node /repo/apps/web/public ./apps/web/public
USER node
EXPOSE 3001
HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD wget -qO- http://127.0.0.1:3001/healthz || exit 1
ENTRYPOINT ["/sbin/tini", "--"]
CMD ["node", "apps/web/server.js"]

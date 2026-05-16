# syntax=docker/dockerfile:1.7

# ---- base: pin pnpm via corepack using the "packageManager" field in package.json ----
FROM node:22-alpine AS base
WORKDIR /app
RUN corepack enable
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN corepack prepare --activate

# ---- build: install all deps (cached on manifests), then compile ----
FROM base AS build
RUN --mount=type=cache,id=pnpm-store-node,target=/root/.local/share/pnpm/store \
    pnpm install --frozen-lockfile
COPY . .
RUN pnpm run build

# ---- prod-deps: production-only node_modules, same lockfile ----
FROM base AS prod_deps
ENV NODE_ENV=production
RUN --mount=type=cache,id=pnpm-store-node,target=/root/.local/share/pnpm/store \
    pnpm install --frozen-lockfile --prod

# ---- production: slim runtime image ----
FROM node:22-alpine AS production
ENV NODE_ENV=production
WORKDIR /app

COPY --from=prod_deps /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY --from=build /app/public ./public

EXPOSE 8121

CMD ["node", "dist/main.js"]

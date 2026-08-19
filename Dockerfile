# syntax=docker/dockerfile:1.7

# ---- base: pin pnpm via corepack using the "packageManager" field in package.json ----
# Debian (glibc), not Alpine (musl): the local-agent engines are CLIs installed on the Docker host
# and bind-mounted in, and `agy` is a dynamically linked glibc ELF — under musl it fails to start
# with a misleading "not found" because /lib64/ld-linux-x86-64.so.2 does not exist. The build stages
# match the runtime stage so native node_modules are not compiled against the wrong libc.
FROM node:22-slim AS base
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
FROM node:22-slim AS production
ENV NODE_ENV=production
WORKDIR /app

# Instalar ca-certificates para peticiones HTTPS/SSL seguras de CLIs y SDKs
RUN apt-get update && apt-get install -y --no-install-recommends ca-certificates && rm -rf /var/lib/apt/lists/*

COPY --from=prod_deps /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY --from=build /app/public ./public
COPY --from=build /app/scripts ./scripts

# `bin/cm` is the universal reader: the only way an engine that has `run_command` but none of our
# tools can pull a document. It goes on the PATH so `cm read cm://…` works from any cwd, which is
# the whole point in a container where the wiki does not exist on disk.
COPY --from=build /app/bin ./bin
RUN chmod +x /app/bin/cm
ENV PATH="/app/bin:${PATH}"

EXPOSE 8121

CMD ["node", "dist/main.js"]


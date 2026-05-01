# Stage 1: Build
FROM node:22-alpine AS builder
LABEL stage="builder"

WORKDIR /app

COPY package.json pnpm-lock.yaml ./
RUN npm install -g pnpm && pnpm install --frozen-lockfile

COPY . .
RUN pnpm run build

# Stage 2: Production
FROM node:22-alpine AS production
LABEL stage="production"

WORKDIR /app

COPY package.json pnpm-lock.yaml ./
RUN npm install -g pnpm && pnpm install --frozen-lockfile --prod && npm uninstall -g pnpm

COPY --from=builder /app/dist ./dist
COPY --from=builder /app/public ./public

EXPOSE 8121

CMD ["node", "dist/main.js"]

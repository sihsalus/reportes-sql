# ── Build stage ──────────────────────────────────────────────────────────
FROM node:22-alpine AS builder

WORKDIR /build

RUN npm install -g pnpm@11.2.2

COPY package.json pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile --ignore-scripts

COPY tsconfig.json ./
COPY src ./src
RUN pnpm build

# ── Production stage ─────────────────────────────────────────────────────
FROM node:22-alpine

ENV NODE_ENV=production \
    PORT=8000

WORKDIR /app

RUN addgroup -S app && adduser -S app -G app

COPY --from=builder /build/dist ./dist
COPY --from=builder /build/node_modules ./node_modules
COPY --from=builder /build/package.json ./

RUN chown -R app:app /app

USER app

EXPOSE 8000

CMD ["node", "dist/main.js"]

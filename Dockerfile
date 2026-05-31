# ── Build stage ──────────────────────────────────────────────────────────
FROM node:22-alpine AS builder

WORKDIR /build

COPY package.json package-lock.json ./
RUN npm ci --ignore-scripts

COPY tsconfig.json ./
COPY src ./src
RUN npm run build

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

# ── Build stage ──────────────────────────────────────────────────────────
FROM node:22-alpine AS builder

WORKDIR /build

COPY package.json yarn.lock .yarnrc.yml ./
RUN corepack enable && yarn install --immutable

COPY tsconfig.json ./
COPY src ./src
RUN yarn build

# ── Dev stage (docker compose target) ────────────────────────────────────
# Includes dev dependencies so `tsx watch` and other dev tooling work.
FROM builder AS dev

WORKDIR /app
COPY --from=builder /build/node_modules ./node_modules
COPY --from=builder /build/dist ./dist
COPY --from=builder /build/package.json ./

EXPOSE 8000
CMD ["yarn", "tsx", "watch", "src/main.ts"]

# ── Production stage ─────────────────────────────────────────────────────
# Install only production dependencies so the image is lean.
FROM node:22-alpine AS prod-builder

WORKDIR /build

COPY package.json yarn.lock .yarnrc.yml ./
ENV NODE_ENV=production
RUN corepack enable && yarn install --immutable

COPY --from=builder /build/dist ./dist

FROM node:22-alpine

ENV NODE_ENV=production \
    PORT=8000

WORKDIR /app

RUN addgroup -S app && adduser -S app -G app

COPY --from=prod-builder /build/dist ./dist
COPY --from=prod-builder /build/node_modules ./node_modules
COPY --from=prod-builder /build/package.json ./

RUN chown -R app:app /app

USER app

EXPOSE 8000

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD ["node", "-e", "const http=require('node:http');const req=http.get('http://127.0.0.1:8000/health',res=>{res.resume();process.exit(res.statusCode===200?0:1)});req.on('error',()=>process.exit(1));req.setTimeout(4000,()=>{req.destroy();process.exit(1)});"]

CMD ["node", "dist/main.js"]

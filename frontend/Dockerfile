FROM node:20-bookworm-slim AS builder
WORKDIR /app
RUN corepack enable

ARG VITE_LIVEKIT_URL
ARG VITE_DEFAULT_ROOM=dnd-table-1
ENV VITE_LIVEKIT_URL=$VITE_LIVEKIT_URL
ENV VITE_DEFAULT_ROOM=$VITE_DEFAULT_ROOM

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY frontend/package.json ./frontend/package.json
RUN pnpm install --frozen-lockfile --filter ./frontend...

COPY frontend ./frontend
WORKDIR /app/frontend
RUN pnpm build

FROM node:20-bookworm-slim AS runner
WORKDIR /app
ENV NODE_ENV=production HOME=/tmp
RUN groupadd --system --gid 1001 nodejs \
    && useradd --system --uid 1001 --gid nodejs --home-dir /app --shell /usr/sbin/nologin appuser \
    && chown appuser:nodejs /app

COPY --chown=appuser:nodejs --from=builder /app/node_modules ./node_modules
COPY --chown=appuser:nodejs --from=builder /app/frontend/node_modules ./frontend/node_modules
COPY --chown=appuser:nodejs --from=builder /app/frontend/package.json ./frontend/package.json
COPY --chown=appuser:nodejs --from=builder /app/frontend/dist ./frontend/dist

WORKDIR /app/frontend
USER appuser
EXPOSE 3000
CMD ["node", "node_modules/serve/build/main.js", "-s", "dist/client", "-l", "3000"]

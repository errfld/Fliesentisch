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
ENV NODE_ENV=production

COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/frontend/node_modules ./frontend/node_modules
COPY --from=builder /app/frontend/package.json ./frontend/package.json
COPY --from=builder /app/frontend/dist ./frontend/dist

WORKDIR /app/frontend
EXPOSE 3000
CMD ["node", "node_modules/.bin/serve", "-s", "dist/client", "-l", "3000"]

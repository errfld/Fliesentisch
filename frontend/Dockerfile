FROM node:20-bookworm-slim AS builder
WORKDIR /app
RUN corepack enable
ARG VITE_LIVEKIT_URL=ws://localhost:7880
ARG VITE_DEFAULT_ROOM=dnd-table-1
ARG VITE_JOIN_KEY=
ENV VITE_LIVEKIT_URL=$VITE_LIVEKIT_URL
ENV VITE_DEFAULT_ROOM=$VITE_DEFAULT_ROOM
ENV VITE_JOIN_KEY=$VITE_JOIN_KEY
COPY package.json ./
RUN pnpm install --no-frozen-lockfile
COPY . .
RUN pnpm build

FROM node:20-bookworm-slim AS runner
WORKDIR /app
ENV NODE_ENV=production
RUN corepack enable
COPY --from=builder /app ./
EXPOSE 3000
CMD ["pnpm", "start"]

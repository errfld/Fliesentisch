# 🎲 DnD Virtual Table — Project Summary (LiveKit + Rust + Next.js)

A private web app for 7–10 friends to simulate playing D&D at a real table:
- A normal group call (main audio/video)
- 2–3 parallel **audio-only whisper conversations** that non-members cannot hear
- Whisper members still hear the main conversation quietly (“ducked”)
- A “DM Spotlight / Presentation mode” where one participant is large for everyone
- Self-hosted on a VPS using LiveKit (SFU)
- Rust (axum) backend to mint LiveKit tokens
- Next.js (TypeScript) frontend using LiveKit SDK
- CI for lint/test/build + container images + simple deployment

---

## 1) High-level Architecture

**Clients (browsers)**
- WebRTC media and LiveKit DataChannels
- UI state for whispers, PTT, spotlight

**LiveKit (SFU) on VPS**
- Routes audio/video efficiently for 7–10 users
- Provides DataChannel messaging and track subscription control

**Rust backend (axum)**
- Issues LiveKit JWT access tokens (room join)
- Optional “join secret” / password for private access
- (Optional later) room management, persistent sessions, etc.

**Reverse proxy + TLS**
- Caddy or Nginx for HTTPS (Let’s Encrypt)
- Exposes LiveKit over 443

**Optional TURN**
- coturn as fallback for NAT edge cases (recommended even for private use)

---

## 2) Core Product Requirements

### 2.1 Main Table Call
- Single session room (e.g. `dnd-table-1`)
- Everyone can:
  - publish main microphone audio
  - publish optional camera video
  - subscribe to all main audio/video
- Standard controls:
  - mute/unmute
  - camera on/off
  - device selection
  - active speaker highlighting

### 2.2 Whisper Conversations (Audio-only)
Goal: replicate “talking quietly at the table” without disturbing others.

**Behavior**
- Up to 2–3 whisper groups at the same time
- Whisper members:
  - hear whisper at normal volume
  - hear main table audio reduced (e.g. 25–35%)
- Non-members:
  - never receive whisper audio (not just muted—never subscribed)

**Technical approach (recommended)**
- Keep everyone inside ONE LiveKit room
- Whisper audio is implemented as additional audio tracks:
  - main mic track name: `main`
  - whisper mic track name: `whisper:<whisperId>` (e.g. `whisper:9c2f...`)
- Clients selectively subscribe to whisper tracks only if they are members

**Whisper group state synchronization**
- Use LiveKit DataChannels to broadcast whisper create/join/leave/close events
- No separate websocket service required for MVP

**Rules (recommended)**
- Max 3 active whispers total
- Each participant can actively speak into at most 1 whisper at a time
- Whisper auto-closes when < 2 members remain
- Optional inactivity timeout (e.g. close after N minutes with no PTT activity)

### 2.3 Push-to-Talk (PTT) for Whisper
- Default key: `V`
- While pressed:
  - unmute the whisper track
  - auto-mute main microphone (prevents accidental “leaks” into main)
- On release:
  - mute whisper track
  - restore main microphone state

### 2.4 DM Spotlight / Presentation Mode
- UI-driven pin/spotlight:
  - DM video becomes large for everyone
  - optional “Follow Spotlight” toggle per viewer
- Optional later:
  - screen share for maps/handouts

---

## 3) LiveKit Setup (VPS)

### 3.1 VPS Requirements
- Ubuntu 22.04+ (or similar)
- 2–4 vCPU, 4–8GB RAM (fine for 7–10)
- Public IPv4 (IPv6 optional)
- Docker + Docker Compose

### 3.2 Networking and TLS
- Reverse proxy terminates TLS (Let’s Encrypt)
- Public ports:
  - TCP 443 (HTTPS/WSS)
  - UDP media port range for WebRTC (LiveKit configurable)
- Optional TURN:
  - standard TURN ports (depends on setup); can be behind 443 with TLS if desired

### 3.3 LiveKit Configuration
- API key + secret (used by Rust token service)
- RTC port ranges / node IP / region (if needed)
- Room settings default (can remain simple)

---

## 4) Backend: Rust (axum) Token Service

### 4.1 Responsibility
Minimal service to mint JWT access tokens for LiveKit.

### 4.2 Endpoints

**POST `/token`**

Request body (example):

```json
{
  "room": "dnd-table-1",
  "identity": "alice",
  "name": "Alice",
  "join_key": "optional-shared-secret"
}
```

Response body (example):

```json
{
  "token": "LIVEKIT_JWT_HERE"
}
```

Token grants:
- roomJoin = true
- room = requested room
- canPublish = true
- canSubscribe = true
- optional: set TTL (e.g. 1 hour)

**GET `/health`**
- returns 200 OK

### 4.3 Runtime Configuration (env vars)
- `LIVEKIT_API_KEY`
- `LIVEKIT_API_SECRET`
- `JOIN_SECRET` (optional)
- `ALLOWED_ROOMS` (optional)

### 4.4 Deployment
- Containerized Rust binary
- Behind reverse proxy (or directly exposed with CORS enabled)
- Simple CORS policy: allow your frontend origin(s)

---

## 5) Frontend: Next.js (TypeScript) + LiveKit

### 5.1 Stack
- Next.js (App Router)
- TypeScript
- LiveKit Client SDK + LiveKit React components
- State store (Zustand or similar)
- Web Audio / HTMLAudioElement for volume ducking

### 5.2 Pages / UI
**Home / Join**
- enter name
- choose room (or fixed)
- enter join key (optional)
- connect

**Room UI**
- video grid / table layout
- whisper panel (list and controls)
- PTT indicator + selected whisper target
- spotlight/DM mode toggle
- audio settings + main volume slider (when whispering)

### 5.3 Whisper State Model (client)

```ts
type Whisper = {
  id: string;
  title?: string;
  members: string[];      // participant identities
  createdBy: string;
  updatedAt: number;
};

type WhisperState = {
  whispers: Record<string, Whisper>;
  selectedWhisperId?: string;  // your PTT target
  mainVolume: number;          // 0..1, default 1, duck to ~0.25 when in whisper
};
```

### 5.4 DataChannel Protocol (MVP)
All messages are JSON:

```json
{
  "type": "EVENT_TYPE",
  "v": 1,
  "payload": {}
}
```

Event types:
- `STATE_REQUEST`
- `STATE_SNAPSHOT` (contains all whispers)
- `WHISPER_CREATE`
- `WHISPER_UPDATE` (members list updated)
- `WHISPER_CLOSE`

Conflict resolution:
- prefer higher `updatedAt`
- if >3 whispers appear, clients deterministically keep oldest 3 and close the rest

### 5.5 Subscription Rules
- Subscribe to all `main` audio tracks
- Subscribe to `whisper:<id>` tracks only if you are a member of that whisper
- When you join a whisper:
  - duck main audio (set `audioEl.volume` to ~0.25)
- When you leave all whispers:
  - restore main audio to 1.0

### 5.6 Publishing Rules
- Always publish `main` mic track
- When you select/join a whisper:
  - publish a second mic track named `whisper:<id>` (muted by default)
- On PTT:
  - unmute `whisper:<id>`
  - mute main mic
- On release:
  - mute whisper track
  - restore main mic state

---

## 6) Repository Layout

```text
/frontend          Next.js app
/backend           Rust (axum) token service
/infrastructure    docker-compose, Caddy/Nginx, LiveKit config, scripts
/.github/workflows CI pipelines
```

---

## 7) CI/CD Plan

### 7.1 Frontend CI (GitHub Actions)
- install dependencies
- typecheck
- lint
- build
- docker build (optional)
- push image to registry (GHCR, Docker Hub, etc.)

### 7.2 Backend CI (GitHub Actions)
- `cargo fmt --check`
- `cargo clippy`
- `cargo test`
- docker build
- push image to registry

### 7.3 Deploy Strategy (simple + reliable)

Option A: “Pull & restart” on VPS
- on main branch merge:
  - build & push images
  - SSH into VPS
  - `docker compose pull`
  - `docker compose up -d`

Option B: self-hosted GitHub runner on VPS
- run deploy jobs locally on the server

---

## 8) Infrastructure (Docker Compose)

Services:
- `livekit` (livekit-server)
- `caddy` (TLS reverse proxy)
- `auth` (Rust token service)
- optional `coturn`

Configuration artifacts:
- LiveKit config file
- Caddyfile / Nginx conf
- environment (.env) for secrets

---

## 9) Milestones / Implementation Phases

### Phase 1 — “Call Works”
- deploy LiveKit on VPS with TLS
- implement Rust token service
- Next.js join flow + connect to room
- video grid + mute/unmute + devices

### Phase 2 — “Whisper MVP”
- implement whisper state via DataChannels (create/join/leave)
- publish whisper tracks and selective subscribe
- main audio ducking for whisper members
- PTT whisper (V key) + auto-mute main while whispering

### Phase 3 — “DM Mode & Polish”
- spotlight/pin DM view for everyone
- screen share (optional)
- whisper UI polish (chips, membership list, max 3 enforcement)
- reconnect handling (state snapshot on join)

### Phase 4 — “Hardening”
- optional TURN fallback
- basic logs/metrics
- rate limiting / join secret enforcement
- CI/CD auto deploy

---

## 10) Non-goals (initial version)
- user accounts / persistent DB
- scheduling, invites, calendars
- enterprise auth
- large-scale scaling beyond small groups

---

## Result
A self-hosted, private “virtual table” experience with realistic side conversations for D&D:
- main conversation always available
- whisper conversations isolated and natural
- minimal infra and clean code structure

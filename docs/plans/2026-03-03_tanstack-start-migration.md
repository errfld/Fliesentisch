# TanStack Start Migration Plan (2026-03-03)

## Goal

Migrate the `frontend` package from Next.js App Router to TanStack Start with TanStack Router while preserving current behavior for room join, whisper/PTT session flow, and auth token minting.

## Steps

1. Scaffold TanStack Start app structure in `frontend`:
   - Add `vite.config.ts`, `src/router.tsx`, and root route shell (`src/routes/__root.tsx`).
   - Keep Tailwind styling and existing component/store/lib code.
2. Recreate routes with typed file-based routing:
   - `/` (join form page).
   - `/room/$room` (room session page with typed search parsing for `name` and `joinKey`).
3. Replace Next-specific APIs:
   - `next/navigation` -> `@tanstack/react-router` navigate API.
   - `next/dynamic` no-SSR wrapper -> direct client component usage.
   - Remove Next API route and rely on HTTP proxying for `/api/v1/token`.
4. Configure proxying/environment:
   - Add Vite dev and preview proxy for `/api/v1/*` to auth backend.
   - Move env keys from `NEXT_PUBLIC_*` to `VITE_*` equivalents.
5. Update tooling and infra:
   - Replace Next scripts/dependencies with TanStack Start + Vite equivalents.
   - Update Dockerfile runtime from `next start` to Vite preview server.
   - Update frontend README and infra env docs.
6. Validate migration:
   - `pnpm --filter frontend typecheck`
   - `pnpm --filter frontend test`
   - `pnpm --filter frontend build`

## Risks / Checks

- Ensure `/room/:room` deep links resolve in production via frontend server + Caddy.
- Ensure `/api/v1/token` proxy works in local dev and docker compose.
- Ensure router route generation (`routeTree.gen.ts`) is present and up to date.

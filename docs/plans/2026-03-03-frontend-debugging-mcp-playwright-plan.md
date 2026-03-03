# Frontend Debugging Setup Plan (MCP + Playwright CLI)

## Goal
Enable Codex to interact with a running frontend in-browser for faster debugging, regression checks, and reproducible UI workflows.

## Recommended Approach
1. Primary path: use `@playwright/mcp` as a local MCP server for interactive browser control from Codex.
2. Secondary path: keep Playwright CLI tests/codegen in the repo for deterministic and CI-friendly checks.

## Current State
- Monorepo frontend app: Next.js (`frontend/package.json`, script `dev: next dev`).
- Codex MCPs currently configured: only `github`.

## Implementation Steps
1. Add Playwright MCP to Codex:
   - Command: `codex mcp add playwright -- npx @playwright/mcp@latest`
2. Confirm MCP registration:
   - Command: `codex mcp list`
3. Install browser binaries once (if prompted):
   - Command: `pnpm -C frontend dlx playwright install`
4. Start frontend app:
   - Command: `pnpm -C frontend dev`
5. In Codex sessions, use Playwright MCP tools against `http://localhost:3000` for:
   - navigation flows
   - DOM assertions
   - screenshots/snapshots for debugging
6. Add CLI-based e2e capability (optional but recommended):
   - `pnpm -C frontend add -D @playwright/test`
   - `pnpm -C frontend dlx playwright install`
   - generate first spec with `pnpm -C frontend dlx playwright codegen http://localhost:3000`
   - run in debug mode with `pnpm -C frontend dlx playwright test --debug`

## Why Both MCP and CLI
- MCP is better for interactive, agent-driven debugging during development.
- Playwright CLI is better for repeatable regression tests and CI automation.

## Notes / Risks
- MCP transport across clients is moving toward Streamable HTTP; standalone SSE is deprecated in MCP protocol spec updates. Prefer tools that already support current transport patterns.
- Community projects branded "WebMCP" exist, but maturity and support vary; use only if they provide capabilities Playwright MCP does not.

## Validation Checklist
- `codex mcp list` shows `playwright` as enabled.
- Frontend serves successfully at `http://localhost:3000`.
- A generated Playwright spec runs locally.
- At least one debug scenario is documented (e.g., login/join-room flow).

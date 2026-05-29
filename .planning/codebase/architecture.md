# Codebase Map: Architecture

## Major Boundaries

- `packages/gateway/` owns Express routes, repositories, services, adapters, database migrations, WebSocket handling, terminal lifecycle, Copilot orchestration, Feishu integration, diagnostics, and CLI packaging hooks.
- `packages/web/` owns Next.js pages, React components, client API helpers, frontend tests, and Playwright E2E coverage.
- `docs/` owns product, architecture, release, smoke, and handoff documentation.
- `.github/workflows/ci.yml` owns CI release-gate automation.

## Critical Architecture Rules

- No Gateway API behavior belongs in Next.js API routes.
- All REST APIs live under `/api/v1`.
- Browser terminal flow is xterm.js -> WebSocket -> Gateway -> node-pty -> tmux attach -> AI CLI process.
- tmux owns persistence; SQLite does not store terminal history.
- Gateway must validate JWT, tenant ownership, input schemas, filesystem boundaries, and credential mode before side effects.

## Current High-Risk Surfaces

- Copilot run lifecycle, approval-gated pending actions, provider redaction, memory recall, and Feishu source handling.
- Feishu inbound/outbound policy enforcement, chat allowlists, user mappings, replay/rate limits, and audit rows.
- Codex app-server capability-token and disabled-turn boundary.
- Terminal runtime support, especially Windows/WSL and missing tmux/CLI states.

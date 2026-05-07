# Codex App-Server Architecture Note

> Date: 2026-05-06
> Scope: MVP-9 guarded Gateway control-plane prototype
> Status: Gateway JSON-RPC integration in progress; Web prompt input deferred

## Boundary

OpenForge continues to use tmux-backed terminal sessions for normal Codex CLI
workflows. `codex app-server` is treated as a separate JSON-RPC service process,
not as terminal byte output and not as a replacement for `/ws/terminal/:sessionId`.

## Implemented Shape

- Service: `packages/gateway/src/services/codex-app-server-manager.ts`.
- Routes: `packages/gateway/src/routes/codex-app-server.ts`.
- API mount: `/api/v1/codex/app-server`.
- Runtime modes: `app-server-stdio` and `app-server-websocket`.
- WebSocket mode: loopback URL plus capability token file written under the
  OpenForge runtime root with `0600` permissions.
- Tenant boundary: project lookup uses `ProjectRepository(db, userId)` and
  manager list/get/stop are owner-scoped.
- Secrets: route responses omit token and token-file path; stored API keys are
  decrypted only for launch env injection.
- Lifecycle: start/list/stop are exposed; per-user running process limit is
  enforced by the manager; Gateway close calls `stopAll()`.
- Activity: start/stop create structured activity rows and event-bus events.
- JSON-RPC client helpers build `initialize`, `thread/start`, and `turn/start`
  requests, enforce request timeout and frame-size limits, validate inbound
  JSON-RPC frames, and close malformed inbound frames with a protocol error.
- Managed app-server sessions can own a Gateway JSON-RPC client. Authenticated
  routes expose `initialize`, `thread`, and `turn` operations without exposing
  capability tokens or persisting prompt/response transcript content.
- Codex app-server notifications are normalized into
  `codex_app_server_notification` activity rows and broadcast through the
  existing activity event path.

## Deferred

- Production WebSocket transport validation against a real `codex app-server`
  process.
- Web prompt input or transcript UI.
- Dedicated app-server rate limiting beyond request size, timeout, process
  limits, and JSON-RPC frame-size guards.

## Verification

- `test/codex-app-server.test.ts`
- `test/codex-app-server-client.test.ts`
- `test/codex-app-server-events.test.ts`
- `test/codex-app-server-manager.test.ts`
- `test/codex-app-server-routes.test.ts`

# Codex App-Server Architecture Note

> Date: 2026-05-06
> Scope: MVP-9 guarded Gateway control-plane prototype
> Status: implemented behind Gateway routes; Web prompt input deferred

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

## Deferred

- JSON-RPC frame reader/client with inbound schema validation.
- Notification/event normalization from Codex app-server streaming responses.
- Web prompt input or transcript UI.
- Additional rate/message-size controls for app-server JSON-RPC traffic.

## Verification

- `test/codex-app-server.test.ts`
- `test/codex-app-server-manager.test.ts`
- `test/codex-app-server-routes.test.ts`
- Full Gateway regression on 2026-05-06: 318 tests passed.

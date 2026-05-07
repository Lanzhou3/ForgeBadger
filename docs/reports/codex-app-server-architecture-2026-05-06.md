# Codex App-Server Architecture Note

> Date: 2026-05-06
> Scope: MVP-9 guarded Gateway control-plane prototype
> Status: Gateway protocol integration in progress; Web prompt input deferred

## Boundary

OpenForge continues to use tmux-backed terminal sessions for normal Codex CLI
workflows. `codex app-server` is treated as a separate protocol service process,
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
- Gateway protocol helpers build `initialize`, `thread/start`, and `turn/start`
  requests, enforce request timeout and frame-size limits, validate inbound
  app-server frames, and close malformed inbound frames with a protocol error.
- Request envelopes are aligned with `codex-cli 0.128.0` generated bindings:
  frames use `{ id, method, params }` without a `jsonrpc` wrapper, thread start
  sends `experimentalRawEvents: false` and `persistExtendedHistory: false`, and
  text turn input includes `text_elements: []`.
- Managed app-server sessions can own a Gateway protocol client. Authenticated
  routes expose `initialize`, `thread`, and `turn` operations without exposing
  capability tokens or persisting prompt/response transcript content.
- Codex app-server notifications are normalized into
  `codex_app_server_notification` activity rows and broadcast through the
  existing activity event path.
- Web exposes a guarded `/codex-app-server` prototype surface for lifecycle,
  initialize, thread creation, and stop operations. It intentionally does not
  expose prompt/turn input yet.
- `turn/start` is protected by a session-scoped request rate limit in addition
  to request size, timeout, process limits, and frame-size guards.

## Deferred

- Production WebSocket transport validation against a real `codex app-server`
  process.
- Web prompt input or transcript UI.
- Full prompt/response transcript persistence policy.
- Exact real-process initialize response capture remains open: zero-quota local
  validation on 2026-05-07 confirmed `codex-cli 0.128.0`, `app-server --help`,
  generated TypeScript bindings, isolated Unix-socket app-server startup, and
  proxy connection without touching the host Codex config; one-shot initialize
  frames did not emit a response over stdio/proxy and need transport-level
  follow-up.

## Verification

- `test/codex-app-server.test.ts`
- `test/codex-app-server-client.test.ts`
- `test/codex-app-server-events.test.ts`
- `test/codex-app-server-manager.test.ts`
- `test/codex-app-server-routes.test.ts`

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
- Safe session payloads include `features.turnInputEnabled` so Web can display
  the real Gateway capability without exposing capability tokens or token-file
  paths.
- `GET /api/v1/codex/app-server/capabilities` reports the app-server capability
  surface without requiring an active app-server session. This keeps the Web
  launch surface aligned with the Gateway feature flag before any Codex process
  is started.
- WebSocket mode: loopback URL plus capability token file written under the
  OpenForge runtime root with `0600` permissions.
- Tenant boundary: project lookup uses `ProjectRepository(db, userId)` and
  manager list/get/stop are owner-scoped.
- Secrets: route responses omit token and token-file path; stored API keys are
  decrypted only for launch env injection.
- Lifecycle: start/list/stop are exposed; per-user running process limit is
  enforced by the manager; Gateway close calls `stopAll()`.
- Activity: start/stop create structured activity rows and event-bus events.
- Activity queries support a comma-separated `type` filter, allowing Web to
  request only Codex app-server lifecycle and notification events without
  loading unrelated session activity.
- Gateway protocol helpers build `initialize`, `thread/start`, and `turn/start`
  requests, enforce request timeout and frame-size limits, validate inbound
  app-server frames, and close malformed inbound frames with a protocol error.
- Request envelopes are aligned with `codex-cli 0.130.0` generated bindings:
  frames use `{ id, method, params }` without a `jsonrpc` wrapper, successful
  `initialize` is acknowledged with an `initialized` notification, and text turn
  input includes `text_elements: []`.
- Managed app-server sessions can own a Gateway protocol client. Authenticated
  routes expose `initialize`, `thread`, and `turn` operations without exposing
  capability tokens or persisting prompt/response transcript content.
- Managed `app-server-websocket` sessions now create a Gateway WebSocket
  transport that sends one JSON-RPC message per text frame and presents the
  capability token as `Authorization: Bearer <token>` during the handshake.
- Real-process WebSocket initialize validation is repeatable through
  `pnpm smoke:codex-app-server`. The smoke script runs `codex app-server` with
  isolated temporary `HOME` and `CODEX_HOME`, uses a random capability-token
  file, sends only `initialize` plus `initialized`, and reports
  `promptOrTurnSent: false`.
- Codex app-server notifications are normalized into
  `codex_app_server_notification` activity rows and broadcast through the
  existing activity event path.
- Web exposes a guarded `/codex-app-server` prototype surface as
  "Codex Background Tasks" for lifecycle, initialize, thread creation, and stop
  operations. It intentionally does not expose prompt/turn input yet and shows
  the Gateway turn capability state from the capabilities endpoint and safe
  session payloads, plus a read-only recent activity feed for Codex app-server
  lifecycle and notification events.
- Web event handling invalidates only the `codex-app-server-activities` query
  when an `activity_created` event carries a Codex app-server activity type,
  avoiding broad dashboard/project refetches for app-server telemetry.
- `turn/start` is disabled by default at the Gateway route layer and requires
  `OPENFORGE_CODEX_APP_SERVER_TURN_ENABLED=1` before any real turn can be sent.
  When enabled, it remains protected by a session-scoped request rate limit in
  addition to request size, timeout, process limits, and frame-size guards.
- Gateway does not persist prompt or response transcript content for app-server
  calls; route responses are pass-through protocol results and normalized
  notifications are recorded as activity metadata only.

## Deferred

- Web prompt input or transcript UI.
- Full prompt/response transcript UI and user-facing retention controls.
- Real-process stdio initialize response capture is closed for the current
  local toolchain: zero-quota validation on 2026-05-09 used isolated
  `/tmp/openforge-codex-help-home` and `/tmp/openforge-codex-help-codex`,
  confirmed `codex-cli 0.130.0`, generated TypeScript bindings, and received an
  `initialize` result containing `userAgent`, `codexHome`, `platformFamily`, and
  `platformOs` without touching the host Codex config or starting a prompt turn.

## Verification

- `test/codex-app-server.test.ts`
- `test/codex-app-server-client.test.ts`
- `test/codex-app-server-events.test.ts`
- `test/codex-app-server-manager.test.ts`
- `test/codex-app-server-routes.test.ts`
- `node --test scripts/smoke-codex-app-server.test.mjs`
- `pnpm smoke:codex-app-server`
- `pnpm --dir packages/web test src/lib/api.test.ts`
- `pnpm --dir packages/web test src/lib/i18n.test.ts`

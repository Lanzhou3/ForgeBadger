# Phase B Codex App-Server Acceptance

> Date: 2026-05-10
> Scope: guarded Codex Background Tasks prototype
> Decision: accepted for beta feedback with turn input disabled

## Acceptance Scope

Phase B is an observable control-plane prototype for `codex app-server`. It is
not a prompt UI, transcript UI, or replacement for tmux-backed terminal
sessions.

Accepted behavior:

- Gateway owns lifecycle, initialize, thread creation, stop, capability
  reporting, process exit, and process error observability.
- Web renders connection state, initialization/thread activity, endpoint, PID,
  update time, recent error state, and recent safe activity.
- Web does not render prompt, send, or turn controls.
- Gateway keeps `POST /api/v1/codex/app-server/:id/turn` disabled by default.
- Codex app-server launch rejects provider API-key and model override inputs.
- Notification/activity persistence uses Gateway summaries and safe identifiers
  instead of raw protocol text.

Deferred behavior:

- Web prompt/turn input.
- Transcript persistence and retention controls.
- Long-term retention/TTL policy for stopped/error app-server session records.

## Fixed Verification Commands

Run these commands from the repository root unless noted.

```bash
git diff --check
node --test scripts/smoke-codex-app-server.test.mjs scripts/smoke-local-release.test.mjs
pnpm --dir packages/gateway test test/codex-app-server-client.test.ts test/codex-app-server-events.test.ts test/codex-app-server-manager.test.ts test/codex-app-server-routes.test.ts
pnpm --dir packages/web test src/lib/api.test.ts src/lib/codex-app-server-activity.test.ts src/hooks/use-notifications.test.ts src/lib/i18n.test.ts
OPENFORGE_WEB_URL=http://127.0.0.1:48752 pnpm --dir packages/web exec playwright test e2e/codex-app-server.spec.ts --project=chromium --reporter=line
pnpm smoke:codex-app-server
pnpm --dir packages/gateway test test/model-provider-routes.test.ts test/model-provider-repository.test.ts test/model-config-apply.test.ts test/codex-provider-env.test.ts test/session-adapter-decoupling.test.ts
pnpm -r typecheck
pnpm -r test
pnpm -r build
pnpm build:npm
pnpm verify:npm
pnpm smoke:npm
```

The Playwright command needs a running Web dev server. The 2026-05-10 run used:

```bash
NEXT_PUBLIC_GATEWAY_URL=http://127.0.0.1:48731 pnpm --dir packages/web exec next dev --hostname 127.0.0.1 --port 48752
```

## 2026-05-10 Evidence

- `git diff --check`: pass.
- Script harness tests: pass, 2 tests.
- Gateway app-server focused tests: pass, 34 tests.
- Web focused tests: pass, 45 tests.
- Playwright `/codex-app-server` smoke: pass, 1 Chromium test. The test uses
  mocked Gateway APIs to prove the page renders safe status/activity metadata,
  hides prompt/turn controls, does not request `/turn`, and hides raw error or
  transcript-like text.
- Real `codex app-server` smoke: pass. It started a loopback WebSocket
  app-server, sent only `initialize` and `initialized`, validated a response
  with `codexHome` under
  `/tmp/openforge-codex-app-server-smoke-PTbfne/codex-home`, and reported
  `promptOrTurnSent: false`.
- Host Codex config fingerprint wrapper: pass. `/root/.codex/config.toml` and
  `/root/.codex/auth.json` had unchanged size, mtime, and 16-character SHA-256
  fingerprints before and after the initialize-only smoke. No file contents were
  printed.
- Provider/Codex regression: pass, 23 tests. Provider routes, provider
  repository, provider config apply, Codex provider-apply rejection, Codex
  terminal launch isolation, and OpenCode provider-backed launch all passed.
- Workspace typecheck: pass.
- Workspace tests: pass in unrestricted environment: CLI 64, Web 106, Gateway
  385 tests.
- Workspace build: pass in unrestricted environment.
- NPM package build/verify/smoke: pass. The smoke built
  `/tmp/openforge-npm-smoke-05gQzh/pack/openforge-0.1.0.tgz`, installed it, and
  `openforge doctor` reported `terminal native_tmux`.

## Boundary Notes

- The Web smoke proves the current Web page does not call `/turn` through its
  browser network path. It is intentionally mocked and does not prove a real
  Gateway/Web/app-server end-to-end prompt path, because that path is deferred.
- The real process smoke proves the app-server initialize path is zero-quota for
  the local toolchain: it does not send `thread/start` or `turn/start`, and it
  uses isolated temporary `HOME` and `CODEX_HOME`.
- `/turn` remains an authenticated Gateway route only for the guarded prototype.
  It returns `403` unless `OPENFORGE_CODEX_APP_SERVER_TURN_ENABLED=1` is set.

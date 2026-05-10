# Regression Report

> Date: 2026-05-06
> Scope: MVP-8 through MVP-10 implementation, Codex app-server prototype,
> diagnostics export, package release smoke, and local-first gate.
> Status: initial gate passed; 2026-05-10 release-sized follow-up passed in
> unrestricted environment.

## Commands

| Command | Result |
|---------|--------|
| `git diff --check` | Pass on 2026-05-06. |
| `node --test scripts/smoke-local-release.test.mjs` | Pass on 2026-05-06: smoke command planner tests passed. |
| `node scripts/smoke-local-release.mjs` | Pass on 2026-05-06: emitted loopback Gateway/Web command plan with redacted secrets and detailed manual evidence labels. |
| `node packages/cli/dist/index.js doctor` | Pass on 2026-05-06: `tmux 3.4`, `claude 2.1.129 (Claude Code)`, `opencode 1.14.39`, and `codex-cli 0.128.0` all reported `ok`. |
| `pnpm --dir packages/cli test` | Pass on 2026-05-06 in unrestricted environment: 53 tests passed. Sandboxed run failed in `test/start.test.ts` because local port-listen checks are restricted. |
| `pnpm --dir packages/cli typecheck` | Pass on 2026-05-06. |
| `pnpm --dir packages/gateway exec node --test --import tsx test/codex-app-server.test.ts test/codex-app-server-manager.test.ts test/codex-app-server-routes.test.ts test/diagnostics.test.ts test/diagnostics-routes.test.ts` | Pass: 11 tests passed. |
| `pnpm --dir packages/gateway test` | Pass on 2026-05-06 in unrestricted environment: 319 tests passed, 0 failed, 1 tmux integration test skipped by design. Sandboxed run failed/hung after local listen-path tests due restricted networking. |
| `pnpm --dir packages/gateway typecheck` | Pass on 2026-05-06. |
| `pnpm --dir packages/gateway build` | Pass on 2026-05-06. |
| `pnpm --dir packages/web test` | Pass on 2026-05-06: 18 files, 81 tests passed. |
| `pnpm --dir packages/web typecheck` | Pass on 2026-05-06 after Web build regenerated `.next/types`. A parallel run during Web build saw transient missing `.next/types` files. |
| `pnpm --dir packages/web build` | Pass on 2026-05-06 in unrestricted environment. Sandboxed run failed with the known Turbopack `Operation not permitted` process/port limitation. |
| `pnpm build:npm` | Pass on 2026-05-06 in unrestricted environment. Sandboxed run failed with the known Turbopack `Operation not permitted` process/port limitation. |
| `pnpm verify:npm` | Pass on 2026-05-06 after `build:npm` completed. A concurrent earlier run during package build hit a transient incomplete `dist/web/standalone` symlink. |
| `pnpm smoke:npm` | Pass on 2026-05-06 in unrestricted environment: local tarball `/tmp/openforge-npm-smoke-oN9sA3/pack/openforge-0.1.0.tgz`, temporary install/startup smoke completed. |
| `curl --noproxy '*' -fsS http://127.0.0.1:48731/api/v1/health` | Pass on 2026-05-06 in host network: `{"code":0,"data":{"status":"ok"},"message":""}`. |
| `curl --noproxy '*' -I http://127.0.0.1:48732/login` | Pass on 2026-05-06 in host network: HTTP 200. |

## Fixes During Regression

- Added deterministic adapter command runner to `test/security.test.ts` so the
  stored-key/model session launch test does not depend on the current machine's
  real `claude --version` output.
- Fixed `exactOptionalPropertyTypes` compile issues in Codex app-server manager
  launch input construction.
- Generalized diagnostics table counts without narrowing the helper to the
  `projects` table type.

## Environment Notes

- Web production build passes outside the restricted sandbox. Inside the sandbox,
  Next/Turbopack still fails while creating a process and binding a port.
- `pnpm smoke:npm` reported npm config warnings inherited from the environment;
  these did not fail the smoke.
- Sandbox HTTP checks cannot see host-network services on `127.0.0.1`; source
  health checks were run in the host network.

## Remaining Manual Evidence

- Real browser terminal smoke.
- Real Claude Code permission prompt notification smoke.

Both are moved to the user test pass and are tracked in
`docs/reports/browser-terminal-smoke-2026-05-06.md`.

## Follow-Up Regression: 2026-05-09

Scope: Codex app-server observable status, Codex subscription/provider
boundary hardening, Windows/tmux CLI guidance, and release-sized package gates.

| Command | Result |
|---------|--------|
| `pnpm --dir packages/gateway test test/codex-app-server.test.ts test/codex-app-server-client.test.ts test/codex-app-server-events.test.ts test/codex-app-server-manager.test.ts test/codex-app-server-routes.test.ts test/codex-provider-env.test.ts test/session-adapter-decoupling.test.ts` | Pass: 38 tests passed. |
| `pnpm --dir packages/gateway test test/model-provider-routes.test.ts test/model-provider-repository.test.ts test/model-config-apply.test.ts test/codex-provider-env.test.ts` | Pass: 18 tests passed. |
| `pnpm --dir packages/web test src/lib/codex-app-server-activity.test.ts src/hooks/use-notifications.test.ts src/lib/i18n.test.ts src/lib/api.test.ts` | Pass: 45 tests passed. |
| `pnpm --dir packages/cli test test/doctor.test.ts test/start.test.ts` | Pass: 28 tests passed. |
| `pnpm --dir packages/gateway typecheck` | Pass. |
| `pnpm --dir packages/web typecheck` | Pass. |
| `pnpm --dir packages/cli typecheck` | Pass. |
| `pnpm --dir packages/web exec playwright test e2e/codex-app-server.spec.ts --project=chromium --reporter=line` | Pass after explicitly starting a temporary Next dev server on `localhost:48742`; mocked Gateway APIs, no `/turn` request. |
| `node --test scripts/smoke-codex-app-server.test.mjs scripts/smoke-local-release.test.mjs` | Pass: 2 script-level harness tests passed. |
| `node scripts/smoke-local-release.mjs` | Pass: emitted redacted local smoke command plan. |
| `pnpm smoke:codex-app-server` | Pass: real `codex app-server` WebSocket initialize only, isolated temporary `HOME`/`CODEX_HOME`, `promptOrTurnSent: false`. |
| `pnpm build:npm` | Pass in unrestricted environment. Initial sandboxed run failed with the known Next/Turbopack port-binding `EPERM` limitation. |
| `pnpm verify:npm` | Pass. |
| `pnpm smoke:npm` | Pass: built tarball, installed package, and `openforge doctor` reported `terminal native_tmux`. |
| `pnpm -r test` | Pass: CLI 59, Web 106, Gateway 379 tests passed. |
| `pnpm -r typecheck` | Pass. |
| `pnpm -r build` | Pass in unrestricted environment. |

Notes:

- Codex app-server smoke used a temporary root under `/tmp` and did not touch
  host Codex config or send prompt/turn traffic.
- Codex app-server lifecycle follow-up now keeps natural child exits and child
  errors observable through safe stopped/error manager state plus activity rows;
  `/turn` remains a default-403 feature-flag API and is not called by the Web
  prototype.
- `openforge start` now prints a non-blocking terminal-runtime warning when
  native Windows or missing tmux would prevent browser terminal sessions.

## Follow-Up Regression: 2026-05-10

Scope: fresh release-sized validation after Codex app-server lifecycle
observability, Provider/Codex boundary hardening, and Windows/tmux CLI guidance.

| Command | Result |
|---------|--------|
| `git diff --check` | Pass. |
| `node --test scripts/smoke-codex-app-server.test.mjs scripts/smoke-local-release.test.mjs` | Pass: 2 script-level harness tests passed. |
| `pnpm --dir packages/gateway test test/codex-app-server-client.test.ts test/codex-app-server-events.test.ts test/codex-app-server-manager.test.ts test/codex-app-server-routes.test.ts` | Pass in unrestricted environment after the notification-redaction/stopped-route follow-up: 34 tests passed. Sandboxed route run hit the known Node/local-listen assertion. |
| `pnpm --dir packages/web test src/lib/api.test.ts src/lib/codex-app-server-activity.test.ts src/hooks/use-notifications.test.ts src/lib/i18n.test.ts` | Pass: 45 tests passed. |
| `OPENFORGE_WEB_URL=http://127.0.0.1:48752 pnpm --dir packages/web exec playwright test e2e/codex-app-server.spec.ts --project=chromium --reporter=line` | Pass after explicitly starting a temporary Next dev server on `127.0.0.1:48752`: 1 Chromium test passed; mocked Gateway APIs, no `/turn` request, raw error text hidden. |
| `pnpm --dir packages/cli test` | Pass in unrestricted environment: 64 tests passed. Sandboxed run fails in local listen/IPC checks. |
| `pnpm --dir packages/cli test test/doctor.test.ts test/start.test.ts` | Pass in unrestricted environment after the terminal-runtime warning optimization: 33 tests passed. Sandbox is blocked by tsx/node IPC listen. |
| `pnpm --dir packages/gateway test test/model-provider-routes.test.ts test/model-provider-repository.test.ts test/model-config-apply.test.ts test/codex-provider-env.test.ts test/session-adapter-decoupling.test.ts` | Pass in unrestricted environment: 23 tests passed, covering Provider SSOT, provider apply, Codex provider-apply rejection, Codex launch isolation, and OpenCode provider-backed launch. |
| `pnpm smoke:codex-app-server` | Pass in unrestricted environment: real `codex app-server` WebSocket initialize only, isolated temporary `HOME`/`CODEX_HOME`, `promptOrTurnSent: false`, `codexHome` under `/tmp/openforge-codex-app-server-smoke-PTbfne/codex-home`, and extra notification methods `configWarning` plus `remoteControl/status/changed`. Sandboxed run fails with `listen EPERM` on `127.0.0.1`. |
| Host Codex config fingerprint wrapper around `pnpm smoke:codex-app-server` | Pass: `/root/.codex/config.toml` and `/root/.codex/auth.json` size, mtime, and 16-character SHA-256 fingerprints were unchanged before and after the initialize-only smoke; no file contents were printed. |
| `pnpm -r typecheck` | Pass: CLI, Gateway, and Web typechecks passed. |
| `pnpm -r test` | Pass in unrestricted environment: CLI 64, Web 106, Gateway 385 tests passed. Sandboxed run is blocked by CLI local listen tests. |
| `pnpm -r build` | Pass in unrestricted environment. |
| `pnpm build:npm` | Pass in unrestricted environment. |
| `pnpm verify:npm` | Pass. |
| `pnpm smoke:npm` | Pass in unrestricted environment: built `/tmp/openforge-npm-smoke-05gQzh/pack/openforge-0.1.0.tgz`, installed it, `openforge doctor` reported `terminal native_tmux`, and startup/API smoke completed. Sandboxed run fails when the smoke's internal `build:npm` hits the known Next/Turbopack `binding to a port` `EPERM`. |

Notes:

- The Codex app-server smoke reported `extraMessageMethods` of `configWarning`
  and `remoteControl/status/changed`; no prompt or turn traffic was sent.
- The initialize-only smoke sends only `initialize` and `initialized`; the smoke
  script fails if `thread/start` or `turn/start` appears in its sent method
  list. The Web page smoke separately proves the current Web prototype does not
  call the `/turn` route.
- Codex app-server notification rows now store Gateway summary messages instead
  of protocol `message`/`text` payloads, and unsafe lifecycle error text is
  downgraded to a generic process-error summary.
- Provider-backed OpenCode launch regression remains green while Codex terminal
  and Codex app-server launch paths reject provider credentials and model
  overrides.
- The full 2026-05-10 Provider regression re-ran provider routes, repository,
  config apply, Codex launch isolation, and session adapter decoupling tests.
- The current sandbox is still unsuitable for final local-port, Web build, and
  npm package smoke gates; unrestricted reruns are the canonical evidence for
  those commands.

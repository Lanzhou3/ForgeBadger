# Regression Report

> Date: 2026-05-06
> Scope: MVP-8 through MVP-10 implementation, Codex app-server prototype,
> diagnostics export, package release smoke, and local-first gate.
> Status: automated gate passed; real browser/provider smoke pending.

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

# Post-Beta Release Gates

> Date: 2026-05-10
> Scope: CI release gates, release/trial documentation, Windows/WSL acceptance
> boundary, and Phase C entry point
> Decision: ready for beta follow-up with physical Windows/WSL evidence still
> recorded as a platform caveat

## What Changed

- Added a checked-in GitHub Actions workflow at `.github/workflows/ci.yml` and
  updated `.gitignore` so the workflow and first-user trial docs are tracked.
- Expanded CI from basic package checks to release-sized gates:
  workspace typecheck/test/build, script harness tests, Provider/Codex boundary
  regression, Codex Background Tasks Web smoke, npm build/verify/smoke, and
  explicit environment-gated release notes.
- Kept real `pnpm smoke:codex-app-server` conditional on Codex CLI availability
  in CI. The mocked Web smoke remains required but is not treated as a
  substitute for the real app-server process smoke.
- Updated release, CI, smoke, trial, troubleshooting, and localized README docs
  to reflect the 2026-05-07 Phase A closure and 2026-05-10 Phase B beta
  handoff.
- Added explicit Windows native versus WSL trial evidence fields and clarified
  that native Windows management UI evidence does not prove tmux-backed browser
  terminal support.
- Fixed the Playwright config so loopback smoke checks add
  `127.0.0.1`, `localhost`, and `::1` to `NO_PROXY`. This prevents local proxy
  settings from making Playwright think a dev server is available when the
  loopback port is actually closed.

## Verification

Commands run from the repository root unless noted:

| Command | Result |
| --- | --- |
| `git diff --check` | Pass |
| `ruby -e "require 'yaml'; YAML.load_file('.github/workflows/ci.yml'); puts 'yaml ok'"` | Pass |
| `node --test scripts/smoke-codex-app-server.test.mjs scripts/smoke-local-release.test.mjs` | Pass: 2 tests |
| `pnpm -r typecheck` | Pass: CLI, Gateway, and Web typecheck |
| `pnpm -r test` | Pass: CLI 64 tests, Web 106 tests, Gateway 385 tests, 1 tmux integration skipped by design |
| `pnpm -r build` | Pass: CLI, Gateway, and Web production build; Web generated 21 routes including `/codex-app-server` |
| `pnpm --dir packages/web typecheck` | Pass |
| `pnpm --dir packages/gateway test test/model-provider-routes.test.ts test/model-provider-repository.test.ts test/model-config-apply.test.ts test/codex-provider-env.test.ts test/session-adapter-decoupling.test.ts` | Pass in unrestricted environment: 23 tests |
| `OPENFORGE_WEB_URL=http://127.0.0.1:48752 OPENFORGE_WEB_PORT=48752 pnpm --dir packages/web exec playwright test e2e/codex-app-server.spec.ts --project=chromium --reporter=line` | Pass in unrestricted environment: 1 Chromium test |
| `pnpm build:npm` | Pass |
| `pnpm verify:npm` | Pass |
| `pnpm smoke:npm` | Pass: built `/tmp/openforge-npm-smoke-WVIGAY/pack/openforge-0.1.0.tgz`, installed it, and `openforge doctor` reported `terminal native_tmux` |
| `pnpm smoke:codex-app-server` | Pass: real app-server WebSocket initialize-only smoke, `promptOrTurnSent: false`, no `thread/start` or `turn/start` |
| Host Codex config/auth fingerprint check around `pnpm smoke:codex-app-server` | Pass: `/root/.codex/config.toml` and `/root/.codex/auth.json` size, mtime, and SHA-256 were unchanged before and after the smoke |
| `ss -ltnp \| rg ':48752\|State'` after Playwright | Pass: no listener remained on `127.0.0.1:48752` |
| `tmux list-sessions -F '#{session_name}'` after npm/Codex smoke | Pass: no `of-smoke-` sessions remained; existing non-smoke sessions were left untouched |
| Targeted stale-status scan across `CLAUDE.md`, `DEVELOPMENT-PLAN`, release, CI, smoke, and MVP-10 docs | Pass: no stale matches |

## Notes

- The first sandboxed Playwright and Gateway route-test runs failed on local
  server paths. The Provider/Codex regression passed after rerunning in an
  unrestricted environment.
- The Playwright smoke initially failed because proxy environment variables
  caused the webServer readiness check to receive HTTP 400 from a proxy for
  `127.0.0.1:48752`. The `NO_PROXY` fix was verified with Playwright webServer
  debug output and then with the normal smoke command.
- Physical Windows/WSL smoke was not run in this environment. The repository now
  has explicit checklist fields and release caveats for that manual evidence.
- No Codex prompt/turn input was enabled. Codex Background Tasks remain a safe
  observable control-plane prototype for beta feedback.
- `pnpm -r build`, `pnpm build:npm`, and `pnpm smoke:npm` temporarily changed
  Next's generated `packages/web/next-env.d.ts` route reference from dev to prod
  output. That generated churn was restored after verification.

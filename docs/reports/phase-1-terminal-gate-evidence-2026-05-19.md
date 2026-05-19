# Phase 1 Terminal Gate Evidence

> Date: 2026-05-19
> Scope: REL-05 browser terminal E2E gate and REL-06 explicit tmux integration gate
> Decision: `Pass` for current-host mvp1, gate-d, and focused tmux evidence; physical Windows/WSL remains a separate caveat

## Evidence Table

| Gate | Status | Command | Environment | Result summary | Log/report location | Skip reason | Owner | Next action |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| CI control-plane smoke (`mvp1-smoke`) | Pass | `pnpm --dir packages/web exec playwright test e2e/mvp1-smoke.spec.ts --project=chromium --reporter=line` | Ubuntu Linux `6.8.0-107-generic`; Node `v24.14.1`; pnpm `10.33.2`; temporary Gateway on `127.0.0.1:48731`; Web on `127.0.0.1:48732`; temporary SQLite DB under `/tmp` | `1 passed (21.7s)` | This report; command output from 2026-05-19 execution | n/a | release maintainer | Keep required in CI as the stable control-plane happy path |
| Release/manual browser terminal smoke (`gate-d-smoke`) | Pass | `pnpm --dir packages/web exec playwright test e2e/gate-d-smoke.spec.ts --project=chromium --reporter=line` | Ubuntu Linux `6.8.0-107-generic`; Node `v24.14.1`; pnpm `10.33.2`; tmux `3.4`; Claude CLI on `PATH`; temporary Gateway on `127.0.0.1:48731`; Web on `127.0.0.1:48732`; temporary SQLite DB under `/tmp` | `3 passed (25.9s)` | This report; command output from 2026-05-19 execution | n/a | release maintainer | Keep as release/manual evidence unless CI host supplies Gateway/Web, tmux, and CLI prerequisites |
| Focused tmux integration | Pass | `RUN_TMUX_TESTS=1 pnpm --dir packages/gateway test test/integration/tmux.test.ts` | Ubuntu Linux `6.8.0-107-generic`; Node `v24.14.1`; pnpm `10.33.2`; tmux `3.4` | `3 tests`, `1 suite`, `3 pass`, `0 fail`, duration `1133.960207ms` | This report; command output from 2026-05-19 execution | n/a | release maintainer | Keep explicit in release evidence; do not replace with broad `pnpm -r test` alone |

## Boundary Notes

- `mvp1-smoke` is the stable CI control-plane gate. It does not prove the full
  browser terminal release path by itself.
- `gate-d-smoke` proves the current-host browser path with a temporary Gateway
  and Web console. It is still environment-sensitive because it depends on
  local loopback listeners and CLI/runtime availability.
- Focused tmux integration must be reported separately from broad workspace
  tests because the default `pnpm -r test` output can hide skipped tmux tests.
- Physical Windows/WSL evidence is not closed by this report. See
  `docs/reports/phase-1-platform-and-feedback-evidence-2026-05-19.md`.

## Process Cleanup

The temporary Gateway processes used for the Playwright runs were stopped after
each command. Follow-up `ss -ltnp` checks showed no listener remaining on
`127.0.0.1:48731` or `127.0.0.1:48732`.

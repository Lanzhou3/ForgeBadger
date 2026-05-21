# Phase 6 Terminal Gate Evidence

> Date: 2026-05-21
> Scope: BETA-02 physical Windows/WSL terminal evidence and current-host
> terminal baseline
> Decision: `Caveat` for physical Windows/WSL because this execution host is
> Ubuntu Linux and not a real WSL terminal host

## Physical Windows/WSL Decision

The physical Windows/WSL terminal gate is classified as `Caveat` for this
execution. The current host reported `not_wsl` from `/proc/version` inspection
and `Linux VM-0-3-ubuntu 6.8.0-107-generic`, so it cannot prove
tmux-backed browser terminal behavior from a physical Windows/WSL environment.

The Windows/WSL caveat cannot be removed without real WSL terminal evidence.

Native Windows management UI evidence, if collected separately, is management
UI evidence only and is not accepted as browser terminal pass evidence.

## Required WSL Pass Checklist

| Behavior | Status | Evidence |
|----------|--------|----------|
| `openforge doctor` | Caveat | Not run on a real WSL host in this execution |
| Project launch | Caveat | Not run on a real WSL host in this execution |
| browser terminal attach | Caveat | Not run on a real WSL host in this execution |
| tmux session existence | Caveat | Not run on a real WSL host in this execution |
| WebSocket disconnect/reconnect | Caveat | Not run on a real WSL host in this execution |
| Gateway restart recovery | Caveat | Not run on a real WSL host in this execution |
| No orphan smoke session | Caveat | Not run on a real WSL host in this execution |

## Current Host Baseline

| Check | Result |
|-------|--------|
| WSL detection | `not_wsl` |
| Host OS | Ubuntu Linux `6.8.0-107-generic` |
| tmux version | `tmux 3.4` |
| `openforge` on PATH | Not present in this shell |
| Repo commit at WSL check | `8004768` |

This baseline may support Linux/tmux confidence, but it does not convert the
physical Windows/WSL terminal gate to `Pass`.

## Current Host Automated Evidence

These rows are current-host evidence for CI/release confidence only. They do
not remove the physical Windows/WSL caveat.

| Gate | Status | Command | Result | Notes |
|------|--------|---------|--------|-------|
| CI core smoke (`mvp1-smoke`) | Pass | `pnpm --dir packages/web exec playwright test e2e/mvp1-smoke.spec.ts --project=chromium --reporter=line` | `1 passed (19.8s)` | A direct run without Gateway failed at registration; rerun passed after starting a temporary Gateway on `127.0.0.1:48731` with a temporary SQLite DB under `/tmp`. |
| Release/manual browser terminal smoke (`gate-d-smoke`) | Pass | `pnpm --dir packages/web exec playwright test e2e/gate-d-smoke.spec.ts --project=chromium --reporter=line` | `3 passed (25.4s)` | Ran against the same temporary Gateway/Web setup. |
| Focused tmux integration | Pass | `RUN_TMUX_TESTS=1 pnpm --dir packages/gateway test test/integration/tmux.test.ts` | `3 tests`, `1 suite`, `3 pass`, `0 fail`, duration `1096.496653ms` | First unrestricted run failed after cleaning an unexpected existing `of-*` session; rerun passed after cleanup. |

Cleanup checks:

- `ss -ltnp | rg ':48731|:48732|State'` showed no listener remaining on the
  smoke ports after the temporary Gateway/Web run.
- `tmux list-sessions -F '#{session_name}'` showed only non-OpenForge
  `codex-*` sessions after the focused tmux rerun; no `of-*` smoke session
  remained.

## Rerun Checklist

Owner: release maintainer with a physical Windows host and WSL environment.

Required host conditions:

- Physical Windows host with WSL installed.
- OpenForge source checkout or npm package available inside WSL.
- Node, pnpm, tmux, and OpenForge prerequisites installed inside WSL.
- Browser can access the Web console for the WSL Gateway/Web ports.

Rerun steps:

1. Record WSL distribution and version.
2. Run `openforge doctor`.
3. Launch a disposable OpenForge project.
4. Attach to the browser terminal.
5. Confirm tmux session existence.
6. Disconnect and reconnect the terminal WebSocket.
7. Restart Gateway and confirm session recovery.
8. Confirm no orphan smoke session remains.
9. Update `docs/reports/v1.1-beta-evidence-burn-down-2026-05-21.md` with
   `Pass`, `Caveat`, or `Blocked`.

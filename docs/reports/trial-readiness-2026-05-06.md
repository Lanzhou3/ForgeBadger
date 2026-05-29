# Trial Readiness Gate

> Date: 2026-05-06
> Scope: A stage first-user trial package
> Status: Draft until all gates below are reconciled

## Current status

This report's `Decision: blocked` is historical. Later browser-terminal and
post-beta evidence superseded parts of the 2026-05-06 blocker, but Phase 1
still preserves the physical Windows/WSL and live-provider caveats until real
host and disposable-provider evidence exists.

## Decision

Decision: `blocked`

Reason:

- The Browser terminal hard gate is not proven by real browser xterm evidence. The current report records fake local CLI terminal transport passing, but real browser rendering is still required.
- Trial docs are consolidated and linked, but they do not override the browser terminal hard gate.
- Package, source, regression, and trial docs gates now have current evidence, but A cannot move beyond `blocked` until the browser terminal hard gate is recorded.

## Evidence Matrix

| Gate | Required Evidence | Current Evidence | Status | Notes |
|------|-------------------|------------------|--------|-------|
| Package | `pnpm build:npm`, `pnpm verify:npm`, `pnpm smoke:npm`, `openforge doctor` output for Node/tmux/Claude Code and optional OpenCode/Codex | Current 2026-05-06 evidence in `docs/reports/regression-2026-05-06.md`: `pnpm build:npm` passed in unrestricted environment, `pnpm verify:npm` passed, `pnpm smoke:npm` passed with tarball `/tmp/openforge-npm-smoke-oN9sA3/pack/openforge-0.1.0.tgz`, and `node packages/cli/dist/index.js doctor` reported `tmux`, `claude`, `opencode`, and `codex` as `ok`. | Pass | Sandboxed package build and smoke hit the known Turbopack process/port limitation; unrestricted evidence is the gate evidence. |
| Source | Source startup path reaches Web `/login`; Gateway `/api/v1/health` returns `{ "code": 0, "data": { "status": "ok" }, "message": "" }` | Current 2026-05-06 host-network checks: `curl --noproxy '*' -fsS http://127.0.0.1:48731/api/v1/health` returned `{"code":0,"data":{"status":"ok"},"message":""}` and `curl --noproxy '*' -I http://127.0.0.1:48732/login` returned HTTP 200 after starting Web with `pnpm --dir packages/web exec next dev --hostname 127.0.0.1 --port 48732`. | Pass | Sandbox curl could not reach host loopback; host-network curl was used for evidence. Gateway was already listening on `127.0.0.1:48731` when the smoke ran. |
| Regression | Gateway tests, Web tests, Gateway/Web typecheck, Gateway/Web build, `git diff --check`, and Web production build status | Current 2026-05-06 evidence in `docs/reports/regression-2026-05-06.md`: `git diff --check` passed, smoke planner test passed, CLI tests/typecheck passed, Gateway tests/typecheck/build passed, Web tests/typecheck/build passed, `pnpm build:npm` passed, `pnpm verify:npm` passed, and `pnpm smoke:npm` passed. | Pass | Gateway and CLI tests plus Web/package builds needed unrestricted execution for local listen or Turbopack process/port behavior. |
| Browser terminal | Real browser terminal attach, input/output, resize, refresh reconnect, stop behavior, Gateway/Web restart recovery, environment details, browser console/network notes, and failures | `docs/reports/browser-terminal-smoke-2026-05-06.md` now uses the A-stage evidence shape and records each hard browser terminal step as `TBD`. It also records Playwright/Chrome sandbox launch failure, then safe terminal WebSocket transport smoke passing with a fake local `claude`: Gateway session creation, tmux attach, terminal output frame, input frame, resize frame, second attach/reconnect, session stop, and cleanup. | Blocked | Fake local CLI transport evidence is useful backing evidence, but it does not satisfy the hard A-stage real browser terminal gate or prove real browser xterm rendering. Do not mark this Pass until real browser xterm evidence is recorded. |
| Trial docs | Trial runbook, first-run checklist, troubleshooting guide, feedback template, diagnostics export instructions, explicit caveats | The four required first-user trial documents exist and are linked from the localized docs indexes: `docs/TRIAL-RUNBOOK.md`, `docs/TRIAL-CHECKLIST.md`, `docs/TROUBLESHOOTING.md`, and `docs/TRIAL-FEEDBACK.md`. `docs/TRIAL-RUNBOOK.md` also links the related trial materials, browser smoke report, and readiness gate. | Pass | This is a docs-package pass only. It is not a public release readiness claim and does not override the blocked browser terminal hard gate. |

## Caveats

- Real Claude Code permission-prompt behavior varies by local Claude Code version and user configuration. It is a first-user validation focus, not a blocker if the real browser terminal hard gate otherwise passes.
- Package, source, and regression gates were rerun or rechecked during Task 9 on 2026-05-06; browser terminal evidence remains separate and blocked.
- The browser automation failure is recorded as a sandbox limitation for Chrome launch, not a confirmed OpenForge regression.

## Follow-Up Defects

- Record real browser xterm evidence for terminal attach, input/output, resize, refresh reconnect, stop behavior, and Gateway/Web restart recovery.
- Capture real Claude Code permission-prompt behavior during first-user validation and file defects if notification/activity behavior does not match expectations.

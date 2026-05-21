# Phase 1: Beta Evidence Closure - Patterns

**Generated:** 2026-05-19T20:15:17+08:00
**Status:** Ready for planning

## Scope

Phase 1 touches release evidence and source-of-truth documentation. The closest existing patterns are docs reports, CI release notes, smoke scripts, and trial templates.

## File Pattern Map

| Target | Role | Closest Existing Analog | Pattern To Preserve |
|--------|------|-------------------------|---------------------|
| `AGENTS.md` | Agent-facing repo instructions | `CLAUDE.md` current status paragraph | Keep factual current phase aligned with post-beta beta-readiness wording; do not rewrite all repo rules. |
| `MEMORY.md` | Repo-root progress memory | Existing post-beta sections in `MEMORY.md` | Update stale PR/open wording to merged/current-state wording; preserve historical chronology. |
| `docs/superpowers/plans/2026-05-19-feishu-inbound-command-bridge-next.md` | Historical implementation plan | Same document's `Current status` and scope sections | Add merged/current-status note; do not reopen completed implementation scope. |
| `docs/reports/trial-readiness-2026-05-06.md` | Historical gate report | `docs/reports/post-beta-release-gates-2026-05-10.md` notes/caveats | Preserve original `blocked` decision and add superseded/current-status note. |
| `docs/reports/post-beta-release-gates-2026-05-10.md` or new Phase 1 report | Release evidence report | Existing verification tables in `docs/reports/post-beta-release-gates-2026-05-10.md` | Use table rows with command, result, notes; add `Pass / Caveat / Blocked`, owner, and next action for unrun gates. |
| `docs/CI-CD-PLAN.md` | Release gate contract | Existing Automation Matrix and Known skip sections | Distinguish required CI `mvp1-smoke` from release/manual `gate-d-smoke`; avoid false-green wording. |
| `docs/SMOKE-TEST.md` | Maintainer manual smoke | Existing Copilot and Automation Boundary sections | Keep provider smoke examples redacted; do not ask maintainers to paste keys into docs. |
| `docs/TRIAL-CHECKLIST.md` | First-user checklist | Existing Windows and Copilot sections | Preserve checklist format; add fields only if needed for triage/evidence mapping. |
| `docs/TRIAL-FEEDBACK.md` | Feedback intake template | Existing Summary, Browser Evidence, Logs sections | Add triage mapping fields if needed; keep the no-secret guidance prominent. |
| `.github/workflows/ci.yml` | CI automation | Existing `environment-gates` job and focused named steps | If changed, prefer an explicit named tmux/gate note step over broad hidden behavior. |

## Command Patterns

- Live provider smoke: `pnpm smoke:copilot-provider`.
- Required live provider run: `OPENFORGE_COPILOT_PROVIDER_SMOKE_REQUIRE=1 ... pnpm smoke:copilot-provider`.
- Explicit tmux evidence: `RUN_TMUX_TESTS=1 pnpm --dir packages/gateway test test/integration/tmux.test.ts`.
- Stable CI Web E2E smoke: `pnpm --dir packages/web exec playwright test e2e/mvp1-smoke.spec.ts --project=chromium --reporter=line`.
- Release/manual browser terminal smoke: `pnpm --dir packages/web exec playwright test e2e/gate-d-smoke.spec.ts --project=chromium --reporter=line` when Gateway/Web/CLI dependencies are available.
- GSD validation: `git diff --check`, `gsd-sdk query init.phase-op 1`, `gsd-sdk query roadmap.get-phase 1`.

## Planning Constraints

- Treat all external-gate evidence as documentation and verification work; do not modify Copilot or Feishu runtime behavior unless a stale doc links to a now-invalid command.
- For any `Caveat`, include skip reason, owner, and next action.
- Do not store or quote provider API keys, JWTs, attach tokens, private keys, full request bodies, or full model output.
- Keep historical reports historically accurate; add current-status notes instead of rewriting the old decision.

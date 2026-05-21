# Phase 6: Live Provider and Platform Smoke Evidence - Patterns

**Generated:** 2026-05-21T10:37:00+08:00
**Status:** Ready for planning

## Scope

Phase 6 touches evidence reports, smoke/trial/CI documentation, and existing smoke commands. The closest patterns are the v1.0 beta evidence reports, the live provider harness, and terminal smoke docs. This phase should preserve the existing evidence-first style and avoid runtime implementation unless an execution command proves a contract bug.

## File Pattern Map

| Target | Role | Closest Existing Analog | Pattern To Preserve |
|--------|------|-------------------------|---------------------|
| `docs/reports/v1.1-beta-evidence-burn-down-2026-05-21.md` | Master Phase 6 evidence matrix | `docs/reports/phase-1-live-provider-evidence-2026-05-19.md`, `docs/reports/phase-1-terminal-gate-evidence-2026-05-19.md` | Use rows with gate, status, command/checklist, environment, evidence summary, artifact, caveat/blocker reason, owner, and rerun/next action. |
| `docs/reports/phase-6-terminal-gate-evidence-2026-05-21.md` | Optional terminal-gate appendix | `docs/reports/phase-1-terminal-gate-evidence-2026-05-19.md` | Keep CI `mvp1`, release/manual `gate-d`, focused tmux, and physical WSL evidence distinct. |
| `docs/SMOKE-TEST.md` | Maintainer smoke instructions | Existing live provider and Windows/WSL sections | Link to the v1.1 matrix; keep no-secret guidance and WSL-only terminal acceptance language. |
| `docs/TRIAL-CHECKLIST.md` | Trial/runbook evidence capture | Existing Windows and provider fields | Add or update references to matrix rows without duplicating the master table. |
| `docs/CI-CD-PLAN.md` | CI/release gate contract | Existing CI automation and manual gate sections | Preserve required CI `mvp1-smoke`; state exact skip/rerun instructions for `gate-d`, focused tmux, and WSL. |
| `scripts/smoke-copilot-provider.ts` | Live provider harness | Current smoke script | Prefer no code change. If changed, preserve redaction, provider/model requirements, and public summary shape. |
| `scripts/smoke-copilot-provider.test.ts` | Harness unit tests | Current node:test cases | Add tests only if the harness behavior changes. Do not loosen redaction assertions. |
| `packages/gateway/test/integration/tmux.test.ts` | Focused tmux gate | Current `RUN_TMUX_TESTS=1` integration tests | Keep explicit command evidence separate from broad workspace test output. |
| `packages/web/e2e/mvp1-smoke.spec.ts` | CI control-plane smoke | Existing Playwright smoke | Treat as CI control-plane confidence, not full browser terminal/WSL proof. |
| `packages/web/e2e/gate-d-smoke.spec.ts` | Release/manual browser terminal smoke | Existing Playwright smoke | Treat as current-host browser terminal evidence when Gateway/Web/CLI dependencies are present. |

## Command Patterns

- Safe live provider harness run: `pnpm smoke:copilot-provider`.
- Required live provider run: `OPENFORGE_COPILOT_PROVIDER_SMOKE_REQUIRE=1 OPENFORGE_COPILOT_PROVIDER_SMOKE_PROVIDER=<openai|anthropic> OPENFORGE_COPILOT_PROVIDER_SMOKE_MODEL=<model-id> pnpm smoke:copilot-provider`.
- Explicit tmux integration: `RUN_TMUX_TESTS=1 pnpm --dir packages/gateway test test/integration/tmux.test.ts`.
- CI control-plane smoke: `pnpm --dir packages/web exec playwright test e2e/mvp1-smoke.spec.ts --project=chromium --reporter=line`.
- Release/manual browser terminal smoke: `pnpm --dir packages/web exec playwright test e2e/gate-d-smoke.spec.ts --project=chromium --reporter=line`.
- GSD validation: `git diff --check`, `gsd-sdk query init.phase-op 6`, `gsd-sdk query check.decision-coverage-plan .planning/phases/OF-06-live-provider-and-platform-smoke-evidence .planning/phases/OF-06-live-provider-and-platform-smoke-evidence/06-CONTEXT.md`.
- Redaction scan shape: targeted `rg` over modified evidence docs for provider keys, JWTs, Feishu secrets, and full-output labels; report only counts/categories and fixture/placeholder classification.

## Planning Constraints

- Phase 6 output is evidence and documentation, not new runtime scope.
- `Pass` requires fresh Phase 6 command output or real-host checklist evidence.
- Historical 2026-05-19 evidence can be cited as `Baseline`, but not relabeled as fresh v1.1 `Pass` unless rerun.
- Every unavailable external dependency must become `Caveat` or `Blocked` with reason, owner, and rerun instructions.
- Do not record raw request bodies, response bodies, full model outputs, terminal transcripts with secrets, API keys, JWTs, Feishu tokens, or full auth/config files.
- Feishu live callback evidence belongs to Phase 7; first-user packet evidence belongs to Phase 8.

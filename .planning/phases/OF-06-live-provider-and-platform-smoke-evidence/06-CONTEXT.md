# Phase 6: Live Provider and Platform Smoke Evidence - Context

**Gathered:** 2026-05-21T10:00:32+08:00
**Status:** Ready for planning

<domain>
## Phase Boundary

Phase 6 delivers a reproducible beta evidence package for live Copilot provider behavior, physical Windows/WSL terminal behavior, and release-gate status reporting. It does not add new runtime capabilities. The output should make the remaining v1.0 caveats inspectable as `Pass`, `Caveat`, or `Blocked`, with exact commands, environments, owners, rerun paths, and redaction checks.

</domain>

<decisions>
## Implementation Decisions

### Live Provider Evidence

- **D-01:** Phase 6 may close with a live-provider `Caveat` when no disposable provider credential is available, provided the report records command, environment, missing reason, owner, rerun instructions, and redaction outcome. The live-provider caveat must not be removed in that case.
- **D-02:** Live provider evidence records only redacted result and public metadata: provider, model id, command, environment, pass/fail/skip status, error classification, owner, and rerun instructions. It must not record provider request bodies, provider response bodies, API keys, or full model outputs.
- **D-03:** Either OpenAI or Anthropic passing is sufficient to prove a real provider path for Phase 6. Record the concrete provider, model id, and environment. The untested provider remains uncovered but does not block Phase 6.
- **D-04:** Live provider failures must be classified as `missing_credential`, `missing_model`, `quota_or_auth`, `network`, `provider_error`, or `unexpected_contract`. Only product contract failures require implementation repair before closing; external conditions remain `Caveat` or `Blocked` evidence.

### Physical Windows/WSL Terminal Evidence

- **D-05:** Only real WSL terminal evidence can pass the tmux-backed Windows/WSL terminal gate. Native Windows can prove management UI only. Without a real WSL host, preserve `Caveat` or `Blocked` and do not remove the Windows caveat.
- **D-06:** WSL smoke pass evidence must cover core terminal lifecycle: `openforge doctor`, project launch, browser terminal attach, tmux session existence, WebSocket disconnect/reconnect, Gateway restart recovery, and no orphan smoke session.
- **D-07:** Provider setup, Copilot prompt behavior, Feishu smoke, and first-user feedback are not part of the Windows/WSL terminal pass condition.
- **D-08:** If a real WSL host is unavailable, record `Caveat` with unavailable-host reason, required host conditions, owner, rerun command/checklist, and explicit statement that the Windows caveat cannot be removed. Phase 6 may continue.
- **D-09:** WSL evidence should continue or create a dated v1.1 terminal gate report and update `docs/SMOKE-TEST.md`, `docs/TRIAL-CHECKLIST.md`, and `docs/CI-CD-PLAN.md` references. Do not bury WSL evidence only inside general docs.

### Release Gate Evidence Matrix

- **D-10:** Create a new v1.1 evidence matrix report as the release-gate evidence entry point. Recommended path: `docs/reports/v1.1-beta-evidence-burn-down-YYYY-MM-DD.md`. Smoke, trial, and CI docs should link to it instead of becoming the master table.
- **D-11:** Every gate row uses the same fields: Gate, Status, Command/Checklist, Environment, Evidence Summary, Artifact, Caveat/Blocker Reason, Owner, and Rerun/Next Action.
- **D-12:** Phase 6 matrix scope is limited to: live Copilot provider, physical Windows/WSL terminal, CI core smoke, `gate-d` browser smoke, focused tmux integration, release docs consistency, and secret/redaction scan.
- **D-13:** Feishu live callback evidence and first-user readiness packet evidence belong to Phases 7 and 8, not Phase 6.
- **D-14:** Old evidence may be referenced as baseline but does not automatically inherit Phase 6 `Pass`. If not rerun in Phase 6, mark as `Caveat` or `Baseline`, not a fresh v1.1 pass.

### Evidence Redaction Boundary

- **D-15:** Evidence reports must strictly forbid raw sensitive material: API keys, JWTs, Feishu app secrets/tokens, provider request bodies, provider response bodies, full model outputs, terminal transcripts that may contain secrets, and full auth/config file contents.
- **D-16:** Redaction proof may record secret scan or targeted grep commands, match counts, match categories, and whether matches are test fixtures or documentation placeholders. Do not paste sensitive matching text or before/after raw redaction examples.
- **D-17:** Successful provider smoke may record marker match, summary, and public metadata only. Do not record the full model response body or full model output.
- **D-18:** Before committing evidence files, run `git diff --check` and a targeted secret scan over new or modified evidence docs. Suspicious matches must be fixed or explicitly classified as test fixtures/placeholders before commit.

### Agent Discretion

- The planner may choose whether Phase 6 creates one combined report or a combined report plus a dedicated terminal-gate appendix, as long as the v1.1 evidence matrix remains the master entry point.
- The planner may decide exact report filename date format using existing `docs/reports/*-YYYY-MM-DD.md` conventions.

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Milestone and Phase Scope

- `.planning/ROADMAP.md` — Active v1.1 roadmap and Phase 6 scope.
- `.planning/REQUIREMENTS.md` — BETA-01, BETA-02, BETA-04, and BETA-05 requirements.
- `.planning/PROJECT.md` — Product boundary: local-first control plane, evidence-first readiness, no runtime expansion in v1.1.
- `.planning/milestones/v1.0-MILESTONE-AUDIT.md` — Source of remaining v1.0 caveats and v1.1 close recommendation.

### Release and Smoke Evidence Docs

- `docs/SMOKE-TEST.md` — Existing smoke procedure, live provider harness instructions, Windows/WSL caveat language, pass criteria.
- `docs/TRIAL-CHECKLIST.md` — Trial evidence fields for dependency, provider, Windows/WSL, and feedback capture.
- `docs/CI-CD-PLAN.md` — CI/core smoke, `gate-d`, focused tmux command, skip/rerun rules.
- `docs/reports/post-beta-release-gates-2026-05-10.md` — Historical release-gate evidence and Windows/WSL caveat baseline.
- `docs/reports/phase-1-live-provider-evidence-2026-05-19.md` — Prior live-provider caveat evidence and missing credential rerun path.
- `docs/reports/phase-1-terminal-gate-evidence-2026-05-19.md` — Current-host `mvp1`, `gate-d`, and focused tmux baseline evidence.

### Executable Evidence Assets

- `package.json` — `smoke:copilot-provider` script entry.
- `scripts/smoke-copilot-provider.ts` — Live provider smoke harness behavior and output shape.
- `scripts/smoke-copilot-provider.test.ts` — Expected skip/require behavior and secret-free summary tests.
- `packages/gateway/test/integration/tmux.test.ts` — Focused tmux integration command target.
- `packages/web/e2e/gate-d-smoke.spec.ts` — Browser terminal release/manual smoke target.
- `packages/web/e2e/mvp1-smoke.spec.ts` — CI control-plane smoke target.

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets

- `pnpm smoke:copilot-provider`: existing live provider harness entry point for BETA-01 evidence.
- `RUN_TMUX_TESTS=1 pnpm --dir packages/gateway test test/integration/tmux.test.ts`: existing focused tmux integration evidence command.
- `pnpm --dir packages/web exec playwright test e2e/mvp1-smoke.spec.ts --project=chromium --reporter=line`: existing CI/core control-plane smoke.
- `pnpm --dir packages/web exec playwright test e2e/gate-d-smoke.spec.ts --project=chromium --reporter=line`: existing browser terminal release/manual smoke.

### Established Patterns

- Release evidence uses explicit `Pass`, `Caveat`, and `Blocked` states instead of hiding unavailable external dependencies.
- External smokes should record exact host, command, environment, result, owner, and rerun path.
- Green CI is necessary but insufficient for live provider and physical platform caveat removal.
- Evidence docs must avoid raw secrets and should classify placeholder/test fixture matches separately from leaks.

### Integration Points

- Update `docs/reports/` with a v1.1 evidence matrix report as the master artifact.
- Update `docs/SMOKE-TEST.md`, `docs/TRIAL-CHECKLIST.md`, and `docs/CI-CD-PLAN.md` to point to the v1.1 evidence matrix and any new terminal gate report.
- If evidence commands are refined, keep existing script/test entry points unless a concrete gap requires code changes.

</code_context>

<specifics>
## Specific Ideas

- The v1.1 evidence matrix should include rows for live Copilot provider, physical Windows/WSL terminal, CI core smoke, `gate-d` browser smoke, focused tmux integration, release docs consistency, and secret/redaction scan.
- Current Linux/tmux evidence may support baseline confidence, but it cannot replace real WSL terminal evidence.
- Provider success should be marker-based; reports should not include complete model text.

</specifics>

<deferred>
## Deferred Ideas

- Feishu live callback evidence and deployment readiness are Phase 7 scope.
- First-user feedback packet and support diagnostics packaging are Phase 8 scope.
- Project-manager Web UX and remote execution runtime remain future milestone scope.

</deferred>

---

*Phase: 6-Live Provider and Platform Smoke Evidence*
*Context gathered: 2026-05-21T10:00:32+08:00*

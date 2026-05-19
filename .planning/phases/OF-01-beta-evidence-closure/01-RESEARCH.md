# Phase 1: Beta Evidence Closure - Research

**Researched:** 2026-05-19T20:15:17+08:00
**Status:** Ready for planning

## Research Question

What does the planner need to know to turn Phase 1 into executable work without expanding product scope?

Phase 1 is a release-evidence and documentation-trust phase. It should close or explicitly preserve the gates that mocked E2E, broad CI, and local unit tests cannot prove: live Copilot provider smoke, explicit tmux/browser-terminal release evidence, physical Windows/WSL evidence, first-user feedback triage, and stale source-of-truth documents.

## Inputs Reviewed

- `.planning/phases/OF-01-beta-evidence-closure/01-CONTEXT.md`
- `.planning/REQUIREMENTS.md`
- `.planning/ROADMAP.md`
- `CLAUDE.md`
- `.claude/CLAUDE.md`
- `.claude/rules/security.md`
- `.claude/rules/testing.md`
- `.github/workflows/ci.yml`
- `docs/CI-CD-PLAN.md`
- `docs/SMOKE-TEST.md`
- `docs/TRIAL-CHECKLIST.md`
- `docs/TRIAL-FEEDBACK.md`
- `docs/reports/trial-readiness-2026-05-06.md`
- `docs/reports/post-beta-release-gates-2026-05-10.md`
- `docs/superpowers/plans/2026-05-19-feishu-inbound-command-bridge-next.md`
- `scripts/smoke-copilot-provider.ts`
- `scripts/smoke-copilot-provider.test.ts`
- `packages/web/e2e/gate-d-smoke.spec.ts`
- `packages/gateway/test/integration/tmux.test.ts`

## Findings

### 1. Live Provider Evidence Is Already Mechanized But Manual-Credential-Gated

`package.json` exposes `pnpm smoke:copilot-provider`, implemented by `scripts/smoke-copilot-provider.ts`. The script:

- supports `openai` and `anthropic`;
- uses `OPENFORGE_COPILOT_PROVIDER_SMOKE_REQUIRE=1` to make missing live configuration fail instead of skip;
- requires a model id via `OPENFORGE_COPILOT_PROVIDER_SMOKE_MODEL`, `OPENAI_MODEL`, or `ANTHROPIC_MODEL`;
- builds an in-memory tenant/provider setup and runs through `CopilotOrchestrator`;
- prints JSON containing status, provider, model id, run status, event types, assistant preview, and public config summary;
- redacts configured live credentials from thrown error output.

The existing unit test `scripts/smoke-copilot-provider.test.ts` verifies safe skip behavior, required-live failure behavior, public summary redaction, and error redaction. Planning should use this harness rather than inventing another smoke.

Planner implication:

- Create an evidence-recording task around the existing command.
- Do not add secrets to docs.
- If no disposable credential exists, record `Caveat` with `missing_provider_credential`, owner, and next action rather than treating the requirement as passed.

### 2. CI Runs The Stable E2E Smoke, Not The Full Documented Browser-Terminal Gate

`.github/workflows/ci.yml` currently runs:

- workspace typecheck/test/build;
- `RUN_TMUX_TESTS=1` in the workspace test environment;
- `packages/web/e2e/mvp1-smoke.spec.ts` as the core Web E2E smoke;
- Codex app-server Web smoke;
- npm package build/verify/smoke;
- environment-gated notes for tmux, Claude CLI, Codex CLI, Windows/WSL, and manual browser smoke.

`docs/CI-CD-PLAN.md` still documents a fuller E2E command including both `e2e/gate-d-smoke.spec.ts` and `e2e/mvp1-smoke.spec.ts`. The repository therefore has a trust-boundary mismatch: CI is useful and required, but CI does not by itself prove the documented `gate-d-smoke` terminal route.

Planner implication:

- Do not force `gate-d-smoke` into required CI by default; that was decided against in CONTEXT.
- Update docs/reports so `mvp1-smoke` is described as the required CI control-plane smoke and `gate-d-smoke` as release/manual evidence unless the host environment supports it.
- Ensure any CI summary or release report explains this boundary and never suggests `mvp1-smoke` proves browser terminal end-to-end behavior.

### 3. Explicit tmux Evidence Must Be Separated From Broad Workspace Tests

`packages/gateway/test/integration/tmux.test.ts` is skipped unless `RUN_TMUX_TESTS=1`. CI sets `RUN_TMUX_TESTS=1` globally before `pnpm -r test`, so the tmux test may run indirectly when CI has tmux installed. However, Phase 1 decision D-05 requires explicit evidence for:

```bash
RUN_TMUX_TESTS=1 pnpm --dir packages/gateway test test/integration/tmux.test.ts
```

Planner implication:

- The explicit command result should appear in release/manual evidence or be recorded as `Caveat`.
- If CI is updated, the safest low-scope change is an explicit CI step that runs the focused tmux test and writes a clear summary. The planner may also preserve it as manual release evidence if avoiding CI churn.

### 4. Windows/WSL Evidence Is Manual And Must Remain A Caveat Without A Real Host

`docs/SMOKE-TEST.md` states Windows terminal acceptance must be run from WSL and that native Windows management UI checks do not prove tmux-backed browser terminal sessions. `docs/TRIAL-CHECKLIST.md` already contains Windows-only fields for native UI and WSL terminal evidence.

Planner implication:

- Do not use Ubuntu CI, mocked Playwright, or documentation review as a substitute for physical Windows/WSL evidence.
- If no physical host is available during execution, create or update an evidence row with `Status: Caveat`, skip reason, owner, and next action.
- Do not remove the Windows caveat from release docs until physical evidence exists.

### 5. Stale Source-Of-Truth Documents Are The Fastest Trust Erosion Point

Known stale facts:

- `AGENTS.md` still says the product is `MVP Phase 0 / early infrastructure`.
- `MEMORY.md` contains PR #2 open/ready wording even after PR #2 was merged.
- `docs/superpowers/plans/2026-05-19-feishu-inbound-command-bridge-next.md` says PR #2 is open against `master`.
- `docs/reports/trial-readiness-2026-05-06.md` correctly records a historical `blocked` state, but lacks a current-status note pointing to later evidence.

Planner implication:

- The first plan should repair factual conflicts directly, not hide them behind a new report.
- Historical reports should preserve their original decision and add current-status or superseded notes.
- Avoid rewriting PRD, architecture, or development plan unless a concrete stale fact is found.

### 6. First-User Feedback Should Become A Triage Ledger, Not A Fix Queue

`docs/TRIAL-CHECKLIST.md` and `docs/TRIAL-FEEDBACK.md` already collect provider, Copilot, terminal, Windows/WSL, diagnostics, and reproduction evidence. Phase 1 should convert feedback into structured triage and requirement mapping without absorbing all Phase 3 fixes.

Planner implication:

- Add a narrow triage ledger/report surface if one does not already exist.
- Each feedback item should include result, reproduction details, category, severity, mapped requirement, and target follow-up phase/plan.
- Fix only issues that invalidate Phase 1 evidence itself; product hardening belongs to Phase 3.

## Recommended Plan Shape

1. **Documentation truth repair first.** This removes stale source-of-truth conflicts before new evidence is recorded.
2. **Evidence schema and report surface.** Use the agreed per-gate fields: gate, status, command/procedure, environment, result summary, log/report path, skip reason, owner, next action.
3. **Live provider evidence or caveat.** Run `pnpm smoke:copilot-provider` only with disposable/rotatable credentials. Capture redacted JSON only.
4. **Terminal/tmux gate alignment.** Record focused tmux evidence and clarify `mvp1-smoke` vs `gate-d-smoke`.
5. **Windows/WSL and feedback triage.** Record physical evidence if available; otherwise preserve caveat. Convert first-user feedback into a triage ledger mapped to Phase 3.

## Risks

| Risk | Why It Matters | Planning Mitigation |
|------|----------------|---------------------|
| Secret leakage in provider evidence | Live provider smoke uses real credentials | Use only disposable/rotatable keys; record only redacted JSON and public summary fields |
| False-green CI wording | CI runs `mvp1-smoke`, not the full terminal `gate-d-smoke` | Make docs distinguish CI required smoke from manual release evidence |
| Historical report rewriting | It can erase why old gates were blocked | Add current-status notes instead of replacing original decisions |
| Scope creep into Phase 3 | First-user feedback can become an unbounded fix queue | Record triage ledger and map fixes to Phase 3 unless evidence is invalidated |
| Windows/WSL unavailability | Physical platform evidence may be impossible in current host | Preserve `Caveat` with owner and next action; do not block other gates |

## Validation Architecture

### Automated Validation

- `git diff --check` after documentation and plan edits.
- `gsd-sdk query init.phase-op 1` to confirm GSD recognizes `has_context`, `has_research`, and later `has_plans`.
- `gsd-sdk query roadmap.get-phase 1` to confirm Phase 1 remains parseable.
- `pnpm smoke:copilot-provider` for live-provider evidence when disposable credentials are available.
- `RUN_TMUX_TESTS=1 pnpm --dir packages/gateway test test/integration/tmux.test.ts` for explicit tmux evidence when tmux is available.
- `pnpm --dir packages/web exec playwright test e2e/gate-d-smoke.spec.ts --project=chromium --reporter=line` for browser-terminal release evidence when Gateway/Web and CLI dependencies are available.

### Manual-Only Validation

- Physical Windows/WSL terminal evidence from `docs/TRIAL-CHECKLIST.md`.
- Live provider smoke with a disposable credential supplied outside the repository.
- Review of evidence artifacts to confirm no API keys, JWTs, attach tokens, private keys, or unrelated project secrets were recorded.
- First-user feedback triage review to confirm items are mapped to `REL-*`/`UX-*` requirements and Phase 3 follow-up tasks rather than silently dropped.

### Acceptance Rules For Plans

- Every plan must reference the relevant `REL-*` IDs in frontmatter.
- Every plan must include at least one verifiable source assertion or command.
- Evidence plans must encode `Pass / Caveat / Blocked` and `skip reason + owner + next action` where a gate cannot run.
- No plan may remove the Windows/WSL caveat without physical evidence.

# Phase 6: Live Provider and Platform Smoke Evidence - Research

**Researched:** 2026-05-21T10:37:00+08:00
**Status:** Ready for planning

## Research Question

What does the planner need to know to turn Phase 6 into executable evidence work without expanding OpenForge beyond v1.1 beta evidence burn-down?

Phase 6 is an evidence and release-gate reconciliation phase. It should produce inspectable `Pass`, `Caveat`, or `Blocked` records for live Copilot provider behavior, physical Windows/WSL terminal behavior, automated CI smoke, release/manual browser smoke, explicit tmux integration, docs consistency, and redaction checks. It should not add new runtime features.

## Inputs Reviewed

- `.planning/ROADMAP.md`
- `.planning/REQUIREMENTS.md`
- `.planning/PROJECT.md`
- `.planning/phases/OF-06-live-provider-and-platform-smoke-evidence/06-CONTEXT.md`
- `.planning/milestones/v1.0-MILESTONE-AUDIT.md`
- `docs/SMOKE-TEST.md`
- `docs/TRIAL-CHECKLIST.md`
- `docs/CI-CD-PLAN.md`
- `docs/reports/post-beta-release-gates-2026-05-10.md`
- `docs/reports/phase-1-live-provider-evidence-2026-05-19.md`
- `docs/reports/phase-1-terminal-gate-evidence-2026-05-19.md`
- `package.json`
- `scripts/smoke-copilot-provider.ts`
- `scripts/smoke-copilot-provider.test.ts`
- `packages/gateway/test/integration/tmux.test.ts`
- `packages/web/e2e/gate-d-smoke.spec.ts`
- `packages/web/e2e/mvp1-smoke.spec.ts`

## Findings

### 1. The Live Provider Gate Already Has A Narrow Harness

`package.json` exposes `pnpm smoke:copilot-provider`, implemented by `scripts/smoke-copilot-provider.ts`. The harness supports `openai` and `anthropic`, accepts `OPENFORGE_COPILOT_PROVIDER_SMOKE_REQUIRE=1`, requires a model id, creates an in-memory tenant/provider setup, runs through `CopilotOrchestrator`, and emits JSON with provider, model id, run status, event types, assistant preview, and public config summary.

`scripts/smoke-copilot-provider.test.ts` already verifies safe skip behavior, required-live failure behavior, public-summary redaction, Anthropic inference, and error redaction.

Planner implication:

- Use the existing harness; do not invent a second smoke path.
- If no disposable provider credential and model id exist, record a `Caveat` with `missing_credential` or `missing_model`, owner, environment, rerun command, and redaction outcome.
- If OpenAI or Anthropic passes, record only public metadata, marker match, run status, event types, and redacted summary. Do not record request bodies, response bodies, API keys, or full model output.

### 2. Windows/WSL Pass Evidence Is Manual And Host-Specific

`docs/SMOKE-TEST.md` states Windows terminal acceptance must be run from WSL; native Windows management UI evidence does not prove tmux-backed browser terminal behavior. `docs/TRIAL-CHECKLIST.md` already contains Windows-only fields for WSL distribution/version and native Windows management UI separation.

Planner implication:

- Physical WSL can pass the gate only if the executor actually has a real WSL host.
- Without that host, Phase 6 should preserve the Windows/WSL caveat with required host conditions, owner, and rerun checklist.
- The WSL evidence checklist must include `openforge doctor`, project launch, browser terminal attach, tmux session existence, WebSocket disconnect/reconnect, Gateway restart recovery, and no orphan smoke session.

### 3. CI And Release Evidence Must Stay Separated

`docs/CI-CD-PLAN.md` distinguishes CI `mvp1-smoke`, release/manual `gate-d-smoke`, and focused tmux evidence. Prior evidence in `docs/reports/phase-1-terminal-gate-evidence-2026-05-19.md` recorded:

- `mvp1-smoke` as current-host CI control-plane smoke;
- `gate-d-smoke` as current-host release/manual browser terminal smoke;
- `RUN_TMUX_TESTS=1 pnpm --dir packages/gateway test test/integration/tmux.test.ts` as focused tmux integration evidence.

Planner implication:

- The v1.1 matrix should include separate rows for CI core smoke, `gate-d` browser smoke, and focused tmux integration.
- If a command is not rerun during Phase 6, mark it `Baseline` or `Caveat`; do not promote older evidence to fresh v1.1 `Pass`.
- `pnpm -r test` alone must not be described as proof of the focused tmux or browser terminal release gate.

### 4. Evidence Needs A Master Matrix

Phase 6 context requires a master report at `docs/reports/v1.1-beta-evidence-burn-down-YYYY-MM-DD.md`. Every row must use the same fields: Gate, Status, Command/Checklist, Environment, Evidence Summary, Artifact, Caveat/Blocker Reason, Owner, and Rerun/Next Action.

Planner implication:

- Plan 06-01 should create or initialize the master v1.1 evidence matrix and live provider row.
- Plan 06-02 should complete physical Windows/WSL, CI, `gate-d`, tmux, docs consistency, and secret/redaction scan rows.
- `docs/SMOKE-TEST.md`, `docs/TRIAL-CHECKLIST.md`, and `docs/CI-CD-PLAN.md` should link to the matrix rather than each becoming a competing source of truth.

### 5. Redaction Is A Blocking Quality Gate

The context forbids raw API keys, JWTs, Feishu app secrets/tokens, provider request bodies, provider response bodies, full model outputs, terminal transcripts that may contain secrets, and full auth/config file contents in evidence. `scripts/smoke-copilot-provider.ts` has `sanitizeSmokeOutput`, but evidence docs still need manual/static checks.

Planner implication:

- Every evidence-writing task needs redaction acceptance criteria.
- Before commit, run `git diff --check` and a targeted secret scan across modified evidence docs.
- Scan output may record commands, counts, and categories, but not raw secret-like matched text unless it is a known fixture/placeholder classification.

## Recommended Plan Shape

1. **Plan 06-01: Live provider and master matrix start.** Create the v1.1 matrix, run or classify `pnpm smoke:copilot-provider`, record only redacted/public output, and link smoke/trial docs to the matrix.
2. **Plan 06-02: Platform smoke and release-gate reconciliation.** Run or block WSL smoke, rerun or baseline CI/gate-d/tmux evidence, update CI/trial/smoke docs, and complete docs consistency plus redaction rows.

## Risks

| Risk | Why It Matters | Planning Mitigation |
|------|----------------|---------------------|
| Secret leakage in live evidence | Provider smokes use real credentials | Record public metadata and redacted JSON only; run targeted secret scans before commit |
| False removal of caveats | v1.1 exists to replace uncertainty with evidence, not optimism | Require `Pass` only from real command/host evidence; otherwise preserve `Caveat` or `Blocked` |
| CI false-green wording | CI control-plane smoke cannot prove WSL or full browser terminal behavior | Keep separate matrix rows for CI, `gate-d`, tmux, and WSL |
| Scope creep into Phase 7/8 | Feishu callback and first-user packet are later phases | Keep Phase 6 matrix limited to the seven gates in D-12 |
| Host unavailability | Disposable credentials or WSL host may not be available | Make caveat recording first-class and actionable with owner plus rerun path |

## Validation Architecture

### Automated Validation

- `git diff --check`.
- `gsd-sdk query init.phase-op 6`.
- `gsd-sdk query check.decision-coverage-plan .planning/phases/OF-06-live-provider-and-platform-smoke-evidence .planning/phases/OF-06-live-provider-and-platform-smoke-evidence/06-CONTEXT.md`.
- `pnpm smoke:copilot-provider` when no disposable credential exists to confirm safe skip, or `OPENFORGE_COPILOT_PROVIDER_SMOKE_REQUIRE=1 ... pnpm smoke:copilot-provider` when a disposable credential/model are supplied.
- `RUN_TMUX_TESTS=1 pnpm --dir packages/gateway test test/integration/tmux.test.ts` when tmux is available.
- `pnpm --dir packages/web exec playwright test e2e/mvp1-smoke.spec.ts --project=chromium --reporter=line` when Gateway/Web local ports can be bound.
- `pnpm --dir packages/web exec playwright test e2e/gate-d-smoke.spec.ts --project=chromium --reporter=line` when Gateway/Web/CLI prerequisites are available.

### Manual-Only Validation

- Physical Windows/WSL terminal smoke on a real WSL host.
- Live provider pass evidence with a disposable OpenAI or Anthropic credential supplied outside the repository.
- Manual review that evidence docs contain no raw credentials, full provider payloads, full model output, or terminal transcripts containing secrets.

### Acceptance Rules For Plans

- Every plan must reference `BETA-01`, `BETA-02`, `BETA-04`, or `BETA-05` in frontmatter.
- Every task must include `<read_first>` and `<acceptance_criteria>`.
- Every `Caveat` or `Blocked` row must include reason, owner, and rerun/next action.
- No plan may remove the live-provider caveat without disposable live provider evidence.
- No plan may remove the Windows/WSL caveat without real WSL terminal evidence.

## RESEARCH COMPLETE

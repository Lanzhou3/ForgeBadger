# Roadmap: OpenForge v1.1 Beta Evidence Burn-down

## Overview

OpenForge v1.1 focuses on first-user readiness evidence, not new runtime scope. The milestone converts the remaining v1.0 caveats into reproducible `Pass`, `Caveat`, or `Blocked` records for live provider behavior, physical Windows/WSL terminal behavior, first-user feedback, Feishu public webhook live exposure, and support diagnostics.

## Milestones

- **v1.0 Post-Beta Trust Closure** - Shipped 2026-05-20; archived in `.planning/milestones/`.
- **v1.1 Beta Evidence Burn-down** - Active; Phases 6-8.

## Phases

<details>
<summary>v1.0 Post-Beta Trust Closure (Phases 1-5) - SHIPPED 2026-05-20</summary>

- [x] Phase 1: Beta Evidence Closure - 4/4 plans completed 2026-05-19.
- [x] Phase 2: Public Feishu Webhook Safety - 2/2 plans completed 2026-05-20.
- [x] Phase 3: First-User Product Hardening - 4/4 plans completed 2026-05-20.
- [x] Phase 4: Feishu Project Manager Ledger - 2/2 plans completed 2026-05-20.
- [x] Phase 5: Remote Execution Architecture - 1/1 plan completed 2026-05-20.

Full details are archived in `.planning/milestones/v1.0-ROADMAP.md`.

</details>

### Phase 6: Live Provider and Platform Smoke Evidence

**Goal**: Replace v1.0 live-provider and physical Windows/WSL caveats with real pass/caveat/blocker evidence and a reconciled release-gate matrix.
**Depends on**: v1.0 archived evidence, current smoke docs, and access to disposable provider credentials and/or a physical Windows/WSL host.
**Requirements**: BETA-01, BETA-02, BETA-04, BETA-05
**Canonical refs**:

- `.planning/milestones/v1.0-MILESTONE-AUDIT.md`
- `docs/SMOKE-TEST.md`
- `docs/TRIAL-CHECKLIST.md`
- `docs/CI-CD-PLAN.md`
- `docs/reports/post-beta-release-gates-2026-05-10.md`
- `packages/gateway/test/tmux.test.ts`
- `packages/web/e2e/`

**Success Criteria** (what must be TRUE):

1. Live Copilot provider smoke has a redacted evidence record with provider, explicit model id, command, result, and rerun instructions, or a precise blocker.
2. Physical Windows/WSL smoke has a real-host evidence record for project launch, terminal attach/reconnect, tmux persistence, and recovery, or a precise blocker.
3. Release and trial docs preserve `Pass`, `Caveat`, and `Blocked` states and do not remove caveats without corresponding evidence.
4. CI/release gate docs reconcile automated CI, local browser smoke, tmux integration, and manual real-host gates with exact skip/rerun instructions.
5. Evidence artifacts contain no provider credentials, JWTs, Feishu secrets, terminal transcripts with secrets, or raw API keys.

**Plans**: 2 plans

Plans:

**Wave 1**

- [x] 06-01: Run and record disposable live Copilot provider smoke evidence.

**Wave 2** *(blocked on Wave 1 evidence format)*

- [x] 06-02: Run or block physical Windows/WSL terminal smoke and reconcile release-gate docs.

### Phase 7: Feishu Live Callback Readiness

**Goal**: Decide whether the public Feishu webhook can be exposed to a real Feishu app callback, with live callback evidence and deployment caveats recorded.
**Depends on**: Phase 2 public webhook safety implementation and Phase 6 evidence format.
**Requirements**: FEI-01, FEI-02, FEI-03
**Canonical refs**:

- `.planning/milestones/v1.0-phases/OF-02-public-feishu-webhook-safety/02-VERIFICATION.md`
- `docs/API.md`
- `docs/superpowers/plans/2026-05-19-feishu-inbound-command-bridge-next.md`
- `packages/gateway/src/routes/integrations-feishu.ts`
- `packages/gateway/test/feishu-integration.test.ts`
- `packages/gateway/test/copilot-routes.test.ts`

**Success Criteria** (what must be TRUE):

1. A real Feishu developer-console callback URL verification attempt is recorded as `Pass`, `Caveat`, or `Blocked` with exact environment and rerun steps.
2. Public Feishu live exposure has an explicit topology decision for single-Gateway versus multi-instance deployment.
3. Encrypted payload handling is explicitly decided: supported with tests, or unsupported and fail-closed with user-facing caveat text.
4. Shared replay/rate storage requirements are documented before any multi-instance public exposure claim.
5. Live or simulated live evidence confirms Feishu free-form text still cannot approve pending actions, send terminal input, or bypass tenant/audit policy.

**Plans**: 2 plans

Plans:

**Wave 1**

- [x] 07-01: Prepare and run Feishu callback verification path, or record the exact live-app blocker.

**Wave 2** *(blocked on Wave 1 callback result)*

- [x] 07-02: Finalize Feishu live-exposure decision, encrypted-payload boundary, shared-store caveat, and approval/terminal authority regression evidence.

### Phase 8: First-User Readiness Packet

**Goal**: Package completed first-user feedback, diagnostics, and closeout evidence into a maintainable readiness handoff.
**Depends on**: Phase 6 evidence status and Phase 7 Feishu exposure decision.
**Requirements**: BETA-03, READY-01, READY-02, READY-03
**Canonical refs**:

- `docs/TRIAL-CHECKLIST.md`
- `docs/TRIAL-FEEDBACK.md`
- `docs/reports/beta-handoff-2026-05-10.md`
- `docs/reports/platform-ai-copilot-product-audit-2026-05-13.md`
- `.planning/MILESTONES.md`
- `.planning/RETROSPECTIVE.md`

**Success Criteria** (what must be TRUE):

1. Completed first-user feedback is attached or explicitly blocked with a concrete owner, collection path, and expected artifact shape.
2. Trial checklist provides one runnable path covering setup, dependencies, provider readiness, terminal smoke, Copilot smoke, Feishu smoke if available, and feedback capture.
3. Support diagnostics packet includes exact commands, expected artifacts, redaction guidance, and escalation boundaries for provider, runtime, and Feishu failures.
4. v1.1 closeout report summarizes remaining risks as explicit user-facing caveats or next-milestone backlog items.
5. No support or trial artifact asks users to expose credentials, raw provider keys, Feishu app secrets, JWTs, or sensitive terminal output.

**Plans**: 2 plans

Plans:

**Wave 1**

- [ ] 08-01: Capture first-user feedback packet and support diagnostics reproduction path.

**Wave 2** *(blocked on Phase 6 and Phase 7 evidence status)*

- [ ] 08-02: Produce v1.1 readiness closeout report and route remaining risks to backlog.

## Progress

**Execution Order:**
Phases execute in numeric order: 6 -> 7 -> 8.

| Phase | Milestone | Plans Complete | Status | Completed |
|-------|-----------|----------------|--------|-----------|
| 6. Live Provider and Platform Smoke Evidence | v1.1 | 2/2 | Complete   | 2026-05-21 |
| 7. Feishu Live Callback Readiness | v1.1 | 2/2 | Complete   | 2026-05-21 |
| 8. First-User Readiness Packet | v1.1 | 0/2 | Not started | - |

## Backlog

Deferred after v1.1 unless reprioritized:

- Project-manager Web workflow for ledger goals, work items, and evidence references.
- SSH/remote execution runtime implementation from the Phase 5 architecture package.
- Encrypted Feishu payload support if a real Feishu app requires encrypted events.
- Shared replay/rate store implementation for multi-instance public Feishu webhook deployment.

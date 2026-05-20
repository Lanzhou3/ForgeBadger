# Roadmap: OpenForge Post-Beta Hardening

## Overview

OpenForge has shipped the local-first control plane, guarded Codex Background Tasks prototype, Platform AI Copilot, and Feishu command bridge into a beta-feedback-ready state. The next roadmap should protect the core product wedge: prove the current beta on real provider/platform paths, harden Feishu ingress before public exposure, then convert first-user feedback into focused product hardening before larger project-manager or remote-execution expansion.

## Milestones

- ✅ **Local-First MVP + Post-RC Prototype** - historical MVP-0 through MVP-10, Phase A, and Phase B acceptance are recorded in `MEMORY.md` and `docs/reports/`.
- 🚧 **Post-Beta Trust Closure** - Phases 1-3 focus external evidence, Feishu webhook safety, and first-user hardening.
- 📋 **Collaboration Expansion** - Phases 4-5 cover Feishu project-manager ledger and separate remote-execution architecture.

## Phases

- [x] **Phase 1: Beta Evidence Closure** - close live-provider, physical Windows/WSL, first-user feedback, and stale release-documentation gaps. (completed 2026-05-19)
- [x] **Phase 2: Public Feishu Webhook Safety** - design and implement public webhook boundary controls before exposing Feishu ingress beyond guarded test adapters. (completed 2026-05-20)
- [x] **Phase 3: First-User Product Hardening** - turn first-user dependency, provider, CLI, and Copilot usability feedback into scoped fixes. (completed 2026-05-20)
- [x] **Phase 4: Feishu Project Manager Ledger** - add work item and ledger state only after command bridge safety evidence is accepted. (completed 2026-05-20)
- [x] **Phase 5: Remote Execution Architecture** - keep SSH/remote execution separate with its own threat model and milestone. (completed 2026-05-20)

## Phase Details

### Phase 1: Beta Evidence Closure

**Goal**: Turn merged post-beta implementation into evidence-backed beta readiness by closing the external gates that CI and mocked E2E cannot prove.
**Depends on**: Merged PR #2 and current post-beta CI gates.
**Requirements**: REL-01, REL-02, REL-03, REL-04, REL-05, REL-06
**Canonical refs**:

- `MEMORY.md`
- `CLAUDE.md`
- `docs/DEVELOPMENT-PLAN.md`
- `docs/CI-CD-PLAN.md`
- `docs/SMOKE-TEST.md`
- `docs/TRIAL-CHECKLIST.md`
- `docs/TRIAL-FEEDBACK.md`
- `docs/reports/platform-ai-copilot-product-audit-2026-05-13.md`
- `docs/reports/post-beta-release-gates-2026-05-10.md`

**Success Criteria** (what must be TRUE):

  1. Live Copilot provider smoke evidence is recorded with a disposable provider credential and no secret leakage.
  2. Physical Windows/WSL smoke evidence is recorded before the Windows platform caveat is removed.
  3. First-user Copilot feedback is captured, triaged, and mapped to specific hardening tasks.
  4. `MEMORY.md`, `AGENTS.md`, Feishu plan docs, and release docs no longer describe stale phase or PR states.
  5. CI/release evidence either runs `gate-d-smoke` and explicit tmux integration, or preserves their caveats with exact skip reasons.

**Plans**: 4 plans

Plans:
**Wave 1**

- [x] 01-01: Refresh post-merge release and progress documentation.

**Wave 2** *(blocked on Wave 1 completion)*

- [x] 01-02: Run and record live Copilot provider smoke evidence.
- [x] 01-03: Run physical Windows/WSL smoke or record the blocker and keep the caveat.

**Wave 3** *(blocked on Wave 2 completion)*

- [x] 01-04: Align CI gates and evidence reports with terminal E2E and explicit tmux requirements.

### Phase 2: Public Feishu Webhook Safety

**Goal**: Move Feishu inbound from a guarded authenticated/local test adapter toward a public webhook design with explicit boundary verification.
**Depends on**: Phase 1 evidence refresh and current guarded inbound bridge.
**Requirements**: FSH-01, FSH-02, FSH-03, FSH-04
**Canonical refs**:

- `docs/superpowers/specs/2026-05-17-feishu-project-manager-copilot-design.md`
- `docs/superpowers/plans/2026-05-17-feishu-project-manager-copilot.md`
- `docs/superpowers/plans/2026-05-19-feishu-inbound-command-bridge-next.md`
- `docs/API.md`
- `packages/gateway/src/routes/integrations-feishu.ts`
- `packages/gateway/test/feishu-integration.test.ts`

**Success Criteria** (what must be TRUE):

  1. Public Feishu webhook signature, timestamp, replay, and failure semantics are specified before implementation.
  2. Replay and rate limiting are appropriate for the deployment model, with shared-store migration called out before multi-instance use.
  3. Chat allowlist, identity mode, user mapping, redaction, and audit behavior remain fail-closed.
  4. Natural-language Feishu approval text still cannot approve pending actions or control terminals.

**Plans**: 2 plans

Plans:

**Wave 1**

- [x] 02-01: Specify public webhook boundary, signature verification, replay, and rate-limit contract.

**Wave 2** *(blocked on Wave 1 completion)*

- [x] 02-02: Implement and verify the public webhook route behind explicit configuration.

### Phase 3: First-User Product Hardening

**Goal**: Convert real beta feedback into fixes that reduce confusion, improve recovery, and preserve the local-first product wedge.
**Depends on**: Phase 1 first-user feedback intake.
**Requirements**: UX-01, UX-02, UX-03, UX-04, UX-05, UX-06, UX-07
**Canonical refs**:

- `docs/superpowers/specs/2026-05-06-openforge-post-rc-roadmap-design.md`
- `docs/TRIAL-CHECKLIST.md`
- `docs/TRIAL-FEEDBACK.md`
- `docs/reports/beta-handoff-2026-05-10.md`
- `docs/reports/platform-ai-copilot-product-audit-2026-05-13.md`
- `packages/web/src/components/copilot/copilot-chat-panel.tsx`
- `packages/gateway/src/routes/copilot.ts`

**Success Criteria** (what must be TRUE):

  1. Missing dependency and unsupported runtime states are visible, actionable, and tested.
  2. Provider/model/credential recovery paths are clear without exposing secrets.
  3. Copilot run and pending-action states remain coherent through retries, cancellation, refresh, and multiple tabs.
  4. Settings and Copilot partial-failure states are visible and recoverable.
  5. Trial feedback produces reproducible tasks rather than vague product notes.

**Plans**: 4 plans

Plans:

**Wave 1**

- [x] 03-01: Harden dependency and runtime failure states.
- [x] 03-03: Refresh trial checklist and feedback routing from observed user reports.

**Wave 2** *(blocked on Wave 1 completion)*

- [x] 03-02: Harden provider/Copilot recovery and state clarity.

**Wave 3** *(blocked on Wave 2 completion)*

- [x] 03-04: Harden Web E2E mocks, selectors, and Copilot state ordering.

### Phase 4: Feishu Project Manager Ledger

**Goal**: Add auditable project-manager work item state after Feishu command ingress is proven safe.
**Depends on**: Phase 2 public webhook safety and accepted bridge evidence.
**Requirements**: PM-01, PM-02, PM-03
**Canonical refs**:

- `docs/superpowers/specs/2026-05-17-feishu-project-manager-copilot-design.md`
- `docs/superpowers/plans/2026-05-17-feishu-project-manager-copilot.md`
- `docs/API.md`

**Success Criteria** (what must be TRUE):

  1. Work item and ledger tables are tenant-scoped and migration-backed.
  2. Ledger events are auditable and do not grant Feishu terminal or approval authority.
  3. Copilot and Feishu surfaces can explain current project-manager state without leaking secrets or cross-tenant data.

**Plans**: 2 plans

Plans:

**Wave 1**

- [x] 04-01: Specify ledger model, state transitions, and audit semantics.

**Wave 2** *(blocked on Wave 1 completion)*

- [x] 04-02: Implement backend and diagnostics surfaces for project-manager state.

### Phase 5: Remote Execution Architecture

**Goal**: Treat SSH/remote execution as a separate product and security milestone instead of bundling it into local beta hardening.
**Depends on**: Phase 3 hardening and explicit user reprioritization.
**Requirements**: REM-01, REM-02, COD-01
**Canonical refs**:

- `docs/DEVELOPMENT-PLAN.md`
- `docs/TECH-ARCHITECTURE.md`
- `docs/CI-CD-PLAN.md`

**Success Criteria** (what must be TRUE):

  1. Remote execution has a separate architecture spec, threat model, and rollback plan.
  2. Hosted/cloud/billing/telemetry decisions are not smuggled into local-first code paths.
  3. Codex turn input remains disabled unless transcript retention, consent, and security requirements are designed.

**Plans**: 1 plan

Plans:

- [x] 05-01: Produce remote-execution architecture and threat model before implementation.

## Progress

**Execution Order:**
Phases execute in numeric order: 1 -> 2 -> 3 -> 4 -> 5.

| Phase | Milestone | Plans Complete | Status | Completed |
|-------|-----------|----------------|--------|-----------|
| 1. Beta Evidence Closure | Post-Beta Trust Closure | 4/4 | Complete   | 2026-05-19 |
| 2. Public Feishu Webhook Safety | Post-Beta Trust Closure | 2/2 | Complete   | 2026-05-20 |
| 3. First-User Product Hardening | Post-Beta Trust Closure | 4/4 | Complete   | 2026-05-20 |
| 4. Feishu Project Manager Ledger | Collaboration Expansion | 2/2 | Complete   | 2026-05-20 |
| 5. Remote Execution Architecture | Collaboration Expansion | 1/1 | Complete   | 2026-05-20 |

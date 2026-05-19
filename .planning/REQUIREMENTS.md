# Requirements: OpenForge

**Defined:** 2026-05-19
**Core Value:** Developers can reliably control and recover local AI CLI coding sessions from a browser without losing tenant isolation, credential boundaries, terminal persistence, or auditability.

## Current Milestone Requirements

### Release Evidence

- [x] **REL-01**: Maintainer can run `pnpm smoke:copilot-provider` with a disposable provider credential and record redacted live-provider evidence.
- [x] **REL-02**: Maintainer can run and record physical Windows/WSL smoke evidence before removing the platform caveat.
- [x] **REL-03**: First-user Copilot feedback is captured through the trial feedback path and triaged into concrete dependency, provider, CLI, or platform hardening tasks.
- [x] **REL-04**: Release documentation reflects the actual merged PR state, CI gates, and remaining external evidence caveats.
- [ ] **REL-05**: CI either runs the documented `gate-d-smoke` terminal E2E gate or records why that gate remains environment-gated.
- [ ] **REL-06**: CI or release evidence includes an explicit `RUN_TMUX_TESTS=1 ... tmux.test.ts` command result, not only indirect workspace-test coverage.

### Feishu Safety

- [ ] **FSH-01**: Public Feishu webhook ingress has a documented signature-verification and timestamp/replay design before public exposure.
- [ ] **FSH-02**: Feishu inbound replay protection and per-chat rate limiting are safe for the intended deployment topology.
- [ ] **FSH-03**: Feishu inbound and outbound paths enforce tenant configuration, chat allowlists, identity mode, and user mappings before Copilot or outbound execution.
- [ ] **FSH-04**: Feishu free-form text cannot approve pending actions, send terminal input, or bypass OpenForge approval/audit semantics.

### First-User Hardening

- [ ] **UX-01**: Dependency failures such as missing tmux, missing Claude/Codex CLI, or unsupported native Windows terminal mode surface as actionable UI/CLI guidance.
- [ ] **UX-02**: Provider/model/credential readiness failures are recoverable from user-facing Copilot and diagnostics states without exposing secrets.
- [ ] **UX-03**: Copilot run, pending-action, cancellation, and waiting-for-approval states remain monotonic and understandable under retries, refresh, and multiple tabs.
- [ ] **UX-04**: Product trial checklist and feedback routing are specific enough that first-user reports are reproducible.
- [ ] **UX-05**: Copilot Web active-run state updates are guarded by monotonic `updatedAt`/event sequence/request order rules.
- [ ] **UX-06**: Settings and Copilot panels show recoverable error states for partial API/query failures.
- [ ] **UX-07**: Web E2E mocks fail fast for unhandled `/api/v1/*` routes and key assertions use stable selectors where practical.

### Project Manager Expansion

- [ ] **PM-01**: Project-manager work item and ledger tables are introduced only after Feishu bridge safety evidence is accepted.
- [ ] **PM-02**: Project-manager state remains auditable, tenant-scoped, and separate from terminal authority.
- [ ] **PM-03**: Any future Feishu approval semantics require explicit OpenForge approval tokens and audit rows, not natural language approval text.

## Deferred Requirements

### Remote Execution

- **REM-01**: SSH/remote execution has its own architecture review, threat model, and implementation phase.
- **REM-02**: Hosted collaboration, cloud deployment, billing, telemetry, and marketplace operations are handled in later milestones.

### Codex Turn Input

- **COD-01**: Codex app-server Web prompt/turn input requires explicit transcript retention controls, security review, and user-facing consent before exposure.

## Out of Scope

| Feature | Reason |
|---------|--------|
| Feishu terminal control | Feishu is a collaboration channel, not execution authority. |
| Free-form Feishu approvals | Approval semantics must be explicit, tokenized, and auditable. |
| Autonomous remote development loop | Too broad for local-first beta and changes the safety model. |
| Codex provider API-key injection | Codex launch paths remain subscription/SDK-managed. |
| Removing Windows/WSL caveat without physical smoke | Ubuntu CI cannot prove native Windows terminal behavior. |

## Traceability

| Requirement | Phase | Status |
|-------------|-------|--------|
| REL-01 | Phase 1 | Complete |
| REL-02 | Phase 1 | Complete |
| REL-03 | Phase 1 | Complete |
| REL-04 | Phase 1 | Complete |
| REL-05 | Phase 1 | Pending |
| REL-06 | Phase 1 | Pending |
| FSH-01 | Phase 2 | Pending |
| FSH-02 | Phase 2 | Pending |
| FSH-03 | Phase 2 | Pending |
| FSH-04 | Phase 2 | Pending |
| UX-01 | Phase 3 | Pending |
| UX-02 | Phase 3 | Pending |
| UX-03 | Phase 3 | Pending |
| UX-04 | Phase 3 | Pending |
| UX-05 | Phase 3 | Pending |
| UX-06 | Phase 3 | Pending |
| UX-07 | Phase 3 | Pending |
| PM-01 | Phase 4 | Pending |
| PM-02 | Phase 4 | Pending |
| PM-03 | Phase 4 | Pending |
| REM-01 | Phase 5 | Pending |
| REM-02 | Phase 5 | Pending |
| COD-01 | Phase 5 | Pending |

**Coverage:**
- Current milestone requirements: 20 total
- Mapped to phases: 20
- Deferred requirements: 3 total
- Unmapped: 0

---
*Requirements defined: 2026-05-19*
*Last updated: 2026-05-19 after GSD bootstrap from post-beta review*

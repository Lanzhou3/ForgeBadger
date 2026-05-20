# Requirements: OpenForge

**Defined:** 2026-05-19
**Core Value:** Developers can reliably control and recover local AI CLI coding sessions from a browser without losing tenant isolation, credential boundaries, terminal persistence, or auditability.

## Current Milestone Requirements

### Release Evidence

- [x] **REL-01**: Maintainer live-provider evidence is recorded with `Pass / Caveat / Blocked` status; current Phase 1 status is `Caveat` until a disposable provider credential and explicit model id are supplied.
- [x] **REL-02**: Physical Windows/WSL evidence is recorded with `Pass / Caveat / Blocked` status before removing the platform caveat; current Phase 1 status is `Caveat` until a real Windows/WSL host completes the smoke.
- [x] **REL-03**: First-user Copilot feedback path captures triage fields and maps feedback into dependency, provider, CLI, or platform hardening tasks; current Phase 1 status is `Caveat` until completed feedback is attached.
- [x] **REL-04**: Release documentation reflects the actual merged PR state, CI gates, and remaining external evidence caveats.
- [x] **REL-05**: CI either runs the documented `gate-d-smoke` terminal E2E gate or records why that gate remains environment-gated.
- [x] **REL-06**: CI or release evidence includes an explicit `RUN_TMUX_TESTS=1 ... tmux.test.ts` command result, not only indirect workspace-test coverage.

### Feishu Safety

- [x] **FSH-01**: Public Feishu webhook ingress has a documented signature-verification and timestamp/replay design before public exposure.
- [x] **FSH-02**: Feishu inbound replay protection and per-chat rate limiting are safe for the intended deployment topology.
- [x] **FSH-03**: Feishu inbound and outbound paths enforce tenant configuration, chat allowlists, identity mode, and user mappings before Copilot or outbound execution.
- [x] **FSH-04**: Feishu free-form text cannot approve pending actions, send terminal input, or bypass OpenForge approval/audit semantics.

### First-User Hardening

- [x] **UX-01**: Dependency failures such as missing tmux, missing Claude/Codex CLI, or unsupported native Windows terminal mode surface as actionable UI/CLI guidance.
- [x] **UX-02**: Provider/model/credential readiness failures are recoverable from user-facing Copilot and diagnostics states without exposing secrets.
- [x] **UX-03**: Copilot run, pending-action, cancellation, and waiting-for-approval states remain monotonic and understandable under retries, refresh, and multiple tabs.
- [x] **UX-04**: Product trial checklist and feedback routing are specific enough that first-user reports are reproducible.
- [x] **UX-05**: Copilot Web active-run state updates are guarded by monotonic `updatedAt`/event sequence/request order rules.
- [x] **UX-06**: Settings and Copilot panels show recoverable error states for partial API/query failures.
- [x] **UX-07**: Web E2E mocks fail fast for unhandled `/api/v1/*` routes and key assertions use stable selectors where practical.

### Project Manager Expansion

- [x] **PM-01**: Project-manager work item and ledger tables are introduced only after Feishu bridge safety evidence is accepted.
- [x] **PM-02**: Project-manager state remains auditable, tenant-scoped, and separate from terminal authority.
- [x] **PM-03**: Any future Feishu approval semantics require explicit OpenForge approval tokens and audit rows, not natural language approval text.

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
| REL-05 | Phase 1 | Complete |
| REL-06 | Phase 1 | Complete |
| FSH-01 | Phase 2 | Complete |
| FSH-02 | Phase 2 | Complete |
| FSH-03 | Phase 2 | Complete |
| FSH-04 | Phase 2 | Complete |
| UX-01 | Phase 3 | Complete |
| UX-02 | Phase 3 | Complete |
| UX-03 | Phase 3 | Complete |
| UX-04 | Phase 3 | Complete |
| UX-05 | Phase 3 | Complete |
| UX-06 | Phase 3 | Complete |
| UX-07 | Phase 3 | Complete |
| PM-01 | Phase 4 | Complete |
| PM-02 | Phase 4 | Complete |
| PM-03 | Phase 4 | Complete |
| REM-01 | Phase 5 | Complete |
| REM-02 | Phase 5 | Complete |
| COD-01 | Phase 5 | Complete |

**Coverage:**
- Current milestone requirements: 20 total
- Mapped to phases: 20
- Deferred requirements: 3 total
- Unmapped: 0

---
*Requirements defined: 2026-05-19*
*Last updated: 2026-05-20 after Phase 2 public Feishu webhook safety completion*

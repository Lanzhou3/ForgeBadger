# Requirements: OpenForge v1.5 First-User Trial Operations

**Defined:** 2026-05-29
**Core Value:** Developers can reliably control and recover local AI CLI coding sessions from a browser while first-user trial outcomes become redacted, routed, and auditable evidence.
**Milestone Goal:** Turn the v1.4 external evidence closeout into an operator-run first-user trial loop that preserves caveats until real artifacts exist and routes feedback into concrete follow-up.

## Readiness Assessment

- v1.4 External Evidence Closure is complete and archived under
  `.planning/milestones/v1.4-*`.
- `docs/EXTERNAL-EVIDENCE-GATES.md` is the canonical registry for external gate
  states and clearing conditions.
- OpenForge is suitable for cautious local-first trial, but live provider,
  physical Windows/WSL, Feishu developer-console callback, and completed
  first-user feedback evidence still require real external artifacts.
- The next product risk is operational: first users and maintainers need a
  clear, secret-safe loop for running the trial, filing feedback, and deciding
  whether an outcome unlocks a gate or becomes a follow-up defect.
- `upload_img/` remains unrelated untracked local data and is outside milestone
  scope.

## v1.5 Requirements

### Product Position

- [x] **TRIALOPS-01**: OpenForge remains a local-first AI CLI control plane with
  AI-native execution traceability; v1.5 does not add hosted collaboration,
  cloud workers, autonomous remote execution, Feishu execution authority, or
  Codex Web prompt/turn workflow.
- [x] **TRIALOPS-02**: v1.5 turns readiness into a first-user operating loop:
  run trial steps, collect bounded evidence, file feedback, triage outcome, and
  update gate status only when the required artifact exists.
- [x] **TRIALOPS-03**: Trial evidence and feedback route through existing
  canonical paths instead of creating competing source-of-truth documents.

### Trial Packet

- [x] **TRIALOPS-04**: A minimum completed first-user trial packet must include
  affected surface, severity, owner, disposition or next action, environment
  summary, reproduction detail, diagnostics status or unavailable reason,
  follow-up route or no-action rationale, and redaction review.
- [x] **TRIALOPS-05**: Trial outcomes must map to one of: gate-clearing evidence,
  preserved caveat/blocker, product defect, documentation/support gap, or
  explicit no-action rationale.
- [x] **TRIALOPS-06**: Trial routes must preserve links to issue #3
  (`LIVE-PROVIDER`), issue #4 (`WINDOWS-WSL`), issue #5
  (`FIRST-USER-FEEDBACK`), and the Feishu callback evidence report or a future
  public-callback artifact.

### Evidence Safety

- [x] **TRIALSAFE-01**: `LIVE-PROVIDER`, `WINDOWS-WSL`, `FEISHU-CALLBACK`, and
  `FIRST-USER-FEEDBACK` keep their v1.4 states unless
  `docs/EXTERNAL-EVIDENCE-GATES.md` clearing conditions are satisfied.
- [x] **TRIALSAFE-02**: First-user trial guidance must not ask users to paste
  API keys, JWTs, attach tokens, raw terminal transcripts, raw provider
  payloads, raw Feishu bodies, local databases, `.env` files, or private AI CLI
  config.
- [x] **TRIALSAFE-03**: Any automation proposed later in v1.5 must produce
  bounded metadata or prefilled issue/report fields only; raw evidence blob
  storage remains out of scope.

### Phase 21 Planning Closure

- [x] **PLAN-21-01**: Active source-of-truth docs select v1.5 and Phase 21
  instead of leaving the next milestone unselected.
- [x] **PLAN-21-02**: Phase 21 has context, design, and implementation plan
  artifacts with exact files and verification commands.
- [x] **PLAN-21-03**: Phase 21 verification proves milestone references,
  preserved external gate states, and secret-safe evidence wording.

### Operator Dry Run

- [x] **DRYRUN-01**: Maintainer/operator can run a current-host dry-run that
  records dependency versions, WSL classification, and `openforge doctor`
  terminal-runtime status without requesting secrets or raw local output.
- [x] **DRYRUN-02**: Source startup health is verified with bounded loopback
  evidence for Gateway `/api/v1/health` and Web `/login`, and temporary
  processes are stopped afterwards.
- [x] **DRYRUN-03**: Provider-smoke collection records the missing disposable
  credential path as `missing_provider_credential` and preserves
  `LIVE-PROVIDER` as `Caveat`.
- [x] **DRYSAFE-01**: Operator dry-run evidence is explicitly not completed
  first-user feedback and cannot clear `FIRST-USER-FEEDBACK`.
- [x] **DRYSAFE-02**: The dry-run records source-startup `.env` override
  behavior as a docs/support gap without exposing `.env` contents or local
  database contents.

### Phase 22 Planning Closure

- [x] **PLAN-22-01**: Phase 22 has context, plan, report, and summary artifacts
  under the active planning tree and docs report path.
- [x] **PLAN-22-02**: Active roadmap, requirements, milestone, project, state,
  decisions, and memory docs reflect Phase 22 completion while keeping real
  first-user packet collection pending.
- [x] **PLAN-22-03**: Phase 22 verification proves external gate states remain
  unchanged and no secret-like evidence wording was introduced.

## Out of Scope

| Feature | Reason |
|---------|--------|
| New runtime capability | v1.5 starts with trial operations, not product surface expansion. |
| Hosted collaboration, cloud deployment, billing, marketplace, telemetry | Requires separate architecture and security review. |
| Autonomous remote execution or unattended coding loops | Changes authority boundaries and threat model. |
| Feishu free-form approvals or terminal input | Feishu remains controlled collaboration ingress only. |
| Codex app-server Web turn input | The feature-flag prototype remains default-disabled and not user-facing. |
| Raw evidence blob storage | Evidence remains bounded references and redacted artifacts. |
| Clearing external caveats without artifacts | The v1.4 registry remains authoritative. |

## Traceability

| Requirement | Target Phase | Status |
|-------------|--------------|--------|
| TRIALOPS-01 | Phase 21 | Complete |
| TRIALOPS-02 | Phase 21 | Complete |
| TRIALOPS-03 | Phase 21 | Complete |
| TRIALOPS-04 | Phase 21 | Complete |
| TRIALOPS-05 | Phase 21 | Complete |
| TRIALOPS-06 | Phase 21 | Complete |
| TRIALSAFE-01 | Phase 21 | Complete |
| TRIALSAFE-02 | Phase 21 | Complete |
| TRIALSAFE-03 | Phase 21 | Complete |
| PLAN-21-01 | Phase 21 | Complete |
| PLAN-21-02 | Phase 21 | Complete |
| PLAN-21-03 | Phase 21 | Complete |
| DRYRUN-01 | Phase 22 | Complete |
| DRYRUN-02 | Phase 22 | Complete |
| DRYRUN-03 | Phase 22 | Complete |
| DRYSAFE-01 | Phase 22 | Complete |
| DRYSAFE-02 | Phase 22 | Complete |
| PLAN-22-01 | Phase 22 | Complete |
| PLAN-22-02 | Phase 22 | Complete |
| PLAN-22-03 | Phase 22 | Complete |

**Coverage:**
- v1.5 requirements: 20 total
- Mapped to phases: 20
- Unmapped: 0

---
*Requirements updated: 2026-05-29 after Phase 22 Operator Trial Dry Run.*

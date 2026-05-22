# Requirements: OpenForge v1.3 AI-Native Project Execution Traceability

**Defined:** 2026-05-22
**Core Value:** Developers can reliably control and recover local AI CLI coding sessions from a browser while turning AI-assisted work into auditable project state.
**Milestone Goal:** Extend the v1.2 Project Manager workflow into an AI-native execution traceability layer that links Copilot, terminal context, evidence, provider readiness, and open-source trust without changing OpenForge into a generic project-management suite.

## Readiness Assessment

- v1.2 Project Manager Web Workflow is complete and archived.
- `.planning/STATE.md` had no active milestone before this definition.
- Before this v1.3 planning update, tracked code was clean; the current tracked changes are the v1.3 planning documents, and unrelated untracked `upload_img/` remains outside milestone scope.
- v1.1 external caveats remain explicit caveats and are not silently reclassified by this milestone.
- This milestone has started. Phase 12 context is gathered in `.planning/phases/OF-12-copilot-project-manager-traceability/12-CONTEXT.md`; the next step is `$gsd-plan-phase 12`.

## v1.3 Requirements

### Product Position

- [x] **POS-01**: OpenForge remains a local-first AI CLI control plane; AI-native project management is a traceability layer on top of local AI CLI execution, not a Jira/Linear replacement.
- [x] **POS-02**: Project Manager state remains Gateway-owned, tenant-scoped, audited, and bounded to structured references.
- [x] **POS-03**: Copilot, Feishu, and model output may propose project-manager writes only through explicit pending-action approval flows.

### Copilot And Project Manager Traceability

- [x] **TRACE-01**: User can link a Copilot run, pending action, or safe run summary to a project-manager work item as a bounded evidence reference.
- [x] **TRACE-02**: Copilot can propose project-manager work item creation, status updates, and evidence attachments through pending actions, never direct mutation.
- [x] **TRACE-03**: Ledger events record safe traceability markers for Copilot-proposed changes, including run id, action type, status, and evidence counts without raw prompt, terminal, provider, or secret content.
- [x] **TRACE-04**: Web surfaces show how a work item moved from prompt to approval to execution evidence.

### Project Manager Board Workflow

- [ ] **BOARD-01**: User can manage work items in a Kanban-style board grouped by bounded status.
- [ ] **BOARD-02**: User can edit and delete work items with Gateway validation, tenant scoping, ledger events, and clear destructive-action confirmation.
- [ ] **BOARD-03**: User can perform bounded batch actions on selected work items without bypassing status-transition rules.
- [ ] **BOARD-04**: The existing table/detail workflow remains usable for dense review and does not regress.

### Terminal Workspace Context

- [ ] **CTX-01**: Session and project views expose a safe file tree sidecar rooted at the project path.
- [ ] **CTX-02**: File tree reads use existing safe path resolution rules and reject traversal, symlink escape, and sensitive system paths.
- [ ] **CTX-03**: User can attach file path, terminal snapshot marker, or session id as bounded evidence references to a work item.
- [ ] **CTX-04**: Terminal, file context, and project-manager evidence remain references only; raw terminal scrollback is not stored in SQLite.

### Model Provider Setup And Health

- [ ] **MODEL-01**: User gets a guided provider setup path that reduces provider profile, credential, and model profile confusion.
- [ ] **MODEL-02**: Provider/model health can verify credential and selected model readiness with a safe lightweight provider call where supported, not only endpoint `HEAD`.
- [ ] **MODEL-03**: Provider errors distinguish invalid credential, endpoint/network failure, unsupported model, timeout, and provider outage with actionable remediation.
- [ ] **MODEL-04**: Codex subscription-managed launch paths remain isolated from provider API-key/model override injection.

### Open Source Readiness

- [ ] **OSS-01**: Repository declares an open-source license and records the license rationale.
- [ ] **OSS-02**: README, CONTRIBUTING, SECURITY, and issue templates explain local-first scope, prerequisites, support boundaries, and safe feedback handling.
- [ ] **OSS-03**: Release/readiness docs avoid overclaiming external caveats and keep live-provider, Windows/WSL, Feishu callback, and first-user feedback rerun paths visible.

## Out of Scope

| Feature | Reason |
|---------|--------|
| Generic project-management suite | v1.3 is about AI execution traceability inside OpenForge, not replacing Jira, Linear, or ClickUp. |
| Hosted collaboration, cloud deployment, billing, hosted marketplace, or telemetry | Requires separate architecture, security, and product review. |
| Autonomous remote execution or unattended coding loop | Would change authority boundaries and threat model. |
| Feishu free-form approval or terminal input | Feishu remains a collaboration ingress only. |
| Raw evidence blob storage | Evidence remains bounded references; raw transcripts, Feishu content, provider payloads, and secrets stay excluded. |
| Codex Web `/turn` product workflow | `/turn` remains default-disabled prototype scope until a separate transcript/security design exists. |
| Clearing v1.1 external caveats | Caveats require real external evidence, not milestone reclassification. |

## Traceability

| Requirement | Target Phase | Status |
|-------------|--------------|--------|
| POS-01 | Phase 12 | Complete |
| POS-02 | Phase 12 | Complete |
| POS-03 | Phase 12 | Complete |
| TRACE-01 | Phase 12 | Complete |
| TRACE-02 | Phase 12 | Complete |
| TRACE-03 | Phase 12 | Complete |
| TRACE-04 | Phase 12 | Complete |
| BOARD-01 | Phase 13 | Planned |
| BOARD-02 | Phase 13 | Planned |
| BOARD-03 | Phase 13 | Planned |
| BOARD-04 | Phase 13 | Planned |
| CTX-01 | Phase 14 | Planned |
| CTX-02 | Phase 14 | Planned |
| CTX-03 | Phase 14 | Planned |
| CTX-04 | Phase 14 | Planned |
| MODEL-01 | Phase 15 | Planned |
| MODEL-02 | Phase 15 | Planned |
| MODEL-03 | Phase 15 | Planned |
| MODEL-04 | Phase 15 | Planned |
| OSS-01 | Phase 16 | Planned |
| OSS-02 | Phase 16 | Planned |
| OSS-03 | Phase 16 | Planned |

**Coverage:**
- v1.3 requirements: 22 total
- Mapped to phases: 22
- Unmapped: 0

---
*Requirements defined: 2026-05-22 after PM review audit triage.*

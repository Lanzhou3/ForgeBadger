# Requirements: OpenForge v1.2 Project Manager Web Workflow

**Defined:** 2026-05-21
**Core Value:** Developers can reliably control and recover local AI CLI coding sessions from a browser without losing tenant isolation, credential boundaries, terminal persistence, or auditability.
**Milestone Goal:** Turn the existing Gateway-owned project-manager ledger into a first-class Web workflow for project goals, work items, evidence references, and ledger review.

## v1.2 Requirements

### Project Manager API Client

- [x] **PMAPI-01**: User-facing Web code can call every existing project-manager Gateway endpoint through typed client functions and DTOs in `packages/web/src/lib/api.ts`.
- [x] **PMAPI-02**: User sees clear loading, empty, validation-error, not-found, and mutation-error states for project-manager API calls.

### Project Manager Workspace

- [x] **PMUX-01**: User can open a first-class project-manager surface from a project detail context without leaving the project workflow.
- [x] **PMUX-02**: User can view and update the project goal summary, constraints, acceptance criteria, and status.
- [x] **PMUX-03**: User can list, filter, and inspect project-manager work items with status, priority, acceptance criteria, and reference counts.
- [x] **PMUX-04**: User can create a project-manager work item with title, description, priority, acceptance criteria, and optional initial references.
- [x] **PMUX-05**: User can move a work item through allowed status transitions and receives a clear blocked state when completion lacks evidence or a manual completion reason.

### Evidence And Ledger Review

- [x] **PMEV-01**: User can attach bounded evidence references to a work item using only the approved reference fields from `docs/API.md`.
- [ ] **PMEV-02**: User can review a ledger timeline that shows safe event markers, status, evidence counts, Feishu reference counts, and timestamps without raw sensitive details.
- [ ] **PMEV-03**: User can distinguish manual completion, evidence attachment, blocker, and status-change events from the ledger surface.

### Safety, Testing, And Handoff

- [x] **PMQA-01**: Project-manager Web workflow tests cover typed client calls, component states, mutation errors, strict E2E mocks, and at least one end-to-end project goal/work-item/evidence/ledger path.
- [ ] **PMQA-02**: Maintainer docs or trial notes describe the v1.2 project-manager workflow, known boundaries, and what evidence should never be pasted into the UI.

## Future Requirements

### Project Manager Expansion

- **PMFUT-01**: User can use a global project-manager dashboard across projects.
- **PMFUT-02**: User can manage work items through a drag-and-drop kanban board.
- **PMFUT-03**: Copilot can propose project-manager writes through pending actions.
- **PMFUT-04**: Feishu inbound commands can request project-manager mutations through explicit approval-gated flows.
- **PMFUT-05**: Remote execution sessions can link progress and evidence into project-manager work items after the remote runtime milestone ships.

## Out of Scope

| Feature | Reason |
|---------|--------|
| New Gateway project-manager data model | The backend ledger, routes, transitions, and evidence schema already exist; v1.2 is a Web workflow milestone. |
| Feishu or Copilot direct ledger mutation | Existing security boundary says Feishu text and model output are not project-manager authorities. |
| Raw evidence blob storage | Evidence references are bounded pointers; raw terminal transcripts, Feishu content, provider payloads, and secrets remain excluded. |
| Full project-management suite | v1.2 targets local-first development control-plane needs, not a Jira/Linear replacement. |
| SSH/remote execution runtime | Remote runtime has separate architecture and threat model; it should remain a later implementation milestone. |
| Clearing v1.1 external caveats | Live provider, Windows/WSL, Feishu console callback, and first-user feedback caveats require real external evidence. |

## Traceability

| Requirement | Phase | Status |
|-------------|-------|--------|
| PMAPI-01 | Phase 9 | Complete |
| PMAPI-02 | Phase 9 | Complete |
| PMUX-01 | Phase 9 | Complete |
| PMUX-02 | Phase 10 | Complete |
| PMUX-03 | Phase 10 | Complete |
| PMUX-04 | Phase 10 | Complete |
| PMUX-05 | Phase 10 | Complete |
| PMEV-01 | Phase 11 | Complete |
| PMEV-02 | Phase 11 | Pending |
| PMEV-03 | Phase 11 | Pending |
| PMQA-01 | Phase 11 | Complete |
| PMQA-02 | Phase 11 | Pending |

**Coverage:**
- v1.2 requirements: 12 total
- Mapped to phases: 12
- Unmapped: 0

---
*Requirements defined: 2026-05-21*
*Last updated: 2026-05-21 after v1.2 milestone requirements definition*

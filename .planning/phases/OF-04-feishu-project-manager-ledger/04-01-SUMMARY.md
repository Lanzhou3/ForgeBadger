---
phase: OF-04-feishu-project-manager-ledger
plan: 01
subsystem: api
tags: [docs, gateway, project-manager-ledger, feishu, copilot, diagnostics]

requires:
  - phase: OF-02-public-feishu-webhook-safety
    provides: Accepted Feishu bridge safety boundary before ledger expansion
provides:
  - Gateway-owned project-manager ledger API contract
  - Exact project-manager table, route, status, event, evidence, audit, diagnostics, and Copilot read-tool semantics
  - Explicit Feishu free-form text and terminal non-authority boundary
affects: [OF-04-feishu-project-manager-ledger, 04-02 implementation, docs/API.md]

tech-stack:
  added: []
  patterns:
    - Gateway-owned REST contract under /api/v1/projects/:projectId/project-manager
    - Tenant-scoped project-manager tables with bounded ledger and evidence references
    - Copilot read tools return redacted bounded state only

key-files:
  created:
    - .planning/phases/OF-04-feishu-project-manager-ledger/04-01-SUMMARY.md
  modified:
    - docs/API.md

key-decisions:
  - "Project-manager ledger state is OpenForge-owned Gateway control-plane state."
  - "Project-manager rows require user_id, project-scoped rows require project_id, and routes stay under /api/v1/projects/:projectId/project-manager."
  - "Feishu free-form text cannot approve pending actions, send terminal input, mutate ledger records, or bypass pending-action approval."
  - "Diagnostics expose counts and safe markers only, never raw ledger, evidence, terminal, Feishu secret, provider credential, token, or signature data."

patterns-established:
  - "Contract-first docs before 04-02 backend implementation."
  - "Evidence references are structured bounded pointers, not raw evidence blobs."
  - "Every future project-manager mutation must write a ledger event and an audit_logs row atomically."

requirements-completed: [PM-01, PM-02, PM-03]

duration: 5min
completed: 2026-05-20
---

# Phase 04 Plan 01: Ledger Model, State Transitions, and Audit Semantics Summary

**Gateway-owned project-manager ledger contract with exact tables, routes, status transitions, evidence references, Copilot read tools, diagnostics limits, and Feishu/terminal authority boundaries.**

## Performance

- **Duration:** 5 min
- **Started:** 2026-05-20T15:25:03Z
- **Completed:** 2026-05-20T15:30:00Z
- **Tasks:** 2
- **Files modified:** 1

## Accomplishments

- Added the `Project Manager Ledger` REST contract to `docs/API.md`, including exact table names, migration path, project-scoped route prefix, envelope semantics, zod validation expectations, and Copilot read-tool names.
- Documented bounded work item statuses, allowed state transitions, event types, evidence reference fields, and the rule that `done` requires evidence or a manual completion reason.
- Locked audit, diagnostics, Feishu, and terminal boundaries so 04-02 can implement without interpreting authority or redaction semantics.

## Task Commits

1. **Task 1: Specify ledger model and project-scoped surface contract** - `b6bce35` (docs)
2. **Task 2: Specify state transitions, audit rows, evidence references, and redaction boundaries** - `4d491fb` (docs)

**Plan metadata:** final GSD metadata commit is created after this summary and state updates.

## Files Created/Modified

- `docs/API.md` - Added Project Manager Ledger API, storage, Copilot read-tool, status transition, evidence, audit, diagnostics, and Feishu/terminal boundary contract.
- `.planning/phases/OF-04-feishu-project-manager-ledger/04-01-SUMMARY.md` - Execution summary and verification record.

## Decisions Made

- Followed the plan's exact table names: `project_manager_goals`, `project_manager_work_items`, and `project_manager_ledger_events`.
- Locked the project-scoped REST prefix to `/api/v1/projects/:projectId/project-manager`.
- Kept Copilot write proposals out of this plan; any future model-origin project-manager write must use pending actions.
- Kept diagnostics to counts and safe status markers only.

## Verification

- `rg -n "Project Manager Ledger|project_manager_goals|project_manager_work_items|project_manager_ledger_events|/api/v1/projects/:projectId/project-manager|openforge.get_project_goal|openforge.list_project_work_items|openforge.get_project_work_item|openforge.get_project_development_ledger" docs/API.md` - passed
- `rg -n "todo|in_progress|blocked|ready_for_review|done|cancelled|goal_updated|work_item_created|work_item_status_changed|evidence_attached|manual_completion_recorded|manual completion|Feishu free-form text|cannot approve pending actions|cannot send terminal input|cannot mutate ledger|diagnostics.*counts|raw ledger" docs/API.md` - passed
- `rg -n "Project Manager Ledger|project_manager_goals|project_manager_work_items|project_manager_ledger_events|/api/v1/projects/:projectId/project-manager" docs/API.md` - passed
- `rg -n "Feishu free-form text|cannot approve pending actions|cannot send terminal input|cannot mutate ledger|manual completion|diagnostics" docs/API.md` - passed
- `git diff --check -- docs/API.md` - passed

## Deviations from Plan

None - plan executed exactly as written.

## Auth Gates

None.

## Known Stubs

None. Stub scan found no placeholder, TODO, FIXME, or hardcoded empty UI-data patterns in the modified plan file.

## Issues Encountered

- Git index writes are blocked inside the default sandbox (`.git/index.lock`: read-only file system). Task commits succeeded by rerunning the exact `gsd-sdk query commit ... --files docs/API.md` commands with approved escalation.
- `gsd-sdk query state.advance-plan` could not parse the current STATE `Plan: Not started` format. The current position was advanced with `state.update` commands instead.
- `gsd-sdk query state.update-progress` calculated 92% but left the frontmatter `progress.percent` at 60. The frontmatter percent was minimally corrected to match the SDK-calculated value and body progress.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

Plan 04-02 can implement the backend migration, repository, routes, Copilot read tools, and diagnostics using `docs/API.md` as the source of truth. No blocker remains for 04-02.

## Self-Check: PASSED

- FOUND: `.planning/phases/OF-04-feishu-project-manager-ledger/04-01-SUMMARY.md`
- FOUND: `docs/API.md`
- FOUND: `b6bce35`
- FOUND: `4d491fb`

---
*Phase: OF-04-feishu-project-manager-ledger*
*Completed: 2026-05-20*

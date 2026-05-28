---
phase: OF-12-copilot-project-manager-traceability
plan: 03
subsystem: web
tags: [project-manager, copilot, traceability, web, vitest, i18n]

requires:
  - phase: OF-12-copilot-project-manager-traceability
    provides: Plan 12-01 PM trace DTO contract and Plan 12-02 Copilot PM approval bridge
provides:
  - Web Project Manager evidence refs carry Copilot pending action ids.
  - Web ledger events expose bounded ProjectManagerLedgerTrace markers.
  - Copilot helper layer has fixed labels, summaries, result/failure summaries, safe markers, and Project Manager anchor metadata for exactly three PM actions.
  - i18n dictionaries include PM approval, trace, anchor, failure, and trusted-evidence copy.
affects: [phase-12, copilot, project-manager, web-dtos, i18n]

tech-stack:
  added: []
  patterns:
    - Existing Vitest web-lib helper coverage
    - Fixed-template Copilot pending-action summaries with safe marker metadata
    - i18n-key metadata for component rendering in later UI work

key-files:
  created:
    - .planning/phases/OF-12-copilot-project-manager-traceability/12-03-SUMMARY.md
  modified:
    - packages/web/src/lib/api.ts
    - packages/web/src/lib/copilot.ts
    - packages/web/src/lib/i18n.ts
    - packages/web/src/lib/api.test.ts
    - packages/web/src/lib/copilot.test.ts

key-decisions:
  - "Expose Project Manager Web traceability through bounded DTO/helper metadata only; component rendering remains in Plan 12-04."
  - "Use fixed Copilot PM summary templates and marker arrays instead of raw JSON, model prose, terminal output, provider payloads, stdout/stderr, or approval diffs."
  - "Expose Project Manager anchor metadata as URL-safe project/work-item targets with a localized label key."

patterns-established:
  - "ProjectManagerLedgerTrace: Web DTO for D-07 allowlisted fields only."
  - "CopilotProjectManagerAnchor: helper-generated Project Manager URL target with `copilot.projectManager.view` label key."
  - "Project Manager summary markers: action, project/work item, fields, evidence count, approval/execution status, and trace chain."

requirements-completed: [POS-01, TRACE-01, TRACE-03, TRACE-04]

duration: 13min
completed: 2026-05-22
---

# Phase 12 Plan 03: Web Project Manager Trace Helpers Summary

**Typed Web Project Manager trace DTOs and fixed Copilot PM summary helpers for safe approval-card rendering.**

## Performance

- **Duration:** 13min
- **Started:** 2026-05-22T15:36:45Z
- **Completed:** 2026-05-22T15:50:22Z
- **Tasks:** 2
- **Files modified:** 6

## Accomplishments

- Added RED Web tests for `pendingActionId`, `ProjectManagerLedgerTrace`, the three PM proposal labels/keys, fixed summaries, result/failure summaries, anchor metadata, i18n copy, and raw-field exclusions.
- Added `ProjectManagerEvidenceRef.pendingActionId` and `ProjectManagerLedgerTrace` with only D-07 safe marker fields.
- Added Copilot PM helper support for exactly:
  - `openforge.propose_project_manager_create_work_item`
  - `openforge.propose_project_manager_update_work_item_status`
  - `openforge.propose_project_manager_attach_evidence`
- Added safe summary markers for action type, target project/work item, fields, evidence counts, trace chain, risk cue, approval/execution status, and `View in Project Manager` anchor targets.
- Added localized PM approval/trace/failure copy for zh-CN, zh-TW, and en dictionaries.

## Task Commits

1. **Task 1: Add Web DTO and Copilot helper tests** - `a69254a` (test)
2. **Task 2: Implement Web DTOs, summaries, and localized copy** - `467f18a` (feat)

## Files Created/Modified

- `packages/web/src/lib/api.ts` - Adds `pendingActionId` to evidence refs and `ProjectManagerLedgerTrace` to ledger events.
- `packages/web/src/lib/copilot.ts` - Adds fixed PM action labels, label keys, safe summaries, result/failure summaries, risk markers, and Project Manager anchor helper.
- `packages/web/src/lib/i18n.ts` - Adds PM approval labels, trace labels, anchor copy, failure copy, and trusted-evidence copy across all locales.
- `packages/web/src/lib/api.test.ts` - Covers Web DTO trace fields and the bounded ledger trace key set.
- `packages/web/src/lib/copilot.test.ts` - Covers three PM action helpers, i18n keys, raw-field exclusion, anchors, and safe PM result/failure markers.
- `.planning/phases/OF-12-copilot-project-manager-traceability/12-03-SUMMARY.md` - Execution summary and verification evidence.

## Decisions Made

- Kept this plan in the Web lib/API-contract layer only; no Copilot component rendering was modified.
- Added marker arrays and i18n key metadata so Plan 12-04 can render dense localized UI without deriving summaries from raw payloads.
- Kept PM failure text fixed and keyed; backend error messages are not used as primary visible PM failure copy.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Reduced attach-evidence detail text to a bounded title**
- **Found during:** Task 2 (Implement Web DTOs, summaries, and localized copy)
- **Issue:** Initial attach-evidence detail included the full safe evidence marker string, making the primary card title too long and duplicating marker content.
- **Fix:** Kept only evidence kind + label in `detail`; retained full safe ref/path/session markers in the marker array.
- **Files modified:** `packages/web/src/lib/copilot.ts`
- **Verification:** `pnpm --dir packages/web test src/lib/copilot.test.ts src/lib/api.test.ts`
- **Committed in:** `467f18a`

**2. [Rule 3 - Blocking] Omitted nullable anchors under exact optional property types**
- **Found during:** Task 2 typecheck
- **Issue:** Optional `anchor` fields were assigned `null`, which violates `exactOptionalPropertyTypes`.
- **Fix:** Built summary objects with conditional anchor spreads so absent anchors are omitted.
- **Files modified:** `packages/web/src/lib/copilot.ts`
- **Verification:** `pnpm --dir packages/web typecheck`
- **Committed in:** `467f18a`

---

**Total deviations:** 2 auto-fixed (1 bug, 1 blocking)
**Impact on plan:** Both fixes tightened the planned safe-summary contract and did not expand scope.

## Issues Encountered

- Task 1 RED verification failed as intended: 8 Copilot helper/i18n/anchor/result-summary assertions failed before implementation while `api.test.ts` still passed.
- Sandbox could not write `.git/index.lock`; task commits were created through approved git execution with normal hooks and without `--no-verify`.

## Verification

- RED: `pnpm --dir packages/web test src/lib/copilot.test.ts src/lib/api.test.ts` - expected failure before implementation, 8 failing Copilot helper assertions.
- GREEN: `pnpm --dir packages/web test src/lib/copilot.test.ts src/lib/api.test.ts` - passed, 92/92 tests.
- Final: `pnpm --dir packages/web test src/lib/copilot.test.ts src/lib/api.test.ts` - passed, 92/92 tests.
- Final: `pnpm --dir packages/web typecheck` - passed.
- Final: `rg -n "ProjectManagerLedgerTrace|pendingActionId|propose_project_manager_create_work_item|propose_project_manager_update_work_item_status|propose_project_manager_attach_evidence|View in Project Manager|Trusted evidence is required" packages/web/src/lib/api.ts packages/web/src/lib/copilot.ts packages/web/src/lib/i18n.ts packages/web/src/lib/api.test.ts packages/web/src/lib/copilot.test.ts` - passed.
- `git diff --check -- packages/web/src/lib/api.ts packages/web/src/lib/copilot.ts packages/web/src/lib/i18n.ts packages/web/src/lib/api.test.ts packages/web/src/lib/copilot.test.ts` - passed.

## Known Stubs

None introduced. Stub-pattern scan found existing unrelated i18n text (`commandPalette.placeholder`, `projects.skillsComingSoon`) outside the new Project Manager trace copy.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

Plan 12-04 can render PM-specific Copilot cards and Project Manager trace markers using typed DTOs, fixed markers, localized copy keys, and `View in Project Manager` anchor metadata from this plan.

## Self-Check: PASSED

- Verified `12-03-SUMMARY.md` exists.
- Verified key source files exist.
- Verified task commits `a69254a` and `467f18a` exist in git history.
- Verified required focused tests, rg check, typecheck, and whitespace check passed.
- Verified unrelated untracked `upload_img/` was not staged or committed.

---
*Phase: OF-12-copilot-project-manager-traceability*
*Completed: 2026-05-22*

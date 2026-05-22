---
phase: 11-evidence-ledger-and-acceptance-gates
plan: 01
subsystem: ui
tags: [react, project-manager, evidence, tanstack-query, playwright]
requires:
  - phase: 10-goal-and-work-item-operations
    provides: Work item detail Sheet, status mutation flow, and strict Project Manager E2E baseline
provides:
  - Bounded evidence attachment form inside the work item detail Sheet
  - One-reference `attachProjectManagerWorkItemEvidence` mutation flow
  - Local Web guard for obvious secret-like or raw-output evidence values
  - Typed client and strict E2E coverage for the evidence attach endpoint
affects: [project-manager-web-workflow, evidence-ledger, first-user-acceptance-gates]
tech-stack:
  added: []
  patterns:
    - Evidence attachment accepts pointer fields only: kind, label, ref, and path.
    - Web mutations invalidate work item and ledger queries after successful evidence attachment.
key-files:
  created:
    - .planning/phases/OF-11-evidence-ledger-and-acceptance-gates/11-01-SUMMARY.md
  modified:
    - packages/web/src/components/projects/ProjectManagerPanel.tsx
    - packages/web/src/lib/i18n.ts
    - packages/web/src/lib/api.test.ts
    - packages/web/e2e/project-manager.spec.ts
key-decisions:
  - "Evidence attachment stays inside the work item detail Sheet; work item table rows do not get direct attach controls."
  - "The Web UI submits exactly one structured evidence reference and blocks obvious raw output or secret-like pointer values before calling Gateway."
patterns-established:
  - "Post-creation Project Manager mutations should keep Gateway authority while adding recoverable local errors and targeted query invalidation."
  - "Strict Project Manager E2E mocks must explicitly handle new `/api/v1/projects/:projectId/project-manager/*` endpoints and keep the unknown route fallback."
requirements-completed: [PMEV-01, PMQA-01]
duration: 12min
completed: 2026-05-22
---

# Phase 11 Plan 01: Evidence Attachment Summary

**Bounded evidence pointer attachment from Project Manager work item details**

## Performance

- **Duration:** 12 min
- **Started:** 2026-05-22T06:26:49Z
- **Completed:** 2026-05-22T06:38:46Z
- **Tasks:** 4
- **Files modified:** 4

## Accomplishments

- Added an evidence attachment form only inside the existing work item detail Sheet.
- Wired `attachProjectManagerWorkItemEvidence` with one-reference request bodies and work item plus ledger invalidation on success.
- Added local validation requiring `kind` plus either `ref` or `path`, while blocking obvious API keys, bearer/JWT tokens, private key text, attach tokens, raw terminal markers, command output, control/newline characters, and provider-payload-like values.
- Preserved safe draft values and kept the Sheet open when the attach mutation fails.
- Extended i18n copy across Simplified Chinese, Traditional Chinese, and English.
- Tightened API and Playwright coverage for the encoded evidence attach URL, exact request body, success state update, failure recovery, and strict unknown-route fallback.

## Task Commits

1. **Tasks 1-4: Evidence attach UI, guard, i18n, and coverage** - `727c3ac` (feat)

Tasks were committed together because the typed UI, localized copy, mutation wiring, and strict E2E mock need to compile and pass as one coherent change.

## Files Created/Modified

- `packages/web/src/components/projects/ProjectManagerPanel.tsx` - Evidence draft state, safe-value guard, attach mutation, and detail Sheet form.
- `packages/web/src/lib/i18n.ts` - Evidence attach labels, helper text, and errors in supported locales.
- `packages/web/src/lib/api.test.ts` - Encoded attach endpoint and exact one-reference body assertion.
- `packages/web/e2e/project-manager.spec.ts` - Strict evidence attach success and recoverable failure coverage.

## Decisions Made

- Kept evidence attach controls off work item table rows so users must inspect the work item context before attaching evidence.
- Treated evidence references as pointers only; no raw evidence, terminal transcript, Feishu body, provider payload, or note/body paste area was added.
- Kept Gateway as final authority while adding Web-side pre-submit rejection for obvious sensitive or raw-content values.

## Deviations from Plan

None - plan scope executed as written. Task commit packaging was consolidated for type-safe UI and E2E coupling.

**Total deviations:** 0 auto-fixed.
**Impact on plan:** No scope change.

## Issues Encountered

- RED check passed as expected: the new Playwright attach test timed out on the missing `Kind` control before implementation.
- Playwright still requires escalation in this environment because the sandbox blocks local dev-server port binding with `listen EPERM`.
- One E2E assertion was tightened after it matched several generic `"1"` nodes; the final test checks the exact work item table cell and the Sheet evidence reference text.

## Verification

- RED: `pnpm --dir packages/web exec playwright test e2e/project-manager.spec.ts --project=chromium --grep "attaches one bounded"` - failed as expected because the Sheet had no evidence form yet.
- `pnpm --dir packages/web run typecheck` - pass.
- `pnpm --dir packages/web exec vitest run src/lib/api.test.ts` - pass, 46/46.
- `pnpm --dir packages/web exec playwright test e2e/project-manager.spec.ts --project=chromium` - pass, 7/7.
- `git diff --check` - pass.
- `gsd-sdk query verify.schema-drift 11` - pass, `drift_detected: false`.
- `rg -n "attachProjectManagerWorkItemEvidence|createSingleEvidenceReference|validateEvidenceReferenceInput|projectManagerAttachEvidence" packages/web/src/components/projects/ProjectManagerPanel.tsx packages/web/src/lib/i18n.ts packages/web/src/lib/api.test.ts packages/web/e2e/project-manager.spec.ts` - pass.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

Ready for 11-02. The next plan can add ledger timeline controls and scoped ledger error handling on top of the now-refreshing evidence and ledger query flow.

---
*Phase: 11-evidence-ledger-and-acceptance-gates*
*Completed: 2026-05-22*

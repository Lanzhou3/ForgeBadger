---
phase: 03-first-user-product-hardening
plan: 03
subsystem: docs
tags: [trial-feedback, first-user-readiness, github-issue-form, ux-requirements]

requires:
  - phase: 03-first-user-product-hardening
    provides: Phase 3 UX requirement set and first-user hardening context
provides:
  - Trial checklist mapping for UX-01 through UX-07
  - Offline feedback template with pass/caveat/blocked rubric and owner next-action fields
  - GitHub issue form fields for mapped requirement, category, severity, and caveat owner
affects: [phase-03, beta-trials, feedback-routing, product-hardening]

tech-stack:
  added: []
  patterns: [requirement-mapped-feedback, caveat-owner-next-action, secret-safe-trial-reporting]

key-files:
  created: []
  modified:
    - docs/TRIAL-CHECKLIST.md
    - docs/TRIAL-FEEDBACK.md
    - .github/ISSUE_TEMPLATE/openforge-trial-feedback.yml

key-decisions:
  - "First-user trial feedback must map each issue to UX-01 through UX-07 before it is routed to hardening work."
  - "Pass with caveats and blocked results require owner, next action, and evidence needed to move to Pass."

patterns-established:
  - "Trial feedback captures expected behavior, actual behavior, command/browser evidence, mapped requirement, severity, owner, and follow-up phase."
  - "External evidence caveats stay explicit instead of being converted into false Pass claims."

requirements-completed:
  - UX-04

duration: 4 min
completed: 2026-05-20
---

# Phase 03 Plan 03: Trial Feedback Routing Summary

**First-user trial feedback now maps issues to Phase 3 UX requirements with caveat ownership and secret-removal checks.**

## Performance

- **Duration:** 4 min
- **Started:** 2026-05-20T02:41:00Z
- **Completed:** 2026-05-20T02:45:04Z
- **Tasks:** 3
- **Files modified:** 3

## Accomplishments

- Added a Phase 3 hardening triage table to the trial checklist for `UX-01` through `UX-07`.
- Expanded the offline feedback template with pass / pass with caveats / blocked rubric, expected/actual behavior, owner, next action, caveat status, and mapped requirement guidance.
- Added GitHub issue form fields for mapped UX requirement, category, severity, and caveat owner/next action while preserving `trial-feedback` and `product-hardening` labels.

## Task Commits

1. **Task 1-3: Trial feedback routing** - `b850cd0` (docs)

**Plan metadata:** pending docs commit

## Files Created/Modified

- `docs/TRIAL-CHECKLIST.md` - Adds Phase 3 UX mapping and caveat owner/next-action fields.
- `docs/TRIAL-FEEDBACK.md` - Adds reproducibility rubric, mapped UX requirement guide, and caveat ownership.
- `.github/ISSUE_TEMPLATE/openforge-trial-feedback.yml` - Adds mapped requirement, category, severity, and caveat owner fields.

## Decisions Made

- Feedback routing now uses Phase 3 UX requirement IDs as the default issue taxonomy for first-user hardening.
- Secret-safety warnings remain explicit in both offline and GitHub issue feedback paths.

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered

None.

## Verification

- `rg -n "UX-01|UX-02|UX-03|UX-04|UX-05|UX-06|UX-07" docs/TRIAL-CHECKLIST.md docs/TRIAL-FEEDBACK.md .github/ISSUE_TEMPLATE/openforge-trial-feedback.yml`: passed.
- `rg -n "API keys|JWTs|attach tokens|private keys|browser auth token|openforge.token" docs/TRIAL-CHECKLIST.md docs/TRIAL-FEEDBACK.md .github/ISSUE_TEMPLATE/openforge-trial-feedback.yml`: passed with explicit secret-removal warnings.
- `rg -n "pass with caveats|blocked|Expected Behavior|Actual Behavior|Owner|Next action|severity|expected|actual|trial-feedback|product-hardening" docs/TRIAL-CHECKLIST.md docs/TRIAL-FEEDBACK.md .github/ISSUE_TEMPLATE/openforge-trial-feedback.yml`: passed.
- `git diff --check -- docs/TRIAL-CHECKLIST.md docs/TRIAL-FEEDBACK.md .github/ISSUE_TEMPLATE/openforge-trial-feedback.yml`: passed.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

Wave 1 is complete. Ready for `03-02` provider/Copilot recovery and state clarity work.

---
*Phase: 03-first-user-product-hardening*
*Completed: 2026-05-20*

---
phase: 08-first-user-readiness-packet
plan: 01
subsystem: docs
tags: [readiness, support, diagnostics, trial, redaction]

requires:
  - phase: 06-beta-evidence-burn-down
    provides: v1.1 evidence matrix and live-provider/platform caveats
  - phase: 07-feishu-public-callback-readiness
    provides: Feishu callback evidence, topology boundary, and fail-closed encrypted payload caveat
provides:
  - First-user Quick Smoke checklist path
  - Unified support diagnostics packet for provider, runtime/terminal, and Feishu failures
  - Feedback caveat routing and redaction guidance
affects: [first-user-readiness, support-diagnostics, beta-evidence]

tech-stack:
  added: []
  patterns: [docs-as-source-of-truth, caveat-preserving evidence, redacted diagnostics]

key-files:
  created:
    - docs/SUPPORT-DIAGNOSTICS.md
  modified:
    - docs/TRIAL-CHECKLIST.md
    - .gitignore

key-decisions:
  - "First-user entry point is docs/TRIAL-CHECKLIST.md with a short Quick Smoke path and maintainer appendix."
  - "Completed first-user feedback remains Caveat until a real packet is attached or linked."
  - "Support diagnostics collect summaries and redacted artifacts only, never raw credentials or payload bodies."

patterns-established:
  - "Support diagnostics split triage by provider, runtime/terminal, and Feishu failure domains."
  - "New docs under ignored docs/* require explicit .gitignore unignore rules to be source-of-truth artifacts."

requirements-completed: [BETA-03, READY-01, READY-02]

duration: 12min
completed: 2026-05-21
---

# Phase 08 Plan 01 Summary

**First-user Quick Smoke checklist and redacted support diagnostics packet**

## Performance

- **Duration:** 12 min
- **Started:** 2026-05-21T12:48:00Z
- **Completed:** 2026-05-21T13:00:17Z
- **Tasks:** 3
- **Files modified:** 3

## Accomplishments

- Reorganized `docs/TRIAL-CHECKLIST.md` around `## Quick Smoke`, `## Feedback Capture`, and `## Evidence Appendix`.
- Added `docs/SUPPORT-DIAGNOSTICS.md` with provider, runtime/terminal, and Feishu failure triage paths.
- Preserved live provider, Windows/WSL, Feishu callback, and first-user feedback as explicit caveats with owners, collection paths, and redaction boundaries.

## Task Commits

1. **Tasks 1-3: first-user checklist and support diagnostics** - `d8e8f56` (docs)

## Files Created/Modified

- `docs/TRIAL-CHECKLIST.md` - First-user Quick Smoke path, feedback capture rules, and evidence appendix.
- `docs/SUPPORT-DIAGNOSTICS.md` - Unified support diagnostics packet with commands, expected artifacts, redaction guidance, and escalation boundaries.
- `.gitignore` - Explicitly unignored `docs/SUPPORT-DIAGNOSTICS.md` so the planned artifact is tracked.

## Decisions Made

- Kept first-user feedback status as `Caveat` because no real completed first-user packet was provided.
- Kept Feishu developer-console callback as blocked evidence, with `lark-cli` and simulated Gateway tests treated as preflight/regression only.
- Kept physical Windows/WSL as a caveat until a real WSL host completes terminal evidence.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] New support document was ignored by repository rules**

- **Found during:** Task 2 (Create unified support diagnostics packet)
- **Issue:** `.gitignore` ignores `docs/*`, so `docs/SUPPORT-DIAGNOSTICS.md` would not be committed as a Phase 8 artifact.
- **Fix:** Added a narrow unignore rule for `docs/SUPPORT-DIAGNOSTICS.md`.
- **Files modified:** `.gitignore`
- **Verification:** `git status --short docs/SUPPORT-DIAGNOSTICS.md` showed the file as trackable after the change.
- **Committed in:** `d8e8f56`

---

**Total deviations:** 1 auto-fixed blocking tracking issue.
**Impact on plan:** The deviation was necessary for the planned artifact to exist in version control. No unrelated docs were unignored.

## Issues Encountered

None.

## Verification

- `git diff --check` - PASS.
- `rg -n "## Quick Smoke|## Feedback Capture|## Evidence Appendix|docs/TRIAL-FEEDBACK.md|OpenForge first-user trial feedback" docs/TRIAL-CHECKLIST.md` - PASS.
- `rg -n "## Provider Failures|## Runtime And Terminal Failures|## Feishu Failures|## Redaction Checklist|## Escalation Boundaries" docs/SUPPORT-DIAGNOSTICS.md` - PASS.
- Targeted secret scan over `docs/TRIAL-CHECKLIST.md` and `docs/SUPPORT-DIAGNOSTICS.md` - PASS with 12 classified matches, all forbidden-category wording or placeholder names; no raw secret values introduced.

## User Setup Required

None. External live evidence remains optional and is routed through the checklist and diagnostics packet.

## Next Phase Readiness

Plan 08-02 can now create the readiness closeout and route the remaining caveats from the new trial and support packet.

## Self-Check: PASSED

All 08-01 acceptance criteria passed. The planned artifacts exist, are linked, preserve caveats, and do not request raw credentials or sensitive payloads.

---
*Phase: 08-first-user-readiness-packet*
*Completed: 2026-05-21*

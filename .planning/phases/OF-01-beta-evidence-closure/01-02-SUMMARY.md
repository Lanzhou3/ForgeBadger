---
phase: 01-beta-evidence-closure
plan: 02
subsystem: docs
tags: [copilot, provider-smoke, release-evidence, secrets]

requires:
  - phase: 01-01
    provides: current source-of-truth status for Phase 1 evidence docs
provides:
  - live-provider evidence report with Caveat status
  - smoke documentation secret-handling clarification
affects: [phase-1-beta-evidence, copilot-provider-smoke, trial-readiness]

tech-stack:
  added: []
  patterns:
    - live provider evidence uses Pass/Caveat/Blocked status
    - missing disposable provider credential is recorded as Caveat with owner and next action

key-files:
  created:
    - docs/reports/phase-1-live-provider-evidence-2026-05-19.md
  modified:
    - docs/SMOKE-TEST.md

key-decisions:
  - "REL-01 remains Caveat until a disposable provider credential and explicit model id are supplied."
  - "Provider evidence docs must not include API key assignment examples or plaintext credential values."

patterns-established:
  - "Evidence reports record sanitized command output and skip reason rather than implying an unrun live provider pass."

requirements-completed: [REL-01]

duration: 10min
completed: 2026-05-19
---

# Phase 01 Plan 02: Live Provider Evidence Summary

**Copilot live-provider smoke is recorded as a credential-missing Caveat with redacted evidence handling and a concrete rerun path.**

## Performance

- **Duration:** 10 min
- **Started:** 2026-05-19T14:50:38Z
- **Completed:** 2026-05-19T15:00:38Z
- **Tasks:** 3
- **Files modified:** 2

## Accomplishments

- Ran `pnpm smoke:copilot-provider`; sandbox IPC failed, unrestricted rerun completed.
- Captured the result as `Caveat` with `missing_provider_credential`, owner, and next action.
- Clarified smoke documentation so Phase 1 evidence uses disposable/rotatable credentials and records only redacted JSON/public summary fields.
- Removed API-key assignment shapes from documentation examples so the secret grep stays clean.

## Task Commits

1. **Tasks 1-3: live provider caveat and smoke docs** - `323c9d5` (docs)

**Plan metadata:** this summary commit.

## Files Created/Modified

- `docs/reports/phase-1-live-provider-evidence-2026-05-19.md` - REL-01 evidence table, caveat, secret handling, and follow-up.
- `docs/SMOKE-TEST.md` - Phase 1 safe evidence handling guidance.

## Decisions Made

- Classified missing live-provider credentials as `Caveat`, not `Blocked`, because the harness ran and the missing condition is external setup.
- Kept the live run instructions in docs without embedding `OPENFORGE_COPILOT_PROVIDER_SMOKE_API_KEY=` assignment examples.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 2 - Missing Critical] Removed API-key assignment examples from evidence docs**
- **Found during:** Task 2 verification
- **Issue:** The strict secret-grep would match `OPENFORGE_COPILOT_PROVIDER_SMOKE_API_KEY=` examples in docs even when placeholders were not real secrets.
- **Fix:** Reworded examples to require setting the key in a shell or secret manager first, without documenting key assignment syntax.
- **Files modified:** `docs/SMOKE-TEST.md`, `docs/reports/phase-1-live-provider-evidence-2026-05-19.md`
- **Verification:** `rg -n 'sk-[A-Za-z0-9_-]+|OPENFORGE_COPILOT_PROVIDER_SMOKE_API_KEY=|OPENAI_API_KEY=|ANTHROPIC_API_KEY=' ...` returned no matches.
- **Committed in:** `323c9d5`

---

**Total deviations:** 1 auto-fixed (missing critical).
**Impact on plan:** Improved secret hygiene and satisfied the plan's verification gate.

## Issues Encountered

- `pnpm smoke:copilot-provider` failed inside the sandbox with `tsx` IPC `EPERM`; the command was rerun outside the sandbox and completed with a skipped result.

## User Setup Required

Disposable OpenAI or Anthropic provider credential and explicit model id are required to turn REL-01 from `Caveat` into `Pass`.

## Next Phase Readiness

Ready for Plan 01-03 platform and first-user feedback evidence. REL-01 has explicit caveat ownership and no secret leakage.

## Self-Check: PASSED

---
*Phase: 01-beta-evidence-closure*
*Completed: 2026-05-19*

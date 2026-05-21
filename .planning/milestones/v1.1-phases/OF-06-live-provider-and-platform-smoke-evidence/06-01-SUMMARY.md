---
phase: 06-live-provider-and-platform-smoke-evidence
plan: 01
subsystem: docs
tags: [evidence, copilot, provider-smoke, release-gates, redaction]
requires:
  - phase: 06-live-provider-and-platform-smoke-evidence
    provides: Phase 6 context, research, and validation strategy
provides:
  - v1.1 evidence matrix entry point
  - live Copilot provider caveat evidence
  - smoke and trial doc links to the Phase 6 matrix
affects: [phase-06, phase-07, phase-08, release-gates]
tech-stack:
  added: []
  patterns:
    - Pass/Caveat/Blocked evidence matrix
    - Redacted live provider evidence recording
key-files:
  created:
    - docs/reports/v1.1-beta-evidence-burn-down-2026-05-21.md
    - .planning/phases/OF-06-live-provider-and-platform-smoke-evidence/06-USER-SETUP.md
  modified:
    - .gitignore
    - docs/SMOKE-TEST.md
    - docs/TRIAL-CHECKLIST.md
key-decisions:
  - "Live Copilot provider remains `Caveat` because no disposable provider credential was available."
  - "The v1.1 evidence matrix is the source of truth for Phase 6 evidence status."
  - "New Phase 6 report files are explicitly unignored so evidence artifacts are tracked."
patterns-established:
  - "Evidence matrix rows use Gate, Status, Command/Checklist, Environment, Evidence Summary, Artifact, Caveat/Blocker Reason, Owner, and Rerun/Next Action."
  - "Live provider evidence records public metadata and redacted JSON only."
requirements-completed: [BETA-01, BETA-04]
duration: 14 min
completed: 2026-05-21
---

# Phase 06 Plan 01: Live Provider Evidence Matrix Summary

**v1.1 evidence matrix with live Copilot provider caveat, redacted smoke result, and smoke/trial doc routing**

## Performance

- **Duration:** 14 min
- **Started:** 2026-05-21T02:15:00Z
- **Completed:** 2026-05-21T02:29:00Z
- **Tasks:** 3
- **Files modified:** 5

## Accomplishments

- Created `docs/reports/v1.1-beta-evidence-burn-down-2026-05-21.md` as the Phase 6 master evidence matrix.
- Ran `pnpm smoke:copilot-provider`; unrestricted rerun returned `ok: true`, `status: skipped`, `reason: missing_provider_credential`, so the live provider gate is recorded as `Caveat`.
- Updated `docs/SMOKE-TEST.md` and `docs/TRIAL-CHECKLIST.md` to route Phase 6 evidence to the v1.1 matrix and preserve live-provider caveat semantics.
- Created `06-USER-SETUP.md` with the external setup needed to turn provider or WSL caveats into pass evidence.

## Task Commits

Each task was committed atomically:

1. **Task 1: Create the v1.1 evidence matrix entry point** - `9c7f2cc`
2. **Task 2: Run or classify the live provider smoke** - `5cd2b02`
3. **Task 3: Link smoke and trial docs to the v1.1 matrix** - `f385396`

**Plan metadata:** pending in this summary commit.

## Files Created/Modified

- `docs/reports/v1.1-beta-evidence-burn-down-2026-05-21.md` - Master Phase 6 evidence matrix with live provider `Caveat` and pending Wave 2 rows.
- `.gitignore` - Added explicit tracking exceptions for the Phase 6 evidence reports.
- `docs/SMOKE-TEST.md` - Points maintainers to the v1.1 matrix and preserves live-provider caveat rules.
- `docs/TRIAL-CHECKLIST.md` - Adds Phase 6 matrix routing for trial evidence capture.
- `.planning/phases/OF-06-live-provider-and-platform-smoke-evidence/06-USER-SETUP.md` - Lists external provider and physical WSL setup needed for pass evidence.

## Decisions Made

- A missing disposable provider credential is a `Caveat`, not an implementation failure.
- The report records the smoke result summary and normalized classification without recording keys, request payloads, response payloads, or full model output.
- The matrix is the source of truth; smoke and trial docs link to it rather than duplicating status tables.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Added Phase 6 report exceptions to `.gitignore`**
- **Found during:** Task 1 (Create the v1.1 evidence matrix entry point)
- **Issue:** `docs/reports/*` ignored the new matrix report, so the required evidence artifact could not be committed.
- **Fix:** Added explicit exceptions for `docs/reports/v1.1-beta-evidence-burn-down-2026-05-21.md` and `docs/reports/phase-6-terminal-gate-evidence-2026-05-21.md`.
- **Files modified:** `.gitignore`
- **Verification:** `git status --short` showed the new report as trackable and `git diff --check` passed.
- **Committed in:** `9c7f2cc`

---

**Total deviations:** 1 auto-fixed (blocking source-of-truth tracking issue).
**Impact on plan:** Necessary for evidence traceability. No runtime scope was added.

## Issues Encountered

- Sandboxed `pnpm smoke:copilot-provider` failed with `tsx` IPC `listen EPERM`. An unrestricted rerun completed and returned the safe skipped JSON result.
- Targeted sensitive-term scan found placeholder/category wording in the report and smoke docs: provider payload category labels and documented environment variable names. No raw secret values were found.

## Verification

- `git diff --check` passed.
- `pnpm smoke:copilot-provider` passed in unrestricted execution with `ok: true`, `status: skipped`, `reason: missing_provider_credential`.
- `gsd-sdk query init.phase-op 6` detected `plan_count: 2` and the Phase 6 plan/research/context artifacts.
- Targeted sensitive-term scan found only classified placeholders/category labels in docs, not raw credentials.

## User Setup Required

External resources are optional for Phase 6 caveat closure and documented in
`06-USER-SETUP.md`:

- disposable OpenAI or Anthropic credential plus explicit model id for live provider `Pass`;
- physical Windows host with WSL and tmux for terminal `Pass`.

## Next Phase Readiness

Plan 06-02 can now complete the pending matrix rows for physical Windows/WSL,
CI core smoke, `gate-d`, focused tmux, release docs consistency, and
secret/redaction scan.

---
*Phase: 06-live-provider-and-platform-smoke-evidence*
*Completed: 2026-05-21*

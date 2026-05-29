---
phase: 03-first-user-product-hardening
plan: 01
subsystem: ui
tags: [runtime-readiness, dependencies, settings, sessions, vitest]

requires:
  - phase: 02-public-feishu-webhook-safety
    provides: Public webhook safety gates and release-readiness state baseline
provides:
  - Runtime remediation helper for tmux, WSL-required, tmux-missing, and unknown dependency states
  - Dashboard dependency health that fails visibly when dependency status is unavailable
  - Settings adapter discovery error and retry state
  - Project and session recovery links to Settings and Copilot readiness context
affects: [phase-03, runtime-readiness, first-user-onboarding, web-ui]

tech-stack:
  added: []
  patterns: [centralized-runtime-remediation-helper, query-error-degraded-state, localized-recovery-actions]

key-files:
  created: []
  modified:
    - packages/web/src/lib/terminal-runtime.ts
    - packages/web/src/lib/terminal-runtime.test.ts
    - packages/web/src/app/(dashboard)/page.tsx
    - packages/web/src/app/(dashboard)/settings/page.tsx
    - packages/web/src/app/(dashboard)/projects/[id]/page.tsx
    - packages/web/src/app/(dashboard)/sessions/[id]/page.tsx
    - packages/web/src/lib/i18n.ts

key-decisions:
  - "Dashboard dependency health now requires a successful dependency query and supported terminal runtime before showing healthy."
  - "Runtime recovery UI routes users to Settings and Copilot readiness instead of exposing raw dependency or attach-token values."

patterns-established:
  - "Runtime remediation metadata lives in packages/web/src/lib/terminal-runtime.ts and is consumed by pages instead of page-local switch logic."
  - "Adapter discovery failures use a visible degraded-state card with retry, matching existing query failure patterns."

requirements-completed:
  - UX-01
  - UX-06

duration: 9 min
completed: 2026-05-20
---

# Phase 03 Plan 01: Runtime Failure State Summary

**Runtime dependency and adapter failure states now point first users to visible recovery actions instead of false-green or empty UI states.**

## Performance

- **Duration:** 9 min
- **Started:** 2026-05-20T02:33:14Z
- **Completed:** 2026-05-20T02:42:12Z
- **Tasks:** 4
- **Files modified:** 7

## Accomplishments

- Added tested runtime remediation metadata for `native_tmux`, `wsl_required`, `tmux_missing`, and unknown dependency states.
- Changed Dashboard dependency health so failed or missing dependency reports are visible and not reported healthy.
- Added Settings Adapter Discovery load-failed copy, retry action, and readiness guidance for local `claude`, `opencode`, `codex`, and tmux conditions.
- Added Settings and Copilot recovery actions to project launch and session-open failure states.

## Task Commits

1. **Task 1-4: Runtime readiness recovery states** - `942143d` (feat)

**Plan metadata:** pending docs commit

## Files Created/Modified

- `packages/web/src/lib/terminal-runtime.ts` - Adds centralized remediation metadata while preserving `terminalRuntimeTranslationKey`.
- `packages/web/src/lib/terminal-runtime.test.ts` - Covers all supported runtime modes, unknown modes, and secret-like output guard.
- `packages/web/src/app/(dashboard)/page.tsx` - Fails dependency health visibly when dependency query data is unavailable.
- `packages/web/src/app/(dashboard)/settings/page.tsx` - Shows adapter discovery failure with retry and readiness guidance.
- `packages/web/src/app/(dashboard)/projects/[id]/page.tsx` - Adds Settings and Copilot recovery actions when no runtime CLI is launchable.
- `packages/web/src/app/(dashboard)/sessions/[id]/page.tsx` - Adds Settings and Copilot recovery actions to terminal open failures.
- `packages/web/src/lib/i18n.ts` - Adds zh-CN, zh-TW, and en recovery copy.

## Decisions Made

- Dependency health now requires positive Gateway dependency evidence; missing data and query failures are not treated as healthy.
- Recovery copy stays generic and actionable, avoiding plaintext tokens, API keys, provider payloads, or raw attach-token values.

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered

- The documented `pnpm --dir packages/web ...` command shape was not accepted by this local pnpm binary. Verification was rerun from `/data/OpenForge/packages/web` with equivalent `pnpm vitest ...` and `pnpm run typecheck` commands.

## Verification

- `pnpm vitest run src/lib/terminal-runtime.test.ts src/lib/session-connect-state.test.ts` from `packages/web`: passed, 2 files and 11 tests.
- `pnpm run typecheck` from `packages/web`: passed.
- `git diff --check`: passed.
- `rg -n "OPENFORGE|JWT|attach token|sk-" ...`: only safe environment-name/security-label UI copy matched; no secret values were introduced.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

Ready for `03-03` in Wave 1. `03-02` can rely on the new runtime recovery pattern when adding Copilot/provider recovery states.

---
*Phase: 03-first-user-product-hardening*
*Completed: 2026-05-20*

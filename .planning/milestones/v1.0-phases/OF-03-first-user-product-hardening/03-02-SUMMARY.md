---
phase: 03-first-user-product-hardening
plan: 02
subsystem: copilot-ui
tags: [copilot, provider-readiness, active-run-state, e2e, recovery]

requires:
  - phase: 03-first-user-product-hardening
    provides: Runtime recovery patterns from 03-01
provides:
  - Helper-level active-run freshness coverage for terminal states, event sequence, and pending-action updates
  - Copilot panel provider readiness messaging for missing compatible provider, active credential, or active model
  - Strict Copilot E2E mocks for `/api/v1/model-providers`
  - Browser-level regression coverage for stale live run detail after terminal state
affects: [phase-03, copilot, provider-recovery, first-user-readiness]

tech-stack:
  added: []
  patterns: [monotonic-active-run-state, provider-readiness-message-helper, strict-e2e-api-mocks]

key-files:
  created: []
  modified:
    - packages/web/src/lib/copilot.ts
    - packages/web/src/lib/copilot.test.ts
    - packages/web/src/components/copilot/copilot-chat-panel.tsx
    - packages/web/e2e/copilot.spec.ts

key-decisions:
  - "Provider setup blockers reuse existing localized readiness copy instead of adding new i18n text."
  - "Run-detail request-order protection remains helper-driven because timestamp, event-sequence, pending-action freshness, and terminal-state guards already reject stale responses without dropping useful Gateway events."
  - "Copilot E2E mocks remain strict 404 for unhandled `/api/v1/*` routes."

patterns-established:
  - "Provider readiness is derived from `/copilot/capabilities` supported formats plus `/model-providers` profiles, credentials, and models."
  - "Browser tests dispatch Gateway run events to prove stale live detail cannot regress a terminal active-run state."

requirements-completed:
  - UX-02
  - UX-03
  - UX-05
  - UX-06

duration: 25 min
completed: 2026-05-20
---

# Phase 03 Plan 02: Copilot Recovery State Summary

**Copilot recovery is now more specific for provider setup blockers, and active-run UI state has stronger monotonic regression coverage.**

## Performance

- **Duration:** 25 min
- **Started:** 2026-05-20T22:04:00+08:00
- **Completed:** 2026-05-20T22:13:30+08:00
- **Tasks:** 4
- **Files modified:** 4

## Accomplishments

- Added focused unit coverage so terminal `cancelled` state is not overwritten by stale `running` detail, pending-action `updatedAt` freshness wins at equal run timestamp, and a different run id accepts the next state.
- Added `getCopilotProviderReadinessMessageKey()` to map readiness codes to existing localized provider setup messages.
- Wired the Copilot panel to load model provider profiles only when provider setup is blocked, then render the precise missing layer plus Models and retry actions.
- Extended strict Copilot E2E mocks with `/api/v1/model-providers`, provider readiness cases, and a Gateway-event stale run-detail regression.

## Task Commits

1. **Task 1-3: Copilot/provider recovery state** - `98c1d2b` (feat)
2. **Task 4: Stale run-detail E2E coverage** - `5b92b7e` (test)

**Plan metadata:** pending docs commit

## Files Created/Modified

- `packages/web/src/lib/copilot.ts` - Adds provider readiness message-key helper while preserving existing active-run freshness helper semantics.
- `packages/web/src/lib/copilot.test.ts` - Adds active-run stale-state and provider readiness message-key tests.
- `packages/web/src/components/copilot/copilot-chat-panel.tsx` - Shows precise provider setup blocker messages from model-provider readiness data.
- `packages/web/e2e/copilot.spec.ts` - Adds provider readiness E2E coverage, model-provider mock route, and stale run-detail regression.

## Decisions Made

- No new i18n keys were needed; existing zh-CN, zh-TW, and en provider readiness messages already covered the required states.
- No explicit request-token guard was added because all active-run detail paths already flow through `applyActiveRunState()`, and the shared helper rejects stale run id/timestamp/event sequence/pending-action/terminal regressions without suppressing later useful Gateway fetches.

## Deviations from Plan

- The plan listed `packages/web/src/lib/i18n.ts` as potentially modified, but existing localized keys were sufficient.

## Issues Encountered

- Playwright webServer cannot bind `127.0.0.1:48732` inside the default sandbox (`listen EPERM`). E2E verification was rerun with approved local binding escalation.
- The documented `pnpm --dir packages/web ...` command shape is not accepted by this local pnpm binary. Equivalent commands were run from `/data/OpenForge/packages/web`.

## Verification

- `pnpm vitest run src/lib/copilot.test.ts` from `packages/web`: passed, 39 tests.
- `pnpm run typecheck` from `packages/web`: passed.
- `pnpm exec playwright test e2e/copilot.spec.ts --project=chromium` from `packages/web`: passed, 27 tests.
- `git diff --check`: passed.
- `rg -n "sk-|OPENFORGE_JWT_SECRET|OPENFORGE_MASTER_KEY|Authorization: Bearer|attach token|private key|plaintextSecret" packages/web/src/components/copilot packages/web/src/lib/copilot.ts packages/web/src/lib/copilot.test.ts packages/web/e2e/copilot.spec.ts`: no matches.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

Ready for `03-04` Web E2E mocks/selectors/state-ordering hardening. `03-04` can build on the strict mock fallback and stale run-detail coverage added here.

---
*Phase: 03-first-user-product-hardening*
*Completed: 2026-05-20*

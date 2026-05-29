---
phase: 07-feishu-live-callback-readiness
plan: 02
subsystem: integrations
tags: [feishu, webhook, security, release-evidence, regression]
requires:
  - phase: 07-01-feishu-callback-preflight
    provides: sanitized callback evidence report and real console callback blocker
provides:
  - Public webhook negative-control regression tests
  - Automated authority and tenant-boundary evidence
  - Single-Gateway, encrypted-payload, and shared-store release caveats
  - Final Phase 7 redaction and decision-coverage evidence
affects: [feishu, copilot, terminal-authority, ci, smoke, trial, release-evidence]
tech-stack:
  added: []
  patterns:
    - Manual/live callback gates stay separate from automated signed-route regressions
    - Multi-instance public exposure is blocked unless shared replay and rate-limit stores exist
key-files:
  created:
    - .planning/phases/OF-07-feishu-live-callback-readiness/07-02-SUMMARY.md
  modified:
    - packages/gateway/test/feishu-integration.test.ts
    - docs/reports/phase-7-feishu-callback-evidence-2026-05-21.md
    - docs/reports/v1.1-beta-evidence-burn-down-2026-05-21.md
    - docs/API.md
    - docs/SMOKE-TEST.md
    - docs/TRIAL-CHECKLIST.md
    - docs/CI-CD-PLAN.md
key-decisions:
  - "Current v1.1 public Feishu webhook support is local or single-Gateway with SQLite replay/rate storage."
  - "Multi-instance public webhook exposure requires shared replay and shared rate-limit stores before enablement."
  - "Top-level encrypted Feishu payloads fail closed with feishu_webhook_encrypted_payload_unsupported; decrypt support is a future security-reviewed phase."
  - "Feishu free-form text cannot approve pending actions, send terminal input, or bypass tenant/audit policy."
requirements-completed: [FEI-01, FEI-02, FEI-03]
duration: 13min
completed: 2026-05-21
---

# Phase 07 Plan 02: Feishu Live Exposure Boundary Summary

**Feishu public webhook evidence now distinguishes real console callback blockers from automated route, topology, encrypted-payload, and authority regressions**

## Performance

- **Duration:** 13 min
- **Started:** 2026-05-21T07:45:10Z
- **Completed:** 2026-05-21T07:58:07Z
- **Tasks:** 4
- **Files modified:** 7

## Accomplishments

- Added focused public webhook negative-control tests for encrypted payload fail-closed, signed token mismatch, and chat allowlist rejection without Copilot run creation.
- Recorded local signed-route and authority regression evidence in the Phase 7 Feishu report.
- Updated the v1.1 evidence matrix plus API, smoke, trial, and CI docs so manual/live Feishu callback verification is not confused with automated regression evidence.
- Documented v1.1 support as single Gateway with SQLite replay/rate storage; multi-instance public exposure requires shared replay and shared rate-limit stores.
- Documented encrypted Feishu payloads as fail-closed until decrypt support is implemented in a dedicated security-reviewed phase.
- Completed final redaction scan and decision coverage checks.

## Task Commits

1. **Task 1: Add missing public webhook negative-control tests** - `c021b51` (test)
2. **Task 2: Run authority and tenant regression evidence** - `19825e0` (docs)
3. **Task 3: Finalize topology, encrypted-payload, and release docs** - `09d52e7` (docs)
4. **Task 4: Run final redaction and GSD coverage checks** - `52a1878` (docs)

## Files Created/Modified

- `packages/gateway/test/feishu-integration.test.ts` - Adds public webhook encrypted payload, token mismatch, and allowlist rejection tests.
- `docs/reports/phase-7-feishu-callback-evidence-2026-05-21.md` - Final Phase 7 evidence matrix.
- `docs/reports/v1.1-beta-evidence-burn-down-2026-05-21.md` - Links Phase 7 callback, topology, encrypted-payload, and authority status.
- `docs/API.md` - Adds the manual/live developer-console evidence boundary for public Feishu callbacks.
- `docs/SMOKE-TEST.md` - Adds Feishu callback to manual smoke boundaries.
- `docs/TRIAL-CHECKLIST.md` - Adds Feishu live callback readiness checklist.
- `docs/CI-CD-PLAN.md` - Separates automated Feishu regressions from manual/live console callback gate.

## Decisions Made

- Automated signed-route tests are regression evidence only; a real Feishu developer-console callback is still required for callback `Pass`.
- v1.1 supports public Feishu webhook exposure only in local/single-Gateway topology with SQLite replay/rate storage.
- Multi-instance public exposure must stay disabled or fail closed until shared replay and shared rate-limit stores are implemented.
- Top-level encrypted Feishu payloads fail closed; decrypt support was intentionally not added in Phase 7.

## Deviations from Plan

None - plan executed as written. `packages/gateway/src/routes/integrations-feishu.ts` remained unchanged because the new negative-control tests passed against the existing fail-closed behavior.

## Issues Encountered

- Sandbox runs of `node --test --import tsx` can fail with local IPC `listen EPERM`; the required gateway tests were rerun outside the sandbox with approval.
- The targeted secret scan returned expected matches in synthetic tests, placeholder docs, helper field identifiers, and GSD planning text. All were classified; no raw secret values were found.

## Verification

- `git diff --check` - passed.
- `pnpm --dir packages/gateway test test/feishu-integration.test.ts test/copilot-routes.test.ts` - passed, 169 tests.
- `pnpm --dir packages/gateway typecheck` - passed.
- `gsd-sdk query check.decision-coverage-plan .planning/phases/OF-07-feishu-live-callback-readiness .planning/phases/OF-07-feishu-live-callback-readiness/07-CONTEXT.md` - passed, 18/18 decisions covered.
- Documentation assertion `rg` for Phase 7 report link, single-Gateway, shared replay/rate, encrypted payload, fail-closed code, free-form authority, terminal input, and developer-console wording - passed.
- Targeted Phase 7 secret scan - 85 expected/classified matches, no unclassified raw secrets.

## User Setup Required

External setup remains required only to convert the live callback row from `Blocked` to `Pass`:

- Public HTTPS URL routing to Gateway `POST /api/v1/integrations/feishu/webhook/:publicId`.
- Feishu developer-console event subscription URL verification.
- Optional allowed-chat real `im.message.receive_v1` event after URL verification.

## Next Phase Readiness

Phase 7 is ready for verify-work. Phase 8 can consume the v1.1 matrix and Phase 7 report without treating the missing real Feishu console callback as a hidden pass.

## Self-Check: PASSED

---
*Phase: 07-feishu-live-callback-readiness*
*Completed: 2026-05-21*

---
phase: 07-feishu-live-callback-readiness
plan: 01
subsystem: integrations
tags: [feishu, webhook, callback, evidence, redaction]
requires:
  - phase: 04-public-feishu-webhook-safety
    provides: public Feishu webhook route, tenant policy, and audit boundaries
provides:
  - Secret-safe Feishu public webhook setup helper
  - Sanitized CLI and Gateway callback preflight evidence
  - Real Feishu developer-console callback blocker with rerun path
affects: [feishu, copilot, release-evidence, beta-readiness]
tech-stack:
  added: []
  patterns:
    - Environment-only live secret input for callback setup helpers
    - Evidence matrix separating preflight, simulated regression, and real provider callback proof
key-files:
  created:
    - scripts/prepare-feishu-public-webhook.ts
    - scripts/prepare-feishu-public-webhook.test.ts
    - docs/reports/phase-7-feishu-callback-evidence-2026-05-21.md
  modified:
    - package.json
key-decisions:
  - "CLI long-connection evidence remains preflight only; FEI-01 pass requires real Feishu developer-console HTTP callback evidence."
  - "When public HTTPS URL or console callback action is unavailable, FEI-01 is recorded as Blocked with owner and rerun path instead of being overclaimed."
requirements-completed: [FEI-01]
duration: 10min
completed: 2026-05-21
---

# Phase 07 Plan 01: Feishu Callback Preflight Summary

**Secret-safe Feishu callback setup and sanitized evidence report that records the real developer-console callback as blocked, not passed**

## Performance

- **Duration:** 10 min
- **Started:** 2026-05-21T07:33:47Z
- **Completed:** 2026-05-21T07:43:39Z
- **Tasks:** 3
- **Files modified:** 4

## Accomplishments

- Added `scripts/prepare-feishu-public-webhook.ts` and test coverage for storing Feishu public webhook config without printing raw verification token or event encrypt key.
- Added root script `smoke:feishu-public-webhook` for repeatable operator setup.
- Created `docs/reports/phase-7-feishu-callback-evidence-2026-05-21.md` with explicit rows for CLI preflight, Gateway setup, real console URL verification, optional live message event, local regressions, authority regression, and redaction scan.
- Recorded current live status truthfully: CLI preflight passed, Gateway setup is caveated until live env is supplied, real Feishu console URL verification is blocked, optional message event is caveated.

## Task Commits

1. **Task 1: Add a safe public webhook setup helper** - `024c283` (feat)
2. **Task 2: Run CLI and Gateway callback preflight** - `6b2789b` (docs)
3. **Task 3: Attempt real developer-console callback verification** - `2b5a7e3` (docs)
4. **Plan verification: Record redaction scan** - `d6496c9` (docs)

## Files Created/Modified

- `scripts/prepare-feishu-public-webhook.ts` - Prepares Feishu public webhook config through existing repositories using environment-only live secret input.
- `scripts/prepare-feishu-public-webhook.test.ts` - Verifies successful setup output is safe and raw webhook secrets are encrypted rather than printed or stored plaintext.
- `package.json` - Adds `smoke:feishu-public-webhook`.
- `docs/reports/phase-7-feishu-callback-evidence-2026-05-21.md` - Phase 7 evidence matrix and rerun path.

## Decisions Made

- CLI auth, doctor, and long-running event consumption are evidence of local Feishu access only, not product callback proof.
- FEI-01 is not marked `Pass` without a real Feishu developer-console HTTP callback to the Gateway public webhook route.
- Public callback setup accepts live secrets only via environment variables and emits counts, ids, booleans, and callback path only.

## Deviations from Plan

### Auto-fixed Issues

**1. Ignored evidence report path**

- **Found during:** Task 2 commit
- **Issue:** `.gitignore` ignores `docs/reports/*`, but this plan requires the Phase 7 evidence report as a tracked artifact.
- **Fix:** Used `git add -f` for only `docs/reports/phase-7-feishu-callback-evidence-2026-05-21.md`.
- **Files modified:** None beyond the planned report.
- **Verification:** `git check-ignore -v` identified `.gitignore:29:docs/reports/*`; commit includes only the required report.
- **Committed in:** `6b2789b`

**Total deviations:** 1 auto-fixed documentation tracking issue.
**Impact on plan:** No scope expansion. The fix preserved the planned evidence artifact.

## Issues Encountered

- Real Feishu developer-console URL verification could not be completed in this execution because no public HTTPS URL routed to Gateway and no console verification action evidence were available. This is recorded as `Blocked` with owner and rerun action in the evidence report.
- The optional real `im.message.receive_v1` event was not attempted because it depends on URL verification and live allowed-chat policy setup.

## Verification

- `git diff --check` - passed.
- `pnpm --dir packages/gateway test ../../scripts/prepare-feishu-public-webhook.test.ts` - passed, 1 test.
- `rg -n "Real console URL verification|CLI preflight|Gateway callback setup|Optional real message event|Pass|Caveat|Blocked|Rerun" docs/reports/phase-7-feishu-callback-evidence-2026-05-21.md` - passed.
- Targeted scan over the report and helper test for raw credential indicators - passed with no matches.

## User Setup Required

External setup remains required for a future FEI-01 `Pass`:

- Public HTTPS URL routing to Gateway `POST /api/v1/integrations/feishu/webhook/:publicId`.
- Feishu developer-console access to run event subscription URL verification.
- Live webhook setup environment for `pnpm smoke:feishu-public-webhook`, including DB path, master key, target OpenForge user, public webhook id, verification token, event encrypt key, and optional policy mappings.

No separate `07-USER-SETUP.md` was generated; the required setup and rerun path are in the evidence report.

## Next Phase Readiness

Ready for `07-02`. The next plan should consume the evidence report, add local signed-route and authority regressions, update docs with public exposure caveats, and complete FEI-02/FEI-03 evidence.

## Self-Check: PASSED

---
*Phase: 07-feishu-live-callback-readiness*
*Completed: 2026-05-21*

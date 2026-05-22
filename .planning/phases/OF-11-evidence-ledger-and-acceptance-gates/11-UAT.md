---
status: complete
phase: 11-evidence-ledger-and-acceptance-gates
source:
  - .planning/phases/OF-11-evidence-ledger-and-acceptance-gates/11-01-SUMMARY.md
  - .planning/phases/OF-11-evidence-ledger-and-acceptance-gates/11-02-SUMMARY.md
  - .planning/phases/OF-11-evidence-ledger-and-acceptance-gates/11-03-SUMMARY.md
started: 2026-05-22T15:03:12+08:00
updated: 2026-05-22T15:03:12+08:00
---

# Phase 11 UAT: Evidence Ledger And Acceptance Gates

## Current Test

[testing complete]

## Tests

### 1. Attach Bounded Evidence Reference

expected: |
  Opening a work item detail Sheet exposes evidence fields for kind, label, ref, and path only. Submitting one safe reference attaches it, refreshes the work item evidence count, and keeps the strict route mock clean.
result: pass
evidence:
  - `pnpm --dir packages/web exec playwright test e2e/project-manager.spec.ts --project=chromium` - pass, 10/10.
  - `pnpm --dir packages/web exec vitest run src/lib/api.test.ts` - pass, 46/46.
  - `pnpm --dir packages/web run typecheck` - pass.

### 2. Recover From Evidence Attach Failure

expected: |
  If evidence attachment fails, the detail Sheet stays open, the safe draft fields remain visible, and no unhandled API route is silently accepted.
result: pass
evidence:
  - Project Manager E2E `keeps safe evidence draft values visible after attach failure` passed.
  - Strict Project Manager mock retains the unknown-route fallback coverage.

### 3. Review Safe Ledger Timeline

expected: |
  The Project Manager ledger loads 25 events by default, exposes All, Status changes, Evidence, Manual completion, and Blockers filters, supports Load more to 50, and renders safe event labels, status/counts, timestamps, and static blocker/manual notes without raw details.
result: pass
evidence:
  - Project Manager E2E `renders ledger timeline filters and loads more events` passed.
  - `gsd-sdk query verify.schema-drift 11` - pass, `drift_detected: false`.

### 4. Isolate Ledger Load Failure

expected: |
  A ledger load failure appears inside the ledger card while the goal and work item cards remain visible and usable.
result: pass
evidence:
  - Project Manager E2E `keeps goal and work items visible when ledger loading fails` passed.

### 5. Complete v1.2 Workflow Happy Path

expected: |
  From the project page, the user can open Project Manager, see goal state, inspect a work item, attach bounded evidence, move status through an allowed action to done, and see relevant ledger markers with no unhandled API routes.
result: pass
evidence:
  - Project Manager E2E `completes the v1.2 Project Manager workflow under strict route mocks` passed.
  - `git diff --check` - pass.

### 6. Verify Trial, Support, And Closeout Docs

expected: |
  Trial/support docs explain Project Manager workflow, acceptable evidence references, and forbidden raw terminal, Feishu, provider, key, token, and secret content. The v1.2 closeout report exists and preserves unresolved v1.1 external caveats.
result: pass
evidence:
  - `rg -n "Project Manager Workflow|Project Manager Failures|v1.2 Project Manager|forbidden|acceptable evidence" docs/TRIAL-CHECKLIST.md docs/SUPPORT-DIAGNOSTICS.md docs/reports/v1.2-project-manager-web-workflow-closeout-2026-05-22.md` - pass.
  - Targeted docs redaction scan - 26 matches, all forbidden-category wording or placeholder-only references; no real provider keys, JWTs, private keys, attach tokens, Feishu secrets, browser auth token values, or raw provider/callback bodies.

## Summary

total: 6
passed: 6
issues: 0
pending: 0
skipped: 0
blocked: 0

## Gaps

[none]
